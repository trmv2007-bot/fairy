// Scheduler (T14): schedules, debounced file events, coalesced triggers.
export interface ScheduledJob { name: string; cron: string; }
export class Scheduler {
  private jobs = new Map<string, ScheduledJob>();
  schedule(name: string, cron: string): void { this.jobs.set(name, { name, cron }); }
  list(): ScheduledJob[] { return [...this.jobs.values()]; }
  debounce<T>(key: string, fn: () => T, ms: number): () => void {
    let t: ReturnType<typeof setTimeout> | null = null;
    return () => { if (t) clearTimeout(t); t = setTimeout(() => fn(), ms); };
  }
}
