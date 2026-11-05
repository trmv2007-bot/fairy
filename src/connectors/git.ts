// Git hosting/developer (T25). Read issue; hold push/comment/PR for approval.
export interface GitServiceConnector { readIssue(id: string): Promise<unknown>; createPr(input: unknown): Promise<{ held: true }>; }
