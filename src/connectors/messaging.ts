// Messaging/community (T26).
export interface MessagingConnector { summarize(channel: string): Promise<string>; sendReply(channel: string, body: string): Promise<{ sentOnce: boolean }>; }
