// Remote machine (T28).
export interface RemoteMachineConnector { runScoped(machineId: string, cmd: string): Promise<{ output: string; denied?: boolean }>; }
