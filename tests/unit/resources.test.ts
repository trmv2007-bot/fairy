import { describe, it, expect } from 'vitest';
import { ResourceGovernor } from '../../src/runtime/resources.js';

describe('ResourceGovernor', () => {
  it('allows one heavy job at a time', () => {
    const g = new ResourceGovernor();
    expect(g.acquireHeavy()).toBe(true);
    expect(g.acquireHeavy()).toBe(false);
    expect(g.canRunHeavy()).toBe(false);
    g.releaseHeavy();
    expect(g.acquireHeavy()).toBe(true);
  });

  it('reclaims a stale heavy slot (crashed job cannot block forever)', () => {
    const g = new ResourceGovernor(30); // 30ms staleness
    // Drive the whole scenario on one injected clock: noon is outside the
    // 23:00–07:00 quiet window, so quiet hours cannot pollute the assertion,
    // and injected timestamps make the staleness math deterministic.
    const noon = new Date('2026-06-15T12:00:00');
    expect(g.acquireHeavy(noon)).toBe(true);
    const later = new Date(noon.getTime() + 60_000); // +60s ≫ 30ms TTL
    // the crashed job never released — but the slot self-heals
    expect(g.canRunHeavy(later)).toBe(true);
    expect(g.acquireHeavy(later)).toBe(true);
  });

  it('a fresh heavy slot is not reclaimed', () => {
    const g = new ResourceGovernor(60_000);
    g.acquireHeavy();
    expect(g.canRunHeavy()).toBe(false);
  });

  it('quiet hours block heavy work outside the slot logic', () => {
    const g = new ResourceGovernor();
    const quietNight = new Date(2026, 0, 15, 2, 0, 0); // 02:00 — inside 23:00–07:00
    const daytime = new Date(2026, 0, 15, 12, 0, 0);   // 12:00 — allowed
    expect(g.canRunHeavy(quietNight)).toBe(false);
    expect(g.canRunHeavy(daytime)).toBe(true);
  });

  it('quiet window wrapping midnight is honored', () => {
    const g = new ResourceGovernor();
    const lateEvening = new Date(2026, 0, 15, 23, 30, 0); // 23:30 — quiet
    const earlyMorning = new Date(2026, 0, 15, 6, 59, 0); // 06:59 — quiet
    const morning = new Date(2026, 0, 15, 7, 0, 0);       // 07:00 — allowed
    expect(g.canRunHeavy(lateEvening)).toBe(false);
    expect(g.canRunHeavy(earlyMorning)).toBe(false);
    expect(g.canRunHeavy(morning)).toBe(true);
  });
});
