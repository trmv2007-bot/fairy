// Scheduler with quiet hours, dedup, cooldown (T14). Scaffold.
export interface Scheduler { schedule(name: string, cron: string): void; }
