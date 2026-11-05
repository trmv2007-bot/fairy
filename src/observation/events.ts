// Approved app/file events (T10/T14). Debounced, coalesced, self-output suppressed.
export interface EventSource { name: string; }
export class EventCoalescer {
  private pending = new Map<string, unknown>();
  queue(key: string, payload: unknown): void { this.pending.set(key, payload); }
  flush(): { key: string; payload: unknown }[] {
    const out = [...this.pending.entries()].map(([key, payload]) => ({ key, payload }));
    this.pending.clear();
    return out;
  }
}
