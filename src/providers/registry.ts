// Provider registry (T07/T08). Cloud-only mode: local runner disabled by policy.
export type ProviderKind = 'cloud' | 'local' | 'subscription' | 'remote-agent';

export interface RegisteredProvider {
  id: string;
  kind: ProviderKind;
  descriptor: import('../contracts/providers.js').ProviderDescriptor;
  enabled: boolean;
}

export class ProviderRegistry {
  private providers = new Map<string, RegisteredProvider>();
  register(p: RegisteredProvider): void { this.providers.set(p.id, p); }
  list(): RegisteredProvider[] { return [...this.providers.values()]; }
  get(id: string): RegisteredProvider | undefined { return this.providers.get(id); }
  // Local models are gated: even if registered, disabled unless user opts in.
  enableLocal(_id: string): void { throw new Error('local models disabled by user directive (cloud-only mode)'); }
}
