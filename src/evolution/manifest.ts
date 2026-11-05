// Capability manifest (T17): version, artifact hashes, allowed effects, roots, domains, creds, resources, schema.
export interface CapabilityManifest {
  version: string;
  artifactHash: string;
  allowedEffects: string[];
  filesystemRoots: string[];
  networkDomains: string[];
  credentialHandles: string[];
  resourceRequirements: { ramMb: number; timeoutMs: number };
  stateSchemaRange: [string, string];
}
