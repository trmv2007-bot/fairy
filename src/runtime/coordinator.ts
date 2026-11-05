// Coordinator: converts requests/events into bounded jobs (T14). Scaffold.
export interface Coordinator { enqueue(job: { goal: string; origin: string }): string; }
