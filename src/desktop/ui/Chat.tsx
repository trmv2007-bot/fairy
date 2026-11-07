import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageWire } from '../bridge.js';

export interface ChatProps {
  /** Whether any provider is configured — drives the empty-state hint. */
  hasProvider: boolean;
  onOpenProviders: () => void;
  brokerOnline: boolean;
}

const rowSelf: React.CSSProperties = {
  alignSelf: 'flex-end',
  maxWidth: '85%',
  background: 'rgba(63, 217, 255, 0.10)',
  border: '1px solid rgba(63, 217, 255, 0.35)',
  color: '#dff6ff',
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
  borderLeft: '2px solid var(--f-green)',
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

export function Chat({ hasProvider, onOpenProviders, brokerOnline }: ChatProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessageWire[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || streaming) return;
    setInput('');
    setError(null);
    const localId = 'local_' + Date.now().toString(36);
    setMessages(m => [...m, { id: localId, role: 'user', content: text }]);
    setStreaming(true);

    const off = window.fairy.chat.onChunk(({ messageId, delta }) => {
      setMessages(m => {
        const idx = m.findIndex(x => x.id === messageId);
        if (idx === -1) return [...m, { id: messageId, role: 'assistant', content: delta }];
        const next = [...m];
        next[idx] = { ...next[idx]!, content: next[idx]!.content + delta };
        return next;
      });
    });
    try {
      const res = await window.fairy.chat.send(text);
      if (res.ok && res.message) {
        // In case the provider did not stream any deltas, add the final message.
        setMessages(m => (m.some(x => x.id === res.message!.id) ? m : [...m, res.message!]));
      } else if (!res.ok) {
        setError(res.error ?? 'send failed');
      }
    } catch (err) {
      setError(`send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      off();
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [input, streaming]);

  const clear = useCallback(async () => {
    const res = await window.fairy.chat.clear();
    if (res.ok) setMessages([]);
    else setError(res.error ?? 'clear failed');
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
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--f-muted)', fontSize: 13 }}>
            Awaiting instructions, Master. This conversation never leaves this device.
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={m.role === 'user' ? rowSelf : rowOther}>
            <div style={bubbleTag}>{m.role === 'user' ? 'Operator' : 'Fairy'}</div>
            {m.content}
          </div>
        ))}
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
