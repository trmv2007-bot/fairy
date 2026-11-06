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

export class CloudProvider {
  constructor(
    public cfg: CloudProviderConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  canSpend(): boolean {
    return this.cfg.includedCost;
  }

  /**
   * OpenAI-compatible chat completion. Throws CloudRouteError when the route is
   * blocked (no included-cost consent, missing key) or the provider call fails.
   */
  async complete(prompt: string, opts: { apiKey?: string } = {}): Promise<CloudCompletion> {
    if (prompt.length === 0) throw new CloudRouteError('prompt must be non-empty');
    if (!this.canSpend()) {
      throw new CloudRouteError('no included-cost route available; blocked (zero-additional-spend)');
    }
    const apiKey = opts.apiKey;
    if (!apiKey) throw new CloudRouteError(`no API key resolved for provider '${this.cfg.endpointId}'`);

    const url = joinUrl(this.cfg.baseUrl, '/chat/completions');
    const model = this.cfg.model ?? 'gpt-4o-mini';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 1024,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'network error';
      throw new CloudRouteError(`provider request ${reason}: ${this.cfg.endpointId}`);
    } finally {
      clearTimeout(timer);
    }

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
    const usage: CloudCompletionUsage = {};
    if (typeof data.usage?.prompt_tokens === 'number') usage.promptTokens = data.usage.prompt_tokens;
    if (typeof data.usage?.completion_tokens === 'number') usage.completionTokens = data.usage.completion_tokens;
    const completion: CloudCompletion = { content, model: data.model ?? model };
    if (typeof data.usage?.prompt_tokens === 'number' || typeof data.usage?.completion_tokens === 'number') {
      completion.usage = usage;
    }
    return completion;
  }
}
