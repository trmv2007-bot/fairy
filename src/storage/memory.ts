import type { DatabaseHandle } from './database.js';

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  sensitivity: 'public' | 'internal' | 'private' | 'secret';
  createdAt: number;
  deletedAt?: number;
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
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content='memory', content_rowid='rowid');
    `);
  }

  add(e: Omit<MemoryEntry, 'id' | 'createdAt' | 'deletedAt'>): MemoryEntry {
    const id = 'mem_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const createdAt = Date.now();
    this.db.prepare(
      'INSERT INTO memory (id, content, source, sensitivity, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, e.content, e.source, e.sensitivity, createdAt);
    // keep fts in sync
    this.db.prepare('INSERT INTO memory_fts (rowid, content) SELECT rowid, content FROM memory WHERE id = ?').run(id);
    return { id, content: e.content, source: e.source, sensitivity: e.sensitivity, createdAt };
  }

  search(q: string): MemoryEntry[] {
    const rows = this.db.prepare(
      `SELECT m.* FROM memory m JOIN memory_fts f ON f.rowid = m.rowid
       WHERE memory_fts MATCH ? AND m.deleted_at IS NULL`
    ).all(q) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  }

  delete(id: string): void {
    // tombstone + remove from fts
    this.db.prepare('UPDATE memory SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
    this.db.prepare('DELETE FROM memory_fts WHERE rowid = (SELECT rowid FROM memory WHERE id = ?)').run(id);
  }

  export(): MemoryEntry[] {
    const rows = this.db.prepare('SELECT * FROM memory WHERE deleted_at IS NULL').all() as Record<string, unknown>[];
    return rows.map(rowToMemory);
  }
}

function rowToMemory(row: Record<string, unknown>): MemoryEntry {
  const m: MemoryEntry = {
    id: String(row.id),
    content: String(row.content),
    source: String(row.source),
    sensitivity: String(row.sensitivity) as MemoryEntry['sensitivity'],
    createdAt: Number(row.created_at),
  };
  if (row.deleted_at != null) m.deletedAt = Number(row.deleted_at);
  return m;
}
