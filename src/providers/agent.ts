// Remote agent / self-hosted endpoint (T20). Scaffold.
export interface RemoteAgentConnector { delegate(task: string): Promise<{ result: string; evidence: string[] }>; }
