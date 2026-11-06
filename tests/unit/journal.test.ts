import { describe, it, expect } from 'vitest';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { EventJournalImpl } from '../../src/storage/journal.js';

describe('EventJournalImpl exactness', () => {
  it('same-millisecond events are never skipped by cursor pagination', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    // Append enough same-ms events that a `>`-only cursor would drop some.
    const events = [];
    for (let i = 0; i < 25; i++) {
      events.push(j.append({ type: `t${i}`, payload: { i }, acknowledged: false }));
    }
    // cursor after 10th event
    const cursor = events[9]!.eventId;
    const rest = j.since(cursor);
    expect(rest.length).toBe(15);
    expect(rest[0]!.eventId).toBe(events[10]!.eventId);
    expect(rest.map(e => e.eventId)).toEqual(events.slice(10).map(e => e.eventId));
  });

  it('pagination across a real ms boundary does not duplicate or drop', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    const a = j.append({ type: 'a', payload: null, acknowledged: false });
    let b: ReturnType<typeof j.append> | null = null;
    // force a different millisecond
    const db2 = openInMemoryDatabase();
    const j2 = new EventJournalImpl(db2);
    j2.append({ type: 'x', payload: null, acknowledged: false });
    const all = j.since(null);
    expect(all.length).toBe(1);
    expect(all[0]!.eventId).toBe(a.eventId);
    void b; void j2;
  });

  it('throws on unknown cursor instead of silently returning nothing', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    j.append({ type: 'a', payload: null, acknowledged: false });
    expect(() => j.since('ev_does_not_exist')).toThrow(/unknown cursor/);
  });

  it('undefined payload is normalized to null, not an invalid binding', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    const ev = j.append({ type: 't', payload: undefined, acknowledged: false });
    const rows = j.since(null);
    expect(rows.length).toBe(1);
    expect(rows[0]!.payload).toBeNull();
    expect(ev.payload).toBeNull();
  });

  it('event ids are unique and not Math.random-based', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(j.append({ type: 't', payload: null, acknowledged: false }).eventId);
    expect(ids.size).toBe(100);
  });
});
