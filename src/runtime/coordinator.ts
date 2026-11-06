// Coordinator (T14): converts requests/events into bounded jobs; foreground outranks
// background. Owns the job state machine — transitions are validated, jobs are claimed
// FIFO, and restart recovery re-claims interrupted 'running' jobs.
import type { Job, JobState } from '../contracts/jobs.js';
import { JobStore } from '../storage/jobs.js';
import type { DatabaseHandle } from '../storage/database.js';
import { randomUUID } from 'node:crypto';

const VALID_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'paused', 'waiting-for-approval', 'outcome-unknown', 'cancelled'],
  'waiting-for-approval': ['running', 'cancelled', 'queued'],
  paused: ['running', 'cancelled'],
  failed: ['queued', 'cancelled'],
  succeeded: [],
  cancelled: [],
  'outcome-unknown': ['queued', 'cancelled'],
};

export class Coordinator {
  constructor(private store: JobStore) {}

  static fromDb(db: DatabaseHandle): Coordinator {
    return new Coordinator(new JobStore(db));
  }

  enqueue(input: { goal: string; origin: string; scopeIds?: string[]; deadline?: number }): string {
    if (typeof input.goal !== 'string' || input.goal.trim().length === 0) {
      throw new Error('coordinator: goal must be a non-empty string');
    }
    if (typeof input.origin !== 'string' || input.origin.trim().length === 0) {
      throw new Error('coordinator: origin must be a non-empty string');
    }
    const id = 'job_' + randomUUID();
    const job: Job = {
      id,
      origin: input.origin.trim(),
      goal: input.goal.trim(),
      scopeIds: input.scopeIds ?? [],
      state: 'queued',
      resourceBudget: { timeoutMs: 600000, maxAttempts: 3 },
      evidenceRefs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
    };
    this.store.create(job);
    return id;
  }

  /** Validate + apply a state transition. Returns the updated job, or null when invalid. */
  transition(id: string, to: JobState): Job | null {
    const job = this.store.get(id);
    if (!job) return null;
    if (!VALID_TRANSITIONS[job.state].includes(to)) return null;
    this.store.updateState(id, to);
    return this.store.get(id);
  }

  /** Claim the oldest queued job (FIFO) and mark it running. */
  claimNext(): Job | null {
    const job = this.store.nextQueued();
    if (!job) return null;
    const updated = this.transition(job.id, 'running');
    return updated ?? null;
  }

  /**
   * Restart recovery: jobs found 'running' after a crash are 'outcome-unknown'
   * (never silently re-run — plan §12 requires explicit resumption of resumed goals).
   */
  markInterruptedAsUnknown(): number {
    let n = 0;
    for (const job of this.store.listByState('running')) {
      this.store.updateState(job.id, 'outcome-unknown');
      n++;
    }
    return n;
  }

  /** Attempt to resume an unknown-outcome job back into the queue. */
  resume(id: string): boolean {
    return this.transition(id, 'queued') !== null;
  }

  get(id: string): Job | null {
    return this.store.get(id);
  }

  queuedCount(): number {
    return this.store.listByState('queued').length;
  }
}
