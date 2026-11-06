import { describe, it, expect } from 'vitest';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { MemoryStoreImpl } from '../../src/storage/memory.js';

describe('T09 memory', () => {
  it('adds and searches', () => {
    const db = openInMemoryDatabase();
    const m = new MemoryStoreImpl(db);
    m.add({ content: 'user prefers concise answers', source: 'chat', sensitivity: 'internal' });
    const r = m.search('concise');
    expect(r.length).toBe(1);
    expect(r[0]!.content).toContain('concise');
  });

  it('delete removes from retrieval', () => {
    const db = openInMemoryDatabase();
    const m = new MemoryStoreImpl(db);
    const e = m.add({ content: 'secret preference', source: 'chat', sensitivity: 'private' });
    m.delete(e.id);
    const r = m.search('secret');
    expect(r.length).toBe(0);
  });

  it('export excludes deleted', () => {
    const db = openInMemoryDatabase();
    const m = new MemoryStoreImpl(db);
    const e = m.add({ content: 'x', source: 'chat', sensitivity: 'public' });
    m.delete(e.id);
    expect(m.export().length).toBe(0);
  });
});
