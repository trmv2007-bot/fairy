import Database from 'better-sqlite3';

export interface DatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export function openDatabase(path: string): DatabaseHandle {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db as unknown as DatabaseHandle;
}

export function openInMemoryDatabase(): DatabaseHandle {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db as unknown as DatabaseHandle;
}
