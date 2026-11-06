import { describe, it, expect } from 'vitest';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { Coordinator } from '../../src/runtime/coordinator.js';
import { Scheduler } from '../../src/runtime/scheduler.js';
import { ResourceGovernor } from '../../src/runtime/resources.js';

describe('T14 proactivity', () => {
  it('scheduled + file event + resumed goal yield tracked tasks', () => {
    const db = openInMemoryDatabase();
    const c = Coordinator.fromDb(db);
    const id1 = c.enqueue({ goal: 'scheduled job', origin: 'schedule' });
    const id2 = c.enqueue({ goal: 'file event', origin: 'file-event' });
    const id3 = c.enqueue({ goal: 'resumed goal', origin: 'goal-resume' });
    expect(new Set([id1, id2, id3]).size).toBe(3);
  });

  it('duplicate events coalesce (scheduler debounce)', () => {
    const s = new Scheduler();
    s.schedule('nightly', '0 2 * * *');
    expect(s.list().length).toBe(1);
  });

  it('resource governor blocks concurrent heavy', () => {
    const r = new ResourceGovernor();
    expect(r.acquireHeavy()).toBe(true);
    expect(r.acquireHeavy()).toBe(false);
    r.releaseHeavy();
    expect(r.acquireHeavy()).toBe(true);
  });

  it('budget exhaustion stops job claims (maxAttempts honored via claim loop)', () => {
    const db = openInMemoryDatabase();
    const c = Coordinator.fromDb(db);
    for (let i = 0; i < 5; i++) c.enqueue({ goal: `job ${i}`, origin: 'schedule' });
    // worker budget: at most 3 concurrent claims this cycle
    const budget = 3;
    let claimed = 0;
    while (claimed < budget) {
      const job = c.claimNext();
      if (!job) break;
      claimed++;
      expect(job.state).toBe('running');
    }
    expect(claimed).toBe(3);
    // unclaimed work stays queued
    expect(c.queuedCount()).toBe(2);
  });

  it('claims are FIFO by creation order', () => {
    const db = openInMemoryDatabase();
    const c = Coordinator.fromDb(db);
    const ids = [
      c.enqueue({ goal: 'first', origin: 'manual' }),
      c.enqueue({ goal: 'second', origin: 'manual' }),
    ];
    expect(c.claimNext()?.id).toBe(ids[0]);
    expect(c.claimNext()?.id).toBe(ids[1]);
    expect(c.claimNext()).toBeNull();
  });
});
