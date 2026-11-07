// Chat controller hook (v0.5 remodel): the stateful side of the conversation,
// lifted out of the old Chat component so the command bar can live at the top
// of the panel while the history renders in a collapsible section below it.
// Pure glue over the typed bridge — all routing/streaming logic stays in the
// main process.
// v0.6: durable transcripts — resumes the latest conversation on mount and
// exposes the archived-conversation list (search / open / delete).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageWire, ConversationWire, ToolActivityEvent } from '../bridge.js';

export interface ToolChip {
  key: number;
  name: string;
  label: string;
  status: 'start' | 'ok' | 'error';
  durationMs?: number;
  summary?: string;
}

export interface ChatController {
  messages: ChatMessageWire[];
  streaming: boolean;
  error: string | null;
  tools: ToolChip[];
  /** Durable conversations, newest first (v0.6). */
  conversations: ConversationWire[];
  /** Transcript the visible messages belong to ('' = ephemeral / none). */
  activeConversationId: string;
  /** Sends one user message; streams the reply through the controller state. */
  send(text: string): Promise<void>;
  /** Archives the live conversation and starts fresh (nothing durable deleted). */
  clear(): Promise<void>;
  /** Reload the conversation list. */
  refreshConversations(): Promise<void>;
  /** Load a transcript into the live view (null = most recent). */
  openConversation(id: string | null): Promise<void>;
  /** Search archived conversations (empty query = full list). */
  searchConversations(query: string): Promise<void>;
  /** Permanently delete one transcript. */
  deleteConversation(id: string): Promise<void>;
}

export function useChat(): ChatController {
  const [messages, setMessages] = useState<ChatMessageWire[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolChip[]>([]);
  const [conversations, setConversations] = useState<ConversationWire[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const streamingRef = useRef(false);
  streamingRef.current = streaming;

  const refreshConversations = useCallback(async () => {
    try {
      const res = await window.fairy.chat.history();
      if (res.ok && res.conversations) setConversations(res.conversations);
    } catch { /* list stays stale; chat still works */ }
  }, []);

  useEffect(() => {
    // Resume where Master left off: the latest transcript re-enters the live
    // view on mount (the main process already resumed its model context).
    let alive = true;
    window.fairy.chat.open(null).then(res => {
      if (!alive) return;
      if (res.ok && res.messages && res.messages.length > 0) {
        setMessages(res.messages);
        setActiveConversationId(res.id ?? '');
      }
    }).catch(() => { /* first run — nothing to resume */ }).finally(() => {
      if (alive) void refreshConversations();
    });
    return () => { alive = false; };
  }, [refreshConversations]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || streamingRef.current) return;
    setError(null);
    setTools([]); // one activity log per outgoing turn
    const localId = 'local_' + Date.now().toString(36);
    setMessages(m => [...m, { id: localId, role: 'user', content: trimmed }]);
    setStreaming(true);
    streamingRef.current = true;

    let chipSeq = 0;
    const applyToolEvent = (e: ToolActivityEvent): void => {
      setTools(prev => {
        if (e.status === 'start') {
          return [...prev, { key: ++chipSeq, name: e.name, label: e.label, status: 'start' }];
        }
        // resolve the most recent unresolved chip with the same tool name
        const idx = [...prev].reverse().findIndex(c => c.name === e.name && c.status === 'start');
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        const next = [...prev];
        next[realIdx] = {
          ...next[realIdx]!,
          status: e.status,
          ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
          ...(e.summary !== undefined ? { summary: e.summary } : {}),
        };
        return next;
      });
    };

    const off = window.fairy.chat.onChunk(({ messageId, delta }) => {
      setMessages(m => {
        const idx = m.findIndex(x => x.id === messageId);
        if (idx === -1) return [...m, { id: messageId, role: 'assistant', content: delta }];
        const next = [...m];
        next[idx] = { ...next[idx]!, content: next[idx]!.content + delta };
        return next;
      });
    });
    const offTool = window.fairy.chat.onToolActivity(applyToolEvent);
    try {
      const res = await window.fairy.chat.send(trimmed);
      if (res.ok && res.message) {
        // The resolved message is AUTHORITATIVE: add it when absent, and replace
        // any partially-streamed bubble — a self-heal against delta loss on the
        // IPC hop (invoke replies can overtake queued chunk events).
        setMessages(m => {
          const idx = m.findIndex(x => x.id === res.message!.id);
          if (idx === -1) return [...m, res.message!];
          const next = [...m];
          next[idx] = res.message!;
          return next;
        });
        if (res.conversationId) setActiveConversationId(res.conversationId);
        void refreshConversations();
      } else if (!res.ok) {
        setError(res.error ?? 'send failed');
      }
    } catch (err) {
      setError(`send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      off();
      offTool();
      setStreaming(false);
      streamingRef.current = false;
    }
  }, [refreshConversations]);

  const clear = useCallback(async () => {
    const res = await window.fairy.chat.clear();
    if (res.ok) {
      setMessages([]);
      setTools([]);
      setActiveConversationId('');
      void refreshConversations();
    } else setError(res.error ?? 'clear failed');
  }, [refreshConversations]);

  const openConversation = useCallback(async (id: string | null) => {
    try {
      const res = await window.fairy.chat.open(id);
      if (res.ok) {
        setMessages(res.messages ?? []);
        setTools([]);
        setError(null);
        setActiveConversationId(res.id ?? '');
        void refreshConversations();
      } else setError(res.error ?? 'open failed');
    } catch (err) {
      setError(`open failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshConversations]);

  const searchConversations = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length === 0) {
      await refreshConversations();
      return;
    }
    try {
      const res = await window.fairy.chat.search(q);
      if (res.ok && res.conversations) setConversations(res.conversations);
      else setError(res.error ?? 'search failed');
    } catch (err) {
      setError(`search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshConversations]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const res = await window.fairy.chat.deleteConversation(id);
      if (res.ok) {
        if (id === activeConversationId) {
          // The main process dropped it too — the view goes blank, not stale.
          setMessages([]);
          setActiveConversationId('');
        }
        void refreshConversations();
      } else setError(res.error ?? 'delete failed');
    } catch (err) {
      setError(`delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeConversationId, refreshConversations]);

  return {
    messages, streaming, error, tools, send, clear,
    conversations, activeConversationId,
    refreshConversations, openConversation, searchConversations, deleteConversation,
  };
}
