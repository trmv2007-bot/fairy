// Durable event journal (T06).
export interface JournalEvent { eventId: string; jobId?: string; type: string; payload: unknown; createdAt: number; acknowledged: boolean; }
export interface EventJournal {
  append(e: Omit<JournalEvent, 'eventId' | 'createdAt'>): JournalEvent;
  since(cursor: string | null): JournalEvent[];
  acknowledge(eventId: string): void;
}
