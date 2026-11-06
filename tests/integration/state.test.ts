import { describe, it, expect } from 'vitest';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { JobStore } from '../../src/storage/jobs.js';
import { EventJournalImpl } from '../../src/storage/journal.js';
import { Coordinator } from '../../src/runtime/coordinator.js';
import type { Job } from '../../src/contracts/jobs.js';

describe('T06 state persistence', () => {
  it('creates and retrieves a job', () => {
    const db = openInMemoryDatabase();
    const store = new JobStore(db);
    const job: Job = {
      id: 'job-1',
      origin: 'schedule',
      goal: 'test',
      scopeIds: ['s1'],
      state: 'queued',
      resourceBudget: { timeoutMs: 1000 },
      evidenceRefs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.create(job);
    const got = store.get('job-1');
    expect(got?.goal).toBe('test');
    expect(got?.state).toBe('queued');
  });

  it('updates job state', () => {
    const db = openInMemoryDatabase();
    const store = new JobStore(db);
    const job: Job = {
      id: 'job-2', origin: 'manual', goal: 'g', scopeIds: [], state: 'queued',
      resourceBudget: {}, evidenceRefs: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.create(job);
    store.updateState('job-2', 'running');
    expect(store.get('job-2')?.state).toBe('running');
  });

  it('journal appends and acknowledges', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    const ev = j.append({ type: 'job.started', payload: { id: 'job-1' }, acknowledged: false });
    expect(ev.eventId).toMatch(/^ev_/);
    const list = j.since(null);
    expect(list.length).toBe(1);
    j.acknowledge(ev.eventId);
    const list2 = j.since(null);
    expect(list2[0]!.acknowledged).toBe(true);
  });

  it('restart recovery: running jobs become outcome-unknown and can be re-queued once', () => {
    const db = openInMemoryDatabase();
    const coordinator = Coordinator.fromDb(db);
    const id = coordinator.enqueue({ goal: 'interrupted work', origin: 'manual' });
    coordinator.claimNext();
    expect(coordinator.get(id)?.state).toBe('running');

    // simulate crash + restart: same db, new coordinator instance
    const restarted = Coordinator.fromDb(db);
    const interrupted = restarted.markInterruptedAsUnknown();
    expect(interrupted).toBe(1);
    expect(restarted.get(id)?.state).toBe('outcome-unknown');

    // resumption is explicit and transitions through the queue
    expect(restarted.resume(id)).toBe(true);
    expect(restarted.get(id)?.state).toBe('queued');
    expect(restarted.resume(id)).toBe(false); // queued -> queued is not a valid transition
  });

  it('invalid state transitions are rejected', () => {
    const db = openInMemoryDatabase();
    const coordinator = Coordinator.fromDb(db);
    const id = coordinator.enqueue({ goal: 'g', origin: 'manual' });
    // queued -> succeeded is not a legal transition
    expect(coordinator.transition(id, 'succeeded')).toBeNull();
    expect(coordinator.get(id)?.state).toBe('queued');
    // succeeded jobs are terminal
    coordinator.claimNext();
    expect(coordinator.transition(id, 'succeeded')).not.toBeNull();
    expect(coordinator.transition(id, 'running')).toBeNull();
    expect(coordinator.get(id)?.state).toBe('succeeded');
  });

  it('enqueue rejects empty goals and origins', () => {
    const db = openInMemoryDatabase();
    const coordinator = Coordinator.fromDb(db);
    expect(() => coordinator.enqueue({ goal: '   ', origin: 'manual' })).toThrow(/non-empty/);
    expect(() => coordinator.enqueue({ goal: 'g', origin: '' })).toThrow(/non-empty/);
  });
});
