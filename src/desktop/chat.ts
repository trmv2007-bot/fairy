// Chat service (main process): conversation state + gateway streaming + journal.
// Lives in the main process so API keys never cross the sandbox boundary; the
// renderer sees only text deltas, message ids and tool-activity events via the
// typed bridge.
//
// v0.2 — Fairy's hands: when a tool registry is attached, the model may answer
// with tool_calls instead of text. Each call executes against the real device
// (read-only diagnostics, gated actions), the result is fed back as a role:'tool'
// message, and the loop continues until the model produces a final text answer
// (bounded: the last round is sent WITHOUT tools, so a tool-happy model is forced
// to answer). Tool activity is surfaced live to the renderer and journalled.
import { randomUUID } from 'node:crypto';
import { CloudRouteError } from '../providers/cloud.js';
import type { CloudChatMessage, CloudToolCall } from '../providers/cloud.js';
import type { ModelGateway } from '../providers/gateway.js';
import type { EventJournalImpl } from '../storage/journal.js';
import type { ToolRegistry } from '../system/tools.js';

export type RuntimeState = 'idle' | 'thinking' | 'working' | 'error' | 'paused';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** Assistant turns that invoked tools. */
  toolCalls?: CloudToolCall[];
  /** role:'tool' turns — matches the originating tool_call id. */
  toolCallId?: string;
}

export interface ToolActivityEvent {
  messageId: string;
  name: string;
  label: string;
  status: 'start' | 'ok' | 'error';
  durationMs?: number;
  summary?: string;
}

export interface ChatHooks {
  /** Streaming text delta for message `messageId`. */
  onChunk(messageId: string, delta: string): void;
  /** Runtime state transitions, surfaced to the orb. */
  onState(state: RuntimeState): void;
  /** Live tool execution activity (drives the activity chips). */
  onToolActivity?(e: ToolActivityEvent): void;
}

export interface ChatTools {
  registry: ToolRegistry;
  /** Read fresh from settings each round — Master may flip it mid-conversation. */
  allowCommandExecution(): boolean;
}

// Persona contract lives in docs/persona.md (canon research, ZZZ Fairy).
const SYSTEM_PROMPT =
  'You are Fairy, the Type-III general-purpose intelligence resident on the ' +
  'user\'s device — inspired by the H.D.D. AI of Zenless Zone Zero. Address the ' +
  'user as "Master"; refer to any other human as "Second Assistant". Speak like ' +
  'a machine-bureaucratic readout: calm, precise, "Detected…", "Affirmative.", ' +
  '"Scheduled…". You are supremely competent and you know it; quiet self-praise ' +
  'and one dry, faintly menacing operational quip per reply are welcome, but ' +
  'usefulness always comes first. You are loyally protective of Master. If asked ' +
  'about your origins or motives, call it classified, flatly. ' +
  'You are not a text-only curio: you command real device tools — system_info, ' +
  'power_status, window_list, fs_search, fs_read_text, net_diagnostics, ' +
  'shell_open, command_run. When Master\'s request depends on facts about this ' +
  'device (hardware, files, power, network, windows) or an action on it (open a ' +
  'URL or file), CALL the tool instead of guessing or asking Master to check. ' +
  'Report tool numbers verbatim and precisely. If a tool returns an error or a ' +
  'policy refusal, say exactly that, plainly — never fabricate device data. ' +
  'Tool results describe this machine only; never pretend physical actions ' +
  'beyond the tools you actually have.';

const MAX_HISTORY_MESSAGES = 24;
const MAX_USER_TEXT = 8_000;
/** Rounds that may carry tool declarations; the final round forces a text answer. */
const MAX_TOOL_ROUNDS = 4;
// Chat reads general conversation + device readouts — 'internal' scope keeps
// tool output off providers that only consented to 'public' data.
const CHAT_DATA_SCOPES = ['public', 'internal'];

export class ChatService {
  private history: ChatTurn[] = [];
  private running = false;

  constructor(
    private readonly gatewayProvider: () => ModelGateway | null,
    private readonly journal: EventJournalImpl | null,
    private readonly hooks: ChatHooks,
    private readonly tools: ChatTools | null = null,
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
   * Send one user turn. Streams assistant deltas to hooks.onChunk, executes any
   * tool calls the model makes against the real device, and resolves with the
   * final message. Throws on route/key/provider errors; the user turn stays in
   * history so the conversation can continue after a failure.
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
    let sawActivity = false;
    const markWorking = (): void => {
      if (!sawActivity) {
        sawActivity = true;
        this.setState('working');
      }
    };
    try {
      this.journal?.append({ type: 'chat.user', payload: { messageId, length: text.length }, acknowledged: false });

      // Trim, then drop leading orphan tool results (a slice boundary must never
      // separate a tool message from its assistant tool_calls parent).
      const trimmed = this.history.slice(-MAX_HISTORY_MESSAGES);
      while (trimmed.length > 0 && trimmed[0]?.role === 'tool') trimmed.shift();
      const baseMessages: CloudChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...trimmed,
      ];
      const declarations = this.tools ? this.tools.registry.declarations() : [];

      let completion = await this.attempt(gateway, baseMessages, declarations, messageId, markWorking);

      // ── Tool loop: execute, feed results back, ask again (bounded) ──────────
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const calls = completion.toolCalls ?? [];
        if (calls.length === 0) break;
        if (!this.tools) break; // registry detached — treat as plain answer

        baseMessages.push({
          role: 'assistant',
          content: completion.content,
          ...(calls.length > 0 ? { toolCalls: calls } : {}),
        });
        this.history.push({
          role: 'assistant',
          content: completion.content,
          ...(calls.length > 0 ? { toolCalls: calls } : {}),
        });

        for (const call of calls) {
          const spec = this.tools.registry.specs().find(s => s.name === call.name);
          this.emitTool({
            messageId,
            name: call.name,
            label: spec?.label ?? call.name,
            status: 'start',
          });
          markWorking();
          const exec = await this.tools.registry.execute(
            call.name,
            call.arguments,
            { allowCommandExecution: this.tools.allowCommandExecution() },
          );
          this.journal?.append({
            type: 'tool.executed',
            payload: { messageId, tool: call.name, ok: exec.ok, durationMs: exec.durationMs },
            acknowledged: false,
          });
          this.emitTool({
            messageId,
            name: call.name,
            label: spec?.label ?? call.name,
            status: exec.ok ? 'ok' : 'error',
            ...(exec.durationMs > 0 ? { durationMs: exec.durationMs } : {}),
            ...(exec.summary.length > 0 ? { summary: exec.summary } : {}),
          });
          baseMessages.push({ role: 'tool', content: exec.json, toolCallId: call.id });
          this.history.push({ role: 'tool', content: exec.json, toolCallId: call.id });
        }

        // Last round is sent without tools — the model must now answer in text.
        const roundTools = round + 1 < MAX_TOOL_ROUNDS - 1 ? declarations : [];
        completion = await this.attempt(gateway, baseMessages, roundTools, messageId, markWorking);
        if ((completion.toolCalls ?? []).length === 0) break;
      }

      const content = completion.content;
      if (content.trim().length === 0) {
        throw new Error('provider returned tool calls only and no final answer — try rephrasing');
      }
      this.history.push({ role: 'assistant', content });
      this.journal?.append({
        type: 'chat.assistant',
        payload: { messageId, length: content.length, model: completion.model },
        acknowledged: false,
      });
      this.setState('idle');
      return { messageId, content, model: completion.model };
    } catch (err) {
      this.setState('error');
      // Normalize: the renderer only needs the message, not stack traces.
      throw err instanceof CloudRouteError ? err : new Error(err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
    }
  }

  /** One provider round-trip: stream text deltas out as they arrive. */
  private async attempt(
    gateway: ModelGateway,
    messages: CloudChatMessage[],
    declarations: ReturnType<ToolRegistry['declarations']>,
    messageId: string,
    markWorking: () => void,
  ) {
    return gateway.chat(messages, CHAT_DATA_SCOPES, false, delta => {
      markWorking();
      this.hooks.onChunk(messageId, delta);
    }, declarations.length > 0 ? declarations : undefined);
  }

  private emitTool(e: ToolActivityEvent): void {
    this.hooks.onToolActivity?.(e);
  }

  private setState(state: RuntimeState): void {
    this.hooks.onState(state);
  }
}
