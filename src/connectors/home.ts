// Home services/devices (T29).
export interface HomeConnector { readState(deviceId: string): Promise<unknown>; applyHarmlessChange(deviceId: string, change: unknown): Promise<{ ok: boolean }>; }
