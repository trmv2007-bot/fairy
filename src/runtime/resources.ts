// Resource policy (§9, T14). One heavy job at a time; quiet hours; gpu pause.
export class ResourceGovernor {
  private heavyRunning = false;
  private heavyAcquiredAt: number | null = null;
  private quietStart = 23; // 23:00
  private quietEnd = 7;    // 07:00
  /**
   * A heavy job that never calls releaseHeavy() (crash, lost promise, bug) would
   * otherwise block heavy work forever. After `staleMs` the slot self-heals:
   * canRunHeavy/acquireHeavy treat the run as dead and reclaim the slot.
   */
  private staleMs: number;
  private static readonly DEFAULT_STALE_MS = 30 * 60 * 1000; // 30 min

  constructor(staleMs: number = ResourceGovernor.DEFAULT_STALE_MS) {
    this.staleMs = staleMs;
  }

  canRunHeavy(now = new Date()): boolean {
    if (this.heavyRunning && !this.heavyStale()) return false;
    const h = now.getHours();
    const quiet = this.quietStart <= this.quietEnd
      ? (h >= this.quietStart && h < this.quietEnd)
      : (h >= this.quietStart || h < this.quietEnd);
    return !quiet;
  }
  acquireHeavy(now = new Date()): boolean {
    if (this.heavyRunning && !this.heavyStale(now.getTime())) return false;
    this.heavyRunning = true;
    this.heavyAcquiredAt = now.getTime();
    return true;
  }
  releaseHeavy(): void {
    this.heavyRunning = false;
    this.heavyAcquiredAt = null;
  }
  private heavyStale(nowMs: number = Date.now()): boolean {
    return this.heavyAcquiredAt !== null && nowMs - this.heavyAcquiredAt > this.staleMs;
  }
}
