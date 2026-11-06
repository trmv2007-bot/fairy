// Model gateway (T08): normalizes provider capabilities, routing, privacy/cost checks.
import type { ProviderDescriptor } from '../contracts/providers.js';
import { CloudProvider, CloudRouteError } from './cloud.js';
import type { CloudChatMessage, CloudCompletion, CloudProviderConfig } from './cloud.js';
import type { FairyConfig } from './config.js';

export type SecretResolver = (handle: string) => string | undefined;

export class ModelGateway {
  private providers = new Map<string, CloudProvider>();
  private readonly selectedProviderId: string | undefined;

  constructor(
    cfg: FairyConfig,
    private secretResolver: SecretResolver | null = null,
  ) {
    this.selectedProviderId = cfg.selectedProviderId;
    for (const c of cfg.cloudProviders) {
      this.providers.set(c.endpointId, new CloudProvider(c));
    }
  }

  list(): string[] {
    return [...this.providers.keys()];
  }

  get(id: string): CloudProvider | undefined {
    return this.providers.get(id);
  }

  configs(): CloudProviderConfig[] {
    return [...this.providers.values()].map(p => p.cfg);
  }

  // Route by capability + data eligibility + included cost; never a paid fallback.
  // Vision-capable providers are only selected when vision is actually needed.
  selectFor(dataScopes: string[], needsVision: boolean): CloudProvider | null {
    const eligible = (cfg: CloudProviderConfig): boolean => {
      if (!cfg.includedCost) return false;
      if (needsVision && cfg.supportsVision !== true) return false;
      return dataScopes.every(s => cfg.allowedDataScopes.includes(s));
    };
    // prefer the user-selected provider when it satisfies the request
    if (this.selectedProviderId) {
      const preferred = this.providers.get(this.selectedProviderId);
      if (preferred && eligible(preferred.cfg)) return preferred;
    }
    for (const p of this.providers.values()) {
      if (eligible(p.cfg)) return p;
    }
    return null;
  }

  /**
   * One-call completion: routes to an eligible provider and resolves its key from
   * the configured SecretResolver (main-process vault / broker handle).
   */
  async complete(prompt: string, dataScopes: string[], needsVision = false): Promise<CloudCompletion> {
    return this.chat([{ role: 'user', content: prompt }], dataScopes, needsVision);
  }

  /**
   * Message-list chat through the routed provider. When `onChunk` is supplied the
   * request streams and every text delta is passed to it as it arrives.
   */
  async chat(
    messages: CloudChatMessage[],
    dataScopes: string[],
    needsVision = false,
    onChunk?: (delta: string) => void,
  ): Promise<CloudCompletion> {
    const provider = this.selectFor(dataScopes, needsVision);
    if (!provider) throw new CloudRouteError('no eligible cloud route for request (cost/capability/scope)');
    if (!this.secretResolver) throw new CloudRouteError('gateway has no secret resolver configured');
    const apiKey = this.secretResolver(provider.cfg.authHandle);
    if (!apiKey) throw new CloudRouteError(`no key in vault for provider '${provider.cfg.endpointId}'`);
    if (onChunk) return provider.chatStream(messages, { apiKey }, onChunk);
    return provider.chat(messages, { apiKey });
  }

  descriptor(id: string): ProviderDescriptor | null {
    const p = this.providers.get(id);
    if (!p) return null;
    return {
      endpointId: p.cfg.endpointId,
      modelId: p.cfg.model ?? 'default',
      capabilities: { text: true, tools: false, vision: p.cfg.supportsVision === true, streaming: true },
      contextLimit: 8_000, // conservative default until per-connection discovery (T08 follow-up)
      authHandle: p.cfg.authHandle,
      allowedDataScopes: [...p.cfg.allowedDataScopes],
      includedCost: p.cfg.includedCost,
      cancellation: false,
    };
  }
}
