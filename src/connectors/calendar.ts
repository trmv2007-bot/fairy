// Calendar (T23).
export interface CalendarConnector { readEvent(id: string): Promise<unknown>; proposeChange(id: string, change: unknown): Promise<unknown>; }
