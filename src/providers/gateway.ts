// Model gateway (T08): normalizes provider capabilities, routing, privacy/cost checks.
import type { ProviderDescriptor } from '../contracts/providers.js';
import { CloudProvider } from './cloud.js';
import type { FairyConfig } from './config.js';

export class ModelGateway {
  private providers = new Map<string, CloudProvider>();
  constructor(private cfg: FairyConfig) {
    for (const c of cfg.cloudProviders) {
      this.providers.set(c.endpointId, new CloudProvider(c));
    }
  }
  list(): string[] { return [...this.providers.keys()]; }
  get(id: string): CloudProvider | undefined { return this.providers.get(id); }
  // route by capability + data eligibility + included cost; never paid fallback
  selectFor(dataScopes: string[], needsVision: boolean): CloudProvider | null {
    for (const p of this.providers.values()) {
      if (!p.canSpend()) continue;
      if (needsVision) continue; // vision requires verified capability
      // data scope check
      if (!dataScopes.every(s => p.cfg.allowedDataScopes.includes(s))) continue;
      return p;
    }
    return null;
  }
  descriptor(_id: string): ProviderDescriptor | null { return null; } // populated per connection
}
