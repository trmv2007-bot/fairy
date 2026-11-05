// Phone companion (T27).
export interface PhoneConnector { notify(deviceId: string, msg: string): Promise<void>; revoke(deviceId: string): void; }
