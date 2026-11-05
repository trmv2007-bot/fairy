// Cloud provider adapter (T08). Zero-additional-spend enforced: a configured paid key
// is not permission to spend. Included-cost status verified per connection.
export interface CloudProviderConfig {
  endpointId: string;
  baseUrl: string;
  authHandle: string; // broker-owned
  includedCost: boolean;
  allowedDataScopes: string[];
}

export class CloudProvider {
  constructor(public cfg: CloudProviderConfig) {}
  canSpend(): boolean { return this.cfg.includedCost; }
  async complete(_prompt: string): Promise<string> {
    if (!this.canSpend()) throw new Error('no included-cost route available; blocked');
    return '';
  }
}
