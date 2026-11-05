// Capability descriptor — broker-mediated, narrowly typed.
export interface CapabilityDescriptor {
  id: string;
  version: string;
  effectClass: 'read' | 'write' | 'send' | 'delete' | 'install' | 'system';
  allowedTargets: string[];
  requiresApproval: boolean;
}
