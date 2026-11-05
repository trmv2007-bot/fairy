// Local memory store (T09). Scaffold only.
export interface MemoryEntry { id: string; content: string; source: string; sensitivity: 'public' | 'internal' | 'private' | 'secret'; createdAt: number; deletedAt?: number; }
export interface MemoryStore {
  add(e: Omit<MemoryEntry, 'id' | 'createdAt'>): MemoryEntry;
  search(q: string): MemoryEntry[];
  delete(id: string): void;
  export(): MemoryEntry[];
}
