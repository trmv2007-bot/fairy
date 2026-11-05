// MCP tool connection (T21). Allowlisted stdio/remote behind connector host.
export interface McpConnection { serverId: string; tools: string[]; }
export class McpConnector { async connect(_cmd: string): Promise<McpConnection> { return { serverId: 'mcp', tools: [] }; } }
