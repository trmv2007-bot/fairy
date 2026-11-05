// Email (T22). Read vs send separate; send holds for exact approval.
export interface MailConnector { summarize(messageId: string): Promise<string>; prepareReply(messageId: string, body: string): Promise<{ draftId: string }>; send(draftId: string): Promise<{ sentOnce: boolean }>; }
