// Existing-subscription connector (T19). Scaffold.
export interface SubscriptionConnector { runIncludedTask(prompt: string): Promise<string>; }
