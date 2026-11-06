// Cloud provider adapter (T08). Zero-additional-spend enforced: a configured paid key
// is not permission to spend. Included-cost status is enforced per call.
// The API key is resolved by the caller (main process vault / broker handle) and is
// used for this request only — it is never part of the persisted config.
export interface CloudProviderConfig {
  endpointId: string;
  baseUrl: string;
  authHandle: string; // broker/vault-owned opaque handle
  includedCost: boolean;
  allowedDataScopes: string[];
  model?: string;
  supportsVision?: boolean;
}

export interface CloudChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CloudCompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CloudCompletion {
  content: string;
  model: string;
  usage?: CloudCompletionUsage;
}

export class CloudRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudRouteError';
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;
const MAX_STREAM_DELTA_LENGTH = 1_000_000; // hard cap against runaway streams

function joinUrl(baseUrl: string, suffix: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) throw new CloudRouteError(`provider baseUrl must be http(s): ${baseUrl}`);
  return trimmed + suffix;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

interface StreamChunk {
  model?: string;
  choices?: { delta?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

export interface CompletionOptions {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export class CloudProvider {
  constructor(
    public cfg: CloudProviderConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  canSpend(): boolean {
    return this.cfg.includedCost;
  }

  /** Back-compat single-prompt completion. */
  async complete(prompt: string, opts: CompletionOptions = {}): Promise<CloudCompletion> {
    return this.chat([{ role: 'user', content: prompt }], opts);
  }

  /**
   * Non-streaming OpenAI-compatible chat completion over a message list.
   * Throws CloudRouteError when the route is blocked (no included-cost consent,
   * missing key) or the provider call fails.
   */
  async chat(messages: CloudChatMessage[], opts: CompletionOptions = {}): Promise<CloudCompletion> {
    if (messages.length === 0) throw new CloudRouteError('messages must be non-empty');
    if (!this.canSpend()) {
      throw new CloudRouteError('no included-cost route available; blocked (zero-additional-spend)');
    }
    const apiKey = opts.apiKey;
    if (!apiKey) throw new CloudRouteError(`no API key resolved for provider '${this.cfg.endpointId}'`);

    const res = await this.post(
      messages,
      { ...opts, stream: false },
      REQUEST_TIMEOUT_MS,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new CloudRouteError(`provider HTTP ${res.status} for '${this.cfg.endpointId}': ${body.slice(0, 300)}`);
    }

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch {
      throw new CloudRouteError(`provider returned non-JSON response for '${this.cfg.endpointId}'`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new CloudRouteError(`provider response missing completion content for '${this.cfg.endpointId}'`);
    }
    return finishCompletion(content, data.model ?? this.defaultModel(), data.usage);
  }

  /**
   * Streaming chat completion: invokes `onChunk` per text delta as it arrives and
   * resolves with the assembled completion. Falls back to JSON parsing when the
   * provider ignores `stream: true`. The abort timer is per-chunk (idle timeout),
   * not whole-request, so long generations are not cut off.
   */
  async chatStream(
    messages: CloudChatMessage[],
    opts: CompletionOptions,
    onChunk: (delta: string) => void,
  ): Promise<CloudCompletion> {
    if (messages.length === 0) throw new CloudRouteError('messages must be non-empty');
    if (!this.canSpend()) {
      throw new CloudRouteError('no included-cost route available; blocked (zero-additional-spend)');
    }
    const apiKey = opts.apiKey;
    if (!apiKey) throw new CloudRouteError(`no API key resolved for provider '${this.cfg.endpointId}'`);

    const res = await this.post(messages, { ...opts, stream: true }, STREAM_IDLE_TIMEOUT_MS);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new CloudRouteError(`provider HTTP ${res.status} for '${this.cfg.endpointId}': ${body.slice(0, 300)}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      // provider ignored stream:true — parse as a normal completion
      let data: ChatCompletionResponse;
      try {
        data = (await res.json()) as ChatCompletionResponse;
      } catch {
        throw new CloudRouteError(`provider returned non-JSON response for '${this.cfg.endpointId}'`);
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new CloudRouteError(`provider response missing completion content for '${this.cfg.endpointId}'`);
      }
      onChunk(content);
      return finishCompletion(content, data.model ?? this.defaultModel(), data.usage);
    }

    if (!res.body) throw new CloudRouteError(`provider returned an empty stream for '${this.cfg.endpointId}'`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let model: string | null = null;
    let usage: { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const resetIdle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => {});
      }, STREAM_IDLE_TIMEOUT_MS);
    };
    resetIdle();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(dataStr) as StreamChunk;
          } catch {
            continue; // tolerate keep-alive noise / partial lines
          }
          if (typeof chunk.model === 'string') model = chunk.model;
          if (chunk.usage) usage = chunk.usage;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            content += delta;
            if (content.length > MAX_STREAM_DELTA_LENGTH) {
              throw new CloudRouteError(`provider stream exceeded ${MAX_STREAM_DELTA_LENGTH} chars for '${this.cfg.endpointId}'`);
            }
            onChunk(delta);
          }
        }
      }
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      void reader.cancel().catch(() => {});
    }

    if (timedOut) {
      throw new CloudRouteError(`provider stream timed out (idle > ${STREAM_IDLE_TIMEOUT_MS}ms) for '${this.cfg.endpointId}'`);
    }
    if (content.length === 0) {
      throw new CloudRouteError(`provider stream produced no content for '${this.cfg.endpointId}'`);
    }
    return finishCompletion(content, model ?? this.defaultModel(), usage);
  }

  private defaultModel(): string {
    return this.cfg.model ?? 'gpt-4o-mini';
  }

  private async post(
    messages: CloudChatMessage[],
    opts: CompletionOptions & { stream: boolean },
    timeoutMs: number,
  ): Promise<Response> {
    const url = joinUrl(this.cfg.baseUrl, '/chat/completions');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey ?? ''}`,
        },
        body: JSON.stringify({
          model: this.defaultModel(),
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 1024,
          ...(opts.stream ? { stream: true } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'network error';
      throw new CloudRouteError(`provider request ${reason}: ${this.cfg.endpointId}`);
    } finally {
      clearTimeout(timer);
    }
    return res;
  }
}

function finishCompletion(
  content: string,
  model: string,
  usage: { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined,
): CloudCompletion {
  const out: CloudCompletionUsage = {};
  if (typeof usage?.prompt_tokens === 'number') out.promptTokens = usage.prompt_tokens;
  if (typeof usage?.completion_tokens === 'number') out.completionTokens = usage.completion_tokens;
  const completion: CloudCompletion = { content, model };
  if (typeof usage?.prompt_tokens === 'number' || typeof usage?.completion_tokens === 'number') {
    completion.usage = out;
  }
  return completion;
}
