// Job contract — durable identity + state machine (plan §7, §12 T06).
export type JobState =
  | 'queued'
  | 'running'
  | 'waiting-for-approval'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'outcome-unknown';

export interface Job {
  id: string;
  origin: string;            // trigger family
  goal: string;
  scopeIds: string[];
  state: JobState;
  resourceBudget: { ramMb?: number; gpuMb?: number; timeoutMs?: number; maxAttempts?: number };
  deadline?: number;         // epoch ms
  checkpoint?: string;       // serialized checkpoint ref
  evidenceRefs: string[];
  createdAt: number;
  updatedAt: number;
}
