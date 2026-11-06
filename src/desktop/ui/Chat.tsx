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
  background: '#1d4ed8',
  color: '#eef2ff',
  padding: '8px 10px',
  borderRadius: 10,
  borderBottomRightRadius: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 13,
  lineHeight: 1.45,
};
const rowOther: React.CSSProperties = {
  alignSelf: 'flex-start',
  maxWidth: '85%',
  background: '#1e293b',
  color: '#e2e8f0',
  padding: '8px 10px',
  borderRadius: 10,
  borderBottomLeftRadius: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 13,
  lineHeight: 1.45,
};
const inputStyle: React.CSSProperties = {
  flex: 1,
  resize: 'none',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '8px 10px',
  fontFamily: 'inherit',
  fontSize: 13,
  boxSizing: 'border-box',
};
const btnStyle: React.CSSProperties = { cursor: 'pointer' };

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
        <h3 style={{ margin: 0 }}>Chat</h3>
        <span style={{ color: '#64748b', fontSize: 11 }}>
          broker: {brokerOnline ? 'online' : 'offline (optional)'}
        </span>
        <button type="button" style={btnStyle} onClick={() => void clear()} disabled={streaming}>
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
          <div style={{ margin: 'auto', textAlign: 'center', color: '#94a3b8', maxWidth: 280 }}>
            <p style={{ fontWeight: 600, color: '#e2e8f0' }}>No cloud provider configured yet</p>
            <p style={{ fontSize: 13 }}>
              Add a provider (endpoint, base URL, API key) and start chatting. Keys are
              encrypted by the OS and never written in plain text.
            </p>
            <button type="button" style={btnStyle} onClick={onOpenProviders}>
              Open Providers
            </button>
          </div>
        )}
        {messages.length === 0 && hasProvider && (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            Say hello. Conversation stays on this device.
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={m.role === 'user' ? rowSelf : rowOther}>
            {m.content}
          </div>
        ))}
        {streaming && (
          <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: 12 }}>Fairy is typing…</div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p style={{ color: '#fbbf24', margin: 0, fontSize: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          style={inputStyle}
          rows={2}
          value={input}
          placeholder={hasProvider ? 'Message Fairy… (Enter to send)' : 'Configure a provider first'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming || !hasProvider}
        />
        <button type="button" style={btnStyle} onClick={() => void send()} disabled={streaming || input.trim().length === 0}>
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
