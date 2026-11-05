// Resource policy (§9, T14). One heavy job at a time; quiet hours; gpu pause.
export class ResourceGovernor {
  private heavyRunning = false;
  private quietStart = 23; // 23:00
  private quietEnd = 7;    // 07:00
  canRunHeavy(now = new Date()): boolean {
    if (this.heavyRunning) return false;
    const h = now.getHours();
    const quiet = this.quietStart <= this.quietEnd
      ? (h >= this.quietStart && h < this.quietEnd)
      : (h >= this.quietStart || h < this.quietEnd);
    return !quiet;
  }
  acquireHeavy(): boolean { if (this.heavyRunning) return false; this.heavyRunning = true; return true; }
  releaseHeavy(): void { this.heavyRunning = false; }
}
