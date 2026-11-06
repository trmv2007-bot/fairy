// Candidate generation in isolated workspace (T17). Never edits running install.
import { randomUUID } from 'node:crypto';

export interface Candidate {
  id: string;
  sourceRevision: string;
  workspacePath: string;
  manifest: import('./manifest.js').CapabilityManifest;
  status: 'generated' | 'evaluated' | 'staged' | 'active' | 'rejected' | 'rolled-back';
}
export class CandidateManager {
  generate(sourceRevision: string, workspacePath: string, manifest: import('./manifest.js').CapabilityManifest): Candidate {
    // randomUUID, not Date.now() — two candidates generated in the same
    // millisecond must not collide on id.
    return { id: 'cand_' + randomUUID(), sourceRevision, workspacePath, manifest, status: 'generated' };
  }
}
