// Task services (T24).
export interface TaskServiceConnector { roundTrip(task: { title: string }): Promise<{ remoteId: string }>; }
