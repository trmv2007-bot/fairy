// Conversation transcripts (v0.6): durable chat history in the same SQLite DB
// as the event journal. Conversations persist across restarts; ChatService
// appends turns as they enter its in-memory history, so "resume where you
// left off" is an exact replay, not a paraphrase.
//
// Tool turns (assistant tool_calls + role:'tool' results) are stored raw —
// restoring a conversation must restore the model's full context. Display
// layers filter them out.
import { randomUUID } from 'node:crypto';
import type { CloudToolCall } from '../providers/cloud.js';
import type { DatabaseHandle } from './database.js';

export interface StoredTurn {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant turns that invoked tools (JSON round-trip). */
  toolCalls?: CloudToolCall[];
  /** role:'tool' turns — matches the originating tool_call id. */
  toolCallId?: string;
  createdAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

const MAX_CONTENT = 100_000;
const MAX_TITLE = 120;
const MAX_TOOL_JSON = 200_000;

export class ConversationStore {
  /** Monotonic within-process timestamp: two conversations created in the same
   *  millisecond must still order deterministically (latest-wins). */
  private lastTs = 0;
  private nextTs(): number {
    this.lastTs = Math.max(Date.now(), this.lastTs + 1);
    return this.lastTs;
  }

  constructor(private db: DatabaseHandle) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, seq);
    `);
  }

  createConversation(title = ''): ConversationSummary {
    const now = this.nextTs();
    const id = 'conv_' + randomUUID();
    const safeTitle = title.slice(0, MAX_TITLE);
    this.db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, safeTitle, now, now);
    return { id, title: safeTitle, createdAt: now, updatedAt: now, messageCount: 0 };
  }

  /** Derive a conversation title from the first user turn. */
  static titleFrom(text: string): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > 48 ? oneLine.slice(0, 48) + '…' : oneLine;
  }

  /**
   * Append one turn to a conversation (and touch its updated_at). Assigns an
   * id when absent. The first user turn names the conversation if it is
   * still untitled.
   */
  appendTurn(conversationId: string, turn: Omit<StoredTurn, 'id' | 'createdAt'> & { id?: string }): StoredTurn {
    const conv = this.db.prepare('SELECT id, title FROM conversations WHERE id = ?').get(conversationId) as
      | { id: unknown; title: unknown }
      | undefined;
    if (!conv) throw new Error(`transcripts: unknown conversation '${conversationId}'`);
    const id = typeof turn.id === 'string' && turn.id.length > 0 ? turn.id : 'msg_' + randomUUID();
    const now = this.nextTs();
    const content = turn.content.slice(0, MAX_CONTENT);
    const toolCallsJson = turn.toolCalls !== undefined && turn.toolCalls.length > 0
      ? JSON.stringify(turn.toolCalls).slice(0, MAX_TOOL_JSON)
      : null;
    this.db.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, conversationId, turn.role, content, toolCallsJson, turn.toolCallId ?? null, now);
    // Untitled conversations take their name from the first user turn.
    const title = (conv.title === '' && turn.role === 'user')
      ? ConversationStore.titleFrom(turn.content).slice(0, MAX_TITLE)
      : String(conv.title);
    this.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, conversationId);
    return {
      id,
      role: turn.role,
      content,
      ...(turn.toolCalls !== undefined && turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
      ...(turn.toolCallId !== undefined ? { toolCallId: turn.toolCallId } : {}),
      createdAt: now,
    };
  }

  getTurns(conversationId: string): StoredTurn[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq',
    ).all(conversationId) as Record<string, unknown>[];
    return rows.map(rowToTurn);
  }

  listConversations(limit = 50): ConversationSummary[] {
    const capped = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    const rows = this.db.prepare(`
      SELECT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id) AS message_count
      FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?
    `).all(capped) as Record<string, unknown>[];
    return rows.map(rowToSummary);
  }

  /** Conversations whose title OR any message matches `query` (substring, case-insensitive via LIKE). */
  searchConversations(query: string, limit = 50): ConversationSummary[] {
    const q = query.trim();
    if (q.length === 0) return [];
    const pattern = `%${q.replace(/[%_\\]/g, c => '\\' + c)}%`;
    const capped = Math.max(1, Math.min(200, Math.floor(limit) || 50));
    const rows = this.db.prepare(`
      SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at, COUNT(m.id) AS message_count
      FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\'
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ?
    `).all(pattern, pattern, capped) as Record<string, unknown>[];
    return rows.map(rowToSummary);
  }

  latestConversationId(): string | undefined {
    const row = this.db.prepare(
      'SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1',
    ).get() as { id: unknown } | undefined;
    return row ? String(row.id) : undefined;
  }

  hasConversation(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id) !== undefined;
  }

  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }
}

function rowToTurn(row: Record<string, unknown>): StoredTurn {
  let toolCalls: CloudToolCall[] | undefined;
  if (typeof row.tool_calls === 'string' && row.tool_calls.length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.tool_calls);
      if (Array.isArray(parsed)) toolCalls = parsed as CloudToolCall[];
    } catch { /* corrupt row degrades to a plain turn, never crashes restore */ }
  }
  return {
    id: String(row.id),
    role: row.role === 'user' || row.role === 'tool' ? (row.role as 'user' | 'tool') : 'assistant',
    content: String(row.content),
    createdAt: Number(row.created_at),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(row.tool_call_id != null ? { toolCallId: String(row.tool_call_id) } : {}),
  };
}

function rowToSummary(row: Record<string, unknown>): ConversationSummary {
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    messageCount: Number(row.message_count ?? 0),
  };
}
