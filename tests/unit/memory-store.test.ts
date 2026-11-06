import { describe, it, expect } from 'vitest';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { MemoryStoreImpl, safeFtsQuery } from '../../src/storage/memory.js';

describe('MemoryStoreImpl', () => {
  it('adds and finds content', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    m.add({ content: 'user prefers concise answers', source: 'chat', sensitivity: 'internal' });
    expect(m.search('concise')[0]?.content).toContain('concise');
  });

  it('secret-tier entries are excluded from default search results', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    m.add({ content: 'public note alpha', source: 'chat', sensitivity: 'public' });
    m.add({ content: 'alpha secret key material', source: 'chat', sensitivity: 'secret' });
    expect(m.search('alpha').map(e => e.sensitivity)).toEqual(['public']);
    // explicit override still works (broker-approved flows only)
    expect(m.search('alpha', { includeSecret: true }).length).toBe(2);
  });

  it('FTS syntax characters in queries do not crash the store', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    m.add({ content: 'plain text here', source: 'chat', sensitivity: 'public' });
    const hostile = ['"quoted phrase"', 'NEAR(a b)', '-negated', 'star*', 'a OR b', '(', ')', 'x**y', ''];
    for (const q of hostile) expect(() => m.search(q)).not.toThrow();
    expect(m.search('plain').length).toBe(1);
  });

  it('queries with no searchable tokens return empty, not an error', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    expect(m.search('!!!')).toEqual([]);
    expect(m.search('   ')).toEqual([]);
    expect(safeFtsQuery('!!!')).toBeNull();
  });

  it('delete removes from fts and export atomically', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    const e = m.add({ content: 'to be removed', source: 'chat', sensitivity: 'private' });
    m.delete(e.id);
    expect(m.search('removed')).toEqual([]);
    expect(m.export().length).toBe(0);
  });

  it('invalid sensitivity is normalized to internal', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    const e = m.add({ content: 'x', source: 'chat', sensitivity: 'top-secret-hah' as never });
    expect(e.sensitivity).toBe('internal');
  });

  it('empty content is rejected', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    expect(() => m.add({ content: '', source: 'chat', sensitivity: 'public' })).toThrow(/non-empty/);
  });
});
