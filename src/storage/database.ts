// SQLite-backed durable store (T06). Placeholder scaffold; real better-sqlite3 wiring in T06.
export interface DatabaseHandle {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): { changes: number }; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}
export function openDatabase(_path: string): DatabaseHandle {
  throw new Error('openDatabase: not implemented yet (T06). Use in-memory fake in tests.');
}
