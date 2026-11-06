// Automatic local memory (T09). SQLite + FTS5 with tombstone deletes.
// FTS5 MATCH never receives raw user input — queries are tokenized and quoted so
// FTS syntax characters (`NEAR(`, `"`, `*`, `-`) cannot crash the store.
// `search` excludes `secret`-tier entries unless explicitly requested.
import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from './database.js';

export type Sensitivity = 'public' | 'internal' | 'private' | 'secret';

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  sensitivity: Sensitivity;
  createdAt: number;
  deletedAt?: number;
}

export interface SearchOptions {
  /** Include `secret`-tier rows (default false; reserved for explicit broker-approved flows). */
  includeSecret?: boolean;
  /** Maximum number of rows returned (default 50). */
  limit?: number;
}

const VALID_SENSITIVITY: ReadonlySet<string> = new Set(['public', 'internal', 'private', 'secret']);

function normalizeSensitivity(raw: unknown): Sensitivity {
  return VALID_SENSITIVITY.has(String(raw)) ? (raw as Sensitivity) : 'internal';
}

/**
 * Reduce free-form user input to a safe FTS5 query: each alphanumeric token is
 * quoted as an exact phrase and joined implicitly with AND. Returns null when the
 * input contains no searchable tokens (caller skips the query entirely).
 */
export function safeFtsQuery(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.slice(0, 16).map(t => `"${t.replace(/"/g, '')}"`).join(' ');
}

export class MemoryStoreImpl {
  constructor(private db: DatabaseHandle) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memory_deleted_at ON memory(deleted_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content='memory', content_rowid='rowid');
    `);
  }

  add(e: Omit<MemoryEntry, 'id' | 'createdAt' | 'deletedAt'>): MemoryEntry {
    if (typeof e.content !== 'string' || e.content.length === 0) {
      throw new Error('memory: content must be a non-empty string');
    }
    const id = 'mem_' + randomUUID();
    const createdAt = Date.now();
    const sensitivity = normalizeSensitivity(e.sensitivity);
    // FTS index + table row must stay consistent: wrap in a transaction so a crash
    // cannot leave a stale index entry or a row without one.
    const tx = this.db.transaction(() => {
      this.db.prepare(
        'INSERT INTO memory (id, content, source, sensitivity, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, e.content, e.source, sensitivity, createdAt);
      this.db.prepare('INSERT INTO memory_fts (rowid, content) SELECT rowid, content FROM memory WHERE id = ?').run(id);
    });
    tx();
    return { id, content: e.content, source: e.source, sensitivity, createdAt };
  }

  search(q: string, opts: SearchOptions = {}): MemoryEntry[] {
    const query = safeFtsQuery(q);
    if (query === null) return [];
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const secretFilter = opts.includeSecret === true ? '' : `AND m.sensitivity != 'secret'`;
    const rows = this.db.prepare(
      `SELECT m.* FROM memory m JOIN memory_fts f ON f.rowid = m.rowid
       WHERE memory_fts MATCH ? AND m.deleted_at IS NULL ${secretFilter}
       ORDER BY m.created_at DESC LIMIT ?`
    ).all(query, limit) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  }

  delete(id: string): void {
    // tombstone + remove from fts, atomically
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE memory SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
      this.db.prepare('DELETE FROM memory_fts WHERE rowid = (SELECT rowid FROM memory WHERE id = ?)').run(id);
    });
    tx();
  }

  export(): MemoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM memory WHERE deleted_at IS NULL ORDER BY created_at').all() as Record<string, unknown>[];
    return rows.map(rowToMemory);
  }
}

function rowToMemory(row: Record<string, unknown>): MemoryEntry {
  const m: MemoryEntry = {
    id: String(row.id),
    content: String(row.content),
    source: String(row.source),
    sensitivity: normalizeSensitivity(row.sensitivity),
    createdAt: Number(row.created_at),
  };
  if (row.deleted_at != null) m.deletedAt = Number(row.deleted_at);
  return m;
}
