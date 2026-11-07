// Cloud provider adapter (T08). Zero-additional-spend enforced: a configured paid key
// is not permission to spend. Included-cost status is enforced per call.
// The API key is resolved by the caller (main process vault / broker handle) and is
// used for this request only — it is never part of the persisted config.
//
// Function calling (Fairy's hands, v0.2): OpenAI-compatible `tools` are sent when
// supplied, tool_calls are parsed from both plain and streamed responses, and
// assistant/tool result messages round-trip so multi-step tool loops work against
// any compliant endpoint.
export interface CloudProviderConfig {
  endpointId: string;
  baseUrl: string;
  authHandle: string; // broker/vault-owned opaque handle
  includedCost: boolean;
  allowedDataScopes: string[];
  model?: string;
  supportsVision?: boolean;
}

/** One model-invoked tool call (OpenAI function-calling wire format). */
export interface CloudToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Tool declaration sent to the provider (OpenAI function format). */
export interface CloudToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CloudChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant turns that invoked tools. */
  toolCalls?: CloudToolCall[];
  /** Present on role:'tool' turns — matches the originating assistant tool_call id. */
  toolCallId?: string;
}

export interface CloudCompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CloudCompletion {
  content: string;
  model: string;
  usage?: CloudCompletionUsage;
  /** Tool invocations the model requested (empty/absent = plain text answer). */
  toolCalls?: CloudToolCall[];
}

/** Structured failure class — lets the key pool (v0.4) classify and react. */
export type CloudErrorKind = 'http' | 'network' | 'timeout' | 'bad-response' | 'config';

export class CloudRouteError extends Error {
  /** HTTP status when the provider answered with an error response. */
  readonly status?: number;
  /** Failure family — 'config' errors are local (key/scope), the rest are remote. */
  readonly kind: CloudErrorKind;

  constructor(message: string, opts?: { status?: number; kind?: CloudErrorKind }) {
    super(message);
    this.name = 'CloudRouteError';
    this.kind = opts?.kind ?? 'config';
    if (opts?.status !== undefined) this.status = opts.status;
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
  choices?: { message?: { content?: unknown; tool_calls?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

interface StreamChunk {
  model?: string;
  choices?: { delta?: { content?: unknown; tool_calls?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

// ── Function-calling wire helpers ───────────────────────────────────────────

interface WireToolCall {
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/** Parse a `tool_calls` array (non-streaming shape) into CloudToolCall[]. */
function parseToolCalls(raw: unknown): CloudToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: CloudToolCall[] = [];
  for (const tc of raw) {
    if (typeof tc !== 'object' || tc === null) continue;
    const w = tc as WireToolCall;
    const name = typeof w.function?.name === 'string' ? w.function.name : '';
    const args = typeof w.function?.arguments === 'string' ? w.function.arguments : '';
    const id = typeof w.id === 'string' && w.id.length > 0 ? w.id : `call_${out.length}`;
    if (name.length === 0) continue; // nameless fragment is unusable
    out.push({ id, name, arguments: args });
  }
  return out;
}

/** Accumulator for streamed tool_call fragments (keyed by `index`). */
class ToolCallAccumulator {
  private readonly map = new Map<number, { id?: string; name?: string; args: string }>();

  push(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const frag of raw) {
      if (typeof frag !== 'object' || frag === null) continue;
      const f = frag as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const idx = typeof f.index === 'number' && Number.isInteger(f.index) && f.index >= 0 ? f.index : 0;
      let acc = this.map.get(idx);
      if (!acc) {
        acc = { args: '' };
        this.map.set(idx, acc);
      }
      if (typeof f.id === 'string' && f.id.length > 0) acc.id = f.id;
      if (typeof f.function?.name === 'string' && f.function.name.length > 0) acc.name = f.function.name;
      if (typeof f.function?.arguments === 'string') acc.args += f.function.arguments;
    }
  }

  finish(): CloudToolCall[] {
    const out: CloudToolCall[] = [];
    let i = 0;
    for (const acc of [...this.map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)) {
      if ((acc.name ?? '').length === 0) continue;
      out.push({ id: acc.id ?? `call_${i}`, name: acc.name!, arguments: acc.args });
      i++;
    }
    return out;
  }
}

/** Serialize messages to the OpenAI wire shape: internal-only fields never leak. */
function toWireMessages(messages: CloudChatMessage[]): Record<string, unknown>[] {
  return messages.map(m => {
    const wire: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
      wire.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    if (m.toolCallId !== undefined) wire.tool_call_id = m.toolCallId;
    return wire;
  });
}

export interface CompletionOptions {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  /** When present, tools are declared and tool_choice is 'auto'. */
  tools?: CloudToolSpec[];
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
      throw new CloudRouteError(`provider HTTP ${res.status} for '${this.cfg.endpointId}': ${body.slice(0, 300)}`, { status: res.status, kind: 'http' });
    }

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch {
      throw new CloudRouteError(`provider returned non-JSON response for '${this.cfg.endpointId}'`, { kind: 'bad-response' });
    }
    const content = data.choices?.[0]?.message?.content;
    const toolCalls = parseToolCalls(data.choices?.[0]?.message?.tool_calls);
    const contentStr = typeof content === 'string' ? content : '';
    if (contentStr.length === 0 && toolCalls.length === 0) {
      throw new CloudRouteError(`provider response missing completion content for '${this.cfg.endpointId}'`);
    }
    return finishCompletion(contentStr, data.model ?? this.defaultModel(), data.usage, toolCalls);
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
      throw new CloudRouteError(`provider HTTP ${res.status} for '${this.cfg.endpointId}': ${body.slice(0, 300)}`, { status: res.status, kind: 'http' });
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      // provider ignored stream:true — parse as a normal completion
      let data: ChatCompletionResponse;
      try {
        data = (await res.json()) as ChatCompletionResponse;
      } catch {
        throw new CloudRouteError(`provider returned non-JSON response for '${this.cfg.endpointId}'`, { kind: 'bad-response' });
      }
      const content = data.choices?.[0]?.message?.content;
      const toolCalls = parseToolCalls(data.choices?.[0]?.message?.tool_calls);
      const contentStr = typeof content === 'string' ? content : '';
      if (contentStr.length === 0 && toolCalls.length === 0) {
        throw new CloudRouteError(`provider response missing completion content for '${this.cfg.endpointId}'`);
      }
      if (contentStr.length > 0) onChunk(contentStr);
      return finishCompletion(contentStr, data.model ?? this.defaultModel(), data.usage, toolCalls);
    }

    if (!res.body) throw new CloudRouteError(`provider returned an empty stream for '${this.cfg.endpointId}'`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let model: string | null = null;
    const toolAcc = new ToolCallAccumulator();
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
          if (chunk.choices?.[0]?.delta?.tool_calls !== undefined) {
            toolAcc.push(chunk.choices[0].delta.tool_calls);
          }
          if (typeof delta === 'string' && delta.length > 0) {
            content += delta;
            if (content.length > MAX_STREAM_DELTA_LENGTH) {
              throw new CloudRouteError(`provider stream exceeded ${MAX_STREAM_DELTA_LENGTH} chars for '${this.cfg.endpointId}'`, { kind: 'bad-response' });
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
      throw new CloudRouteError(`provider stream timed out (idle > ${STREAM_IDLE_TIMEOUT_MS}ms) for '${this.cfg.endpointId}'`, { kind: 'timeout' });
    }
    const toolCalls = toolAcc.finish();
    if (content.length === 0 && toolCalls.length === 0) {
      throw new CloudRouteError(`provider stream produced no content for '${this.cfg.endpointId}'`, { kind: 'bad-response' });
    }
    return finishCompletion(content, model ?? this.defaultModel(), usage, toolCalls);
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
          messages: toWireMessages(messages),
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 1024,
          ...(opts.stream ? { stream: true } : {}),
          ...(opts.tools !== undefined && opts.tools.length > 0
            ? { tools: opts.tools, tool_choice: 'auto' }
            : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      const reason = timedOut ? 'timed out' : 'network error';
      throw new CloudRouteError(
        `provider request ${reason}: ${this.cfg.endpointId}`,
        timedOut ? { kind: 'timeout' } : { kind: 'network' },
      );
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
  toolCalls: CloudToolCall[] = [],
): CloudCompletion {
  const out: CloudCompletionUsage = {};
  if (typeof usage?.prompt_tokens === 'number') out.promptTokens = usage.prompt_tokens;
  if (typeof usage?.completion_tokens === 'number') out.completionTokens = usage.completion_tokens;
  const completion: CloudCompletion = { content, model };
  if (typeof usage?.prompt_tokens === 'number' || typeof usage?.completion_tokens === 'number') {
    completion.usage = out;
  }
  if (toolCalls.length > 0) completion.toolCalls = toolCalls;
  return completion;
}
