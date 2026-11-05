export interface ProviderDescriptor {
  endpointId: string;
  modelId: string;
  capabilities: { text: boolean; tools: boolean; vision: boolean; streaming: boolean };
  contextLimit: number;
  authHandle: string;       // broker-owned handle, never raw secret
  allowedDataScopes: string[];
  includedCost: boolean;     // zero-additional-spend eligibility
  cancellation: boolean;
}
