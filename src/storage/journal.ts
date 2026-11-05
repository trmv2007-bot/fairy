import type { DatabaseHandle } from './database.js';

export interface JournalEvent {
  eventId: string;
  jobId?: string;
  type: string;
  payload: unknown;
  createdAt: number;
  acknowledged: boolean;
}

export class EventJournalImpl {
  constructor(private db: DatabaseHandle) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        event_id TEXT PRIMARY KEY,
        job_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  append(e: Omit<JournalEvent, 'eventId' | 'createdAt'>): JournalEvent {
    const eventId = 'ev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const createdAt = Date.now();
    this.db.prepare(
      'INSERT INTO journal (event_id, job_id, type, payload, created_at, acknowledged) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(eventId, e.jobId ?? null, e.type, JSON.stringify(e.payload), createdAt, e.acknowledged ? 1 : 0);
    return { eventId, type: e.type, payload: e.payload, createdAt, acknowledged: e.acknowledged, ...(e.jobId ? { jobId: e.jobId } : {}) };
  }

  since(cursor: string | null): JournalEvent[] {
    const rows = cursor
      ? this.db.prepare('SELECT * FROM journal WHERE created_at > (SELECT created_at FROM journal WHERE event_id = ?)').all(cursor) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM journal ORDER BY created_at').all() as Record<string, unknown>[];
    return rows.map(r => ({
      eventId: String(r.event_id),
      ...(r.job_id == null ? {} : { jobId: String(r.job_id) }),
      type: String(r.type),
      payload: JSON.parse(String(r.payload)),
      createdAt: Number(r.created_at),
      acknowledged: Number(r.acknowledged) === 1,
    }));
  }

  acknowledge(eventId: string): void {
    this.db.prepare('UPDATE journal SET acknowledged = 1 WHERE event_id = ?').run(eventId);
  }
}
