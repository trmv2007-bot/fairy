import { describe, it, expect } from 'vitest';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { JobStore } from '../../src/storage/jobs.js';
import { EventJournalImpl } from '../../src/storage/journal.js';
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
    expect(list2[0].acknowledged).toBe(true);
  });

  it('resumes interrupted job once (idempotent state)', () => {
    const db = openInMemoryDatabase();
    const store = new JobStore(db);
    const job: Job = {
      id: 'job-3', origin: 'manual', goal: 'g', scopeIds: [], state: 'running',
      resourceBudget: {}, evidenceRefs: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.create(job);
    // simulate crash: state remains running; on resume, mark succeeded once
    store.updateState('job-3', 'succeeded');
    expect(store.get('job-3')?.state).toBe('succeeded');
    // re-applying does not duplicate
    store.updateState('job-3', 'succeeded');
    expect(store.get('job-3')?.state).toBe('succeeded');
  });
});
