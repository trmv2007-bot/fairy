// Coordinator (T14): converts requests/events into bounded jobs; foreground outranks background.
import type { Job } from '../contracts/jobs.js';
import { JobStore } from '../storage/jobs.js';
import type { DatabaseHandle } from '../storage/database.js';

export class Coordinator {
  constructor(private store: JobStore) {}
  static fromDb(db: DatabaseHandle): Coordinator { return new Coordinator(new JobStore(db)); }
  enqueue(input: { goal: string; origin: string; scopeIds?: string[] }): string {
    const id = 'job_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const job: Job = {
      id,
      origin: input.origin,
      goal: input.goal,
      scopeIds: input.scopeIds ?? [],
      state: 'queued',
      resourceBudget: { timeoutMs: 600000, maxAttempts: 3 },
      evidenceRefs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.store.create(job);
    return id;
  }
}
