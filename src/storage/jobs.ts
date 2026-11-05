import type { DatabaseHandle } from './database.js';
import type { Job, JobState } from '../contracts/jobs.js';

export class JobStore {
  constructor(private db: DatabaseHandle) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        goal TEXT NOT NULL,
        scope_ids TEXT NOT NULL,
        state TEXT NOT NULL,
        budget_json TEXT NOT NULL,
        deadline INTEGER,
        checkpoint TEXT,
        evidence_refs TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  create(job: Job): void {
    this.db.prepare(`
      INSERT INTO jobs (id, origin, goal, scope_ids, state, budget_json, deadline, checkpoint, evidence_refs, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.origin, job.goal, JSON.stringify(job.scopeIds), job.state,
      JSON.stringify(job.resourceBudget), job.deadline ?? null, job.checkpoint ?? null,
      JSON.stringify(job.evidenceRefs), job.createdAt, job.updatedAt,
    );
  }

  get(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToJob(row);
  }

  updateState(id: string, state: JobState): void {
    this.db.prepare('UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?').run(state, Date.now(), id);
  }

  listByState(state: JobState): Job[] {
    const rows = this.db.prepare('SELECT * FROM jobs WHERE state = ?').all(state) as Record<string, unknown>[];
    return rows.map(rowToJob);
  }
}

function rowToJob(row: Record<string, unknown>): Job {
  const j: Job = {
    id: String(row.id),
    origin: String(row.origin),
    goal: String(row.goal),
    scopeIds: JSON.parse(String(row.scope_ids)) as string[],
    state: String(row.state) as JobState,
    resourceBudget: JSON.parse(String(row.budget_json)) as Job['resourceBudget'],
    evidenceRefs: JSON.parse(String(row.evidence_refs)) as string[],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
  if (row.deadline != null) j.deadline = Number(row.deadline);
  if (row.checkpoint != null) j.checkpoint = String(row.checkpoint);
  return j;
}
