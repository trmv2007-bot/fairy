// Chat controller hook (v0.5 remodel): the stateful side of the conversation,
// lifted out of the old Chat component so the command bar can live at the top
// of the panel while the history renders in a collapsible section below it.
// Pure glue over the typed bridge — all routing/streaming logic stays in the
// main process.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageWire, ToolActivityEvent } from '../bridge.js';

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
  /** Sends one user message; streams the reply through the controller state. */
  send(text: string): Promise<void>;
  /** Clears history + tool log (main process state too). */
  clear(): Promise<void>;
}

export function useChat(): ChatController {
  const [messages, setMessages] = useState<ChatMessageWire[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolChip[]>([]);
  const streamingRef = useRef(false);
  streamingRef.current = streaming;

  useEffect(() => {
    // no subscriptions at hook level: send() subscribes per turn, as before
    return () => { /* stream unsubscribes are per-turn */ };
  }, []);

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
  }, []);

  const clear = useCallback(async () => {
    const res = await window.fairy.chat.clear();
    if (res.ok) {
      setMessages([]);
      setTools([]);
    } else setError(res.error ?? 'clear failed');
  }, []);

  return { messages, streaming, error, tools, send, clear };
}
