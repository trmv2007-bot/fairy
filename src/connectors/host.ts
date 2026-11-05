// Connector host (T21/T22+): individually registered adapters with limited I/O.
export interface ConnectorManifest {
  sourceDigest: string;
  protocolVersion: string;
  operations: string[];
  effects: string[];
  roots: string[];
  domains: string[];
  credentialHandles: string[];
  limits: { ramMb: number; timeoutMs: number };
}
export interface ConnectorAdapter { manifest: ConnectorManifest; invoke(op: string, args: unknown): Promise<unknown>; }
export class ConnectorHost {
  private adapters = new Map<string, ConnectorAdapter>();
  register(id: string, a: ConnectorAdapter): void { this.adapters.set(id, a); }
  get(id: string): ConnectorAdapter | undefined { return this.adapters.get(id); }
  list(): string[] { return [...this.adapters.keys()]; }
}
