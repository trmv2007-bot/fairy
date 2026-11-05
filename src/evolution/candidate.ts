// Candidate generation in isolated workspace (T17). Never edits running install.
export interface Candidate {
  id: string;
  sourceRevision: string;
  workspacePath: string;
  manifest: import('./manifest.js').CapabilityManifest;
  status: 'generated' | 'evaluated' | 'staged' | 'active' | 'rejected' | 'rolled-back';
}
export class CandidateManager {
  generate(sourceRevision: string, workspacePath: string, manifest: import('./manifest.js').CapabilityManifest): Candidate {
    return { id: 'cand_' + Date.now(), sourceRevision, workspacePath, manifest, status: 'generated' };
  }
}
