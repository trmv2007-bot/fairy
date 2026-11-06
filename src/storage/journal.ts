// Authoritative event journal (T06). Append-only; replay via since(cursor).
// Cursor pagination is exact: every event gets a monotonically increasing
// sequence number at insert time, so a same-millisecond burst is replayed in
// insertion order — never skipped or duplicated across resume boundaries.
import { randomUUID } from 'node:crypto';
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
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        job_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_journal_created_at ON journal(created_at, seq);
    `);
  }

  append(e: Omit<JournalEvent, 'eventId' | 'createdAt'>): JournalEvent {
    if (typeof e.type !== 'string' || e.type.length === 0) {
      throw new Error('journal: event type must be a non-empty string');
    }
    const eventId = 'ev_' + randomUUID();
    const createdAt = Date.now();
    // JSON.stringify(undefined) returns undefined (not a string) and would corrupt
    // the NOT NULL binding — normalize to null first.
    const payloadJson = e.payload === undefined ? 'null' : JSON.stringify(e.payload);
    this.db.prepare(
      'INSERT INTO journal (event_id, job_id, type, payload, created_at, acknowledged) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(eventId, e.jobId ?? null, e.type, payloadJson, createdAt, e.acknowledged ? 1 : 0);
    return {
      eventId,
      type: e.type,
      payload: e.payload === undefined ? null : e.payload,
      createdAt,
      acknowledged: e.acknowledged,
      ...(e.jobId ? { jobId: e.jobId } : {}),
    };
  }

  /**
   * Events strictly after `cursor` (exclusive), in replay order. A null cursor
   * returns the full history. Unknown cursors throw — replaying from a cursor that
   * no longer exists would silently lose events otherwise.
   */
  since(cursor: string | null): JournalEvent[] {
    if (cursor !== null) {
      const exists = this.db.prepare('SELECT 1 FROM journal WHERE event_id = ?').get(cursor);
      if (!exists) throw new Error(`journal: unknown cursor '${cursor}'`);
      const cursorSeq = cursorSeqValue(this.db, cursor);
      const rows = this.db.prepare(
        'SELECT * FROM journal WHERE seq > ? ORDER BY seq'
      ).all(cursorSeq) as Record<string, unknown>[];
      return rows.map(rowToEvent);
    }
    const rows = this.db.prepare('SELECT * FROM journal ORDER BY seq').all() as Record<string, unknown>[];
    return rows.map(rowToEvent);
  }

  acknowledge(eventId: string): void {
    this.db.prepare('UPDATE journal SET acknowledged = 1 WHERE event_id = ?').run(eventId);
  }
}

function cursorSeqValue(db: DatabaseHandle, cursor: string): number {
  const row = db.prepare('SELECT seq FROM journal WHERE event_id = ?').get(cursor) as
    | { seq: unknown }
    | undefined;
  return Number(row?.seq);
}

function rowToEvent(row: Record<string, unknown>): JournalEvent {
  return {
    eventId: String(row.event_id),
    ...(row.job_id == null ? {} : { jobId: String(row.job_id) }),
    type: String(row.type),
    payload: JSON.parse(String(row.payload)),
    createdAt: Number(row.created_at),
    acknowledged: Number(row.acknowledged) === 1,
  };
}
