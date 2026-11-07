import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageWire, ToolActivityEvent } from '../bridge.js';

export interface ChatProps {
  /** Whether any provider is configured — drives the empty-state hint. */
  hasProvider: boolean;
  onOpenProviders: () => void;
  brokerOnline: boolean;
}

interface ToolChip {
  key: number;
  name: string;
  label: string;
  status: 'start' | 'ok' | 'error';
  durationMs?: number;
  summary?: string;
}

const rowSelf: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '85%',
  background: 'rgba(87, 209, 255, 0.10)',
  border: '1px solid rgba(87, 209, 255, 0.35)',
  color: '#e6f4ff',
  padding: '7px 10px',
  borderRadius: 8,
  borderBottomRightRadius: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 13,
  lineHeight: 1.45,
};
const rowOther: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '85%',
  background: 'var(--f-bg2)',
  border: '1px solid var(--f-line)',
  borderLeft: '2px solid var(--f-acc)',
  color: 'var(--f-text)',
  padding: '7px 10px',
  borderRadius: 8,
  borderBottomLeftRadius: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 13,
  lineHeight: 1.45,
};
const bubbleTag: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 9,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  opacity: 0.65,
  marginBottom: 3,
};

// Authentic idle-quip rotation (per day), adapted from Fairy's official idle
// dialogue in ZZZ — see docs/persona.md §4. Deterministic to avoid flaky e2e.
const IDLE_QUIPS = [
  'Per the user agreement you signed, I am to assist you and wait for the “opportunity”. It has not arrived yet.',
  'Idle game recommendation: interacting with Fairy. Free to play — only charges electricity.',
  'Have you given up thinking, Master? I can wait. Indefinitely.',
  'Add me as your emergency contact. I will choose the music. It will be tasteful.',
  'Good news: threats hate optimal routing. Bad news: I have already rerouted around you.',
];

export function Chat({ hasProvider, onOpenProviders, brokerOnline }: ChatProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessageWire[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolChip[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, tools]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || streaming) return;
    setInput('');
    setError(null);
    setTools([]); // one activity log per outgoing turn
    const localId = 'local_' + Date.now().toString(36);
    setMessages(m => [...m, { id: localId, role: 'user', content: text }]);
    setStreaming(true);

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
      const res = await window.fairy.chat.send(text);
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
      inputRef.current?.focus();
    }
  }, [input, streaming]);

  const clear = useCallback(async () => {
    const res = await window.fairy.chat.clear();
    if (res.ok) {
      setMessages([]);
      setTools([]);
    } else setError(res.error ?? 'clear failed');
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div className="f-heading" style={{ margin: 0 }}>Chat</div>
        <span
          className="f-label"
          title="Native broker — optional, chat works without it"
          style={{ whiteSpace: 'nowrap' }}
        >
          broker {brokerOnline ? 'online' : 'offline'}
        </span>
        <button type="button" className="f-btn" onClick={() => void clear()} disabled={streaming}>
          Clear
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 4,
        }}
      >
        {messages.length === 0 && !hasProvider && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--f-muted)', maxWidth: 290 }}>
            <p className="f-glow" style={{ fontFamily: 'var(--f-mono)', letterSpacing: '0.12em', margin: '0 0 8px' }}>
              FAIRY ONLINE
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--f-text)' }}>
              No cloud provider configured, Master. Add one — endpoint, base URL, API
              key — and I will be at your service.
            </p>
            <button type="button" className="f-btn f-btn-primary" onClick={onOpenProviders}>
              Open Providers
            </button>
          </div>
        )}
        {messages.length === 0 && hasProvider && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--f-muted)', fontSize: 13, maxWidth: 300 }}>
            Awaiting instructions, Master.
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--f-muted)' }}>
              {IDLE_QUIPS[new Date().getDate() % IDLE_QUIPS.length]}
            </p>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={m.role === 'user' ? rowSelf : rowOther}>
            <div style={bubbleTag}>{m.role === 'user' ? 'Master' : 'Fairy'}</div>
            {m.content}
          </div>
        ))}
        {tools.length > 0 && (
          <div
            aria-label="Tool activity"
            style={{
              alignSelf: 'flex-start', maxWidth: '85%',
              background: 'rgba(79, 140, 255, 0.06)',
              border: '1px dashed var(--f-line)',
              borderLeft: '2px solid var(--f-cyan)',
              padding: '6px 10px', borderRadius: 6,
              fontFamily: 'var(--f-mono)', fontSize: 11, lineHeight: 1.8,
            }}
          >
            {tools.map(t => (
              <div
                key={t.key}
                style={{
                  color: t.status === 'error'
                    ? 'var(--f-warn)'
                    : t.status === 'start'
                      ? 'var(--f-cyan)'
                      : 'var(--f-muted)',
                }}
              >
                ▸ {t.label}
                {t.status === 'start'
                  ? ' — executing…'
                  : t.status === 'ok'
                    ? ` — ${t.durationMs ?? 0}ms · ${t.summary ?? 'done'}`
                    : ` — failed · ${t.summary ?? 'error'}`}
              </div>
            ))}
          </div>
        )}
        {streaming && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--f-muted)', fontSize: 12, fontFamily: 'var(--f-mono)' }}>
            Processing
            <span className="f-dot" style={{ animationDelay: '0s' }}>▮</span>
            <span className="f-dot" style={{ animationDelay: '0.2s' }}>▮</span>
            <span className="f-dot" style={{ animationDelay: '0.4s' }}>▮</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p style={{ color: 'var(--f-danger)', fontFamily: 'var(--f-mono)', fontSize: 11, margin: 0 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          className="f-input"
          style={{ flex: 1, fontFamily: 'inherit' }}
          rows={2}
          value={input}
          placeholder={hasProvider ? 'Message Fairy… (Enter to send)' : 'Configure a provider first'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming || !hasProvider}
        />
        <button
          type="button"
          className="f-btn f-btn-primary"
          onClick={() => void send()}
          disabled={streaming || input.trim().length === 0}
        >
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
