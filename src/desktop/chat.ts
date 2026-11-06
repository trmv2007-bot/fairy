// Chat service (main process): conversation state + gateway streaming + journal.
// Lives in the main process so API keys never cross the sandbox boundary; the
// renderer sees only text deltas and message ids via the typed bridge.
import { randomUUID } from 'node:crypto';
import { CloudRouteError } from '../providers/cloud.js';
import type { CloudChatMessage } from '../providers/cloud.js';
import type { ModelGateway } from '../providers/gateway.js';
import type { EventJournalImpl } from '../storage/journal.js';

export type RuntimeState = 'idle' | 'thinking' | 'working' | 'error' | 'paused';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatHooks {
  /** Streaming text delta for message `messageId`. */
  onChunk(messageId: string, delta: string): void;
  /** Runtime state transitions, surfaced to the orb. */
  onState(state: RuntimeState): void;
}

const SYSTEM_PROMPT =
  'You are Fairy, a proactive desktop assistant. Strong, dry, competent. Be concise and concrete.';
const MAX_HISTORY_MESSAGES = 24;
const MAX_USER_TEXT = 8_000;
// Chat reads general conversation — nothing private leaves without explicit scope.
const CHAT_DATA_SCOPES = ['public', 'internal'];

export class ChatService {
  private history: ChatTurn[] = [];
  private running = false;

  constructor(
    private readonly gatewayProvider: () => ModelGateway | null,
    private readonly journal: EventJournalImpl | null,
    private readonly hooks: ChatHooks,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  historySnapshot(): ChatTurn[] {
    return [...this.history];
  }

  clear(): void {
    if (this.running) throw new Error('cannot clear while a request is in flight');
    this.history = [];
    this.journal?.append({ type: 'chat.cleared', payload: null, acknowledged: false });
  }

  /**
   * Send one user turn. Streams assistant deltas to hooks.onChunk and resolves
   * with the final message. Throws on route/key/provider errors; the user turn
   * stays in history so the conversation can continue after a failure.
   */
  async send(userText: string): Promise<{ messageId: string; content: string; model: string }> {
    const text = userText.trim();
    if (text.length === 0) throw new Error('message must be non-empty');
    if (text.length > MAX_USER_TEXT) throw new Error(`message too long (max ${MAX_USER_TEXT} chars)`);
    if (this.running) throw new Error('a request is already in flight — wait for it to finish');
    const gateway = this.gatewayProvider();
    if (!gateway) throw new Error('no provider configured — add one in the Providers tab');

    const messageId = 'msg_' + randomUUID();
    this.history.push({ role: 'user', content: text });
    this.running = true;
    this.setState('thinking');
    let sawFirstChunk = false;
    try {
      const messages: CloudChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...this.history.slice(-MAX_HISTORY_MESSAGES).map(t => ({ role: t.role, content: t.content })),
      ];
      this.journal?.append({ type: 'chat.user', payload: { messageId, length: text.length }, acknowledged: false });
      const completion = await gateway.chat(messages, CHAT_DATA_SCOPES, false, delta => {
        if (!sawFirstChunk) {
          sawFirstChunk = true;
          this.setState('working');
        }
        this.hooks.onChunk(messageId, delta);
      });
      this.history.push({ role: 'assistant', content: completion.content });
      this.journal?.append({
        type: 'chat.assistant',
        payload: { messageId, length: completion.content.length, model: completion.model },
        acknowledged: false,
      });
      this.setState('idle');
      return { messageId, content: completion.content, model: completion.model };
    } catch (err) {
      this.setState('error');
      // Normalize: the renderer only needs the message, not stack traces.
      throw err instanceof CloudRouteError ? err : new Error(err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
    }
  }

  private setState(state: RuntimeState): void {
    this.hooks.onState(state);
  }
}
