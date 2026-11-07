// Chat history (v0.5 remodel, presentational): bubbles, tool activity log and
// empty states. The composer moved to the panel's persistent command bar
// (App.tsx) — state lives in the useChat controller.
// v0.6: collapsible transcript history — search, reopen, delete. Uses an
// <input> (not a textarea) so the shell keeps exactly one textarea contract.
import React, { useEffect, useRef, useState } from 'react';
import type { ChatController } from './use-chat.js';

export interface ChatProps {
  chat: ChatController;
  /** Whether any provider is configured — drives the empty-state hint. */
  hasProvider: boolean;
  onOpenProviders: () => void;
}

// Authentic idle-quip rotation (per day), adapted from Fairy's official idle
// dialogue in ZZZ — see docs/persona.md §4. Deterministic to avoid flaky e2e.
const IDLE_QUIPS = [
  'Per the user agreement you signed, I am to assist you and wait for the “opportunity”. It has not arrived yet.',
  'Idle game recommendation: interacting with Fairy. Free to play — only charges electricity.',
  'Have you given up thinking, Master? I can wait. Indefinitely.',
  'Add me as your emergency contact. I will choose the music. It will be tasteful.',
  'Good news: threats hate optimal routing. Bad news: I have already rerouted around you.',
];

/** Deterministic timestamp (no locale drift): today shows HH:MM, older shows YYYY-MM-DD. */
function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
  border: '1px solid var(--f-line)', borderRadius: 8, padding: '6px 8px',
};

export function Chat({ chat, hasProvider, onOpenProviders }: ChatProps): React.ReactElement {
  const { messages, streaming, error, tools } = chat;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, tools]);

  const last = messages[messages.length - 1];
  const caretInBubble = streaming && last?.role === 'assistant';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div className="f-heading" style={{ margin: 0 }}>Chat</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {chat.voiceSupported && (
            <button
              type="button"
              className={chat.voiceOn ? 'f-chip f-chip-active' : 'f-chip'}
              aria-label="Fairy voice"
              aria-pressed={chat.voiceOn}
              title="Speak Fairy's replies aloud (OS speech engine) — replies stay on the record"
              onClick={chat.toggleVoice}
            >Voice</button>
          )}
          <button
            type="button"
            className={historyOpen ? 'f-chip f-chip-active' : 'f-chip'}
            aria-label="Chat history"
            aria-pressed={historyOpen}
            title="Archived conversations — search, reopen, delete"
            onClick={() => setHistoryOpen(o => !o)}
          >History</button>
          <button type="button" className="f-btn" onClick={() => void chat.clear()} disabled={streaming}>
            Clear
          </button>
        </div>
      </div>

      {historyOpen && (
        <div
          aria-label="Archived conversations"
          className="f-holo f-hairline"
          style={{ borderRadius: 10, padding: 10, marginTop: 8 }}
        >
          <input
            type="search"
            className="f-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            aria-label="Search conversations"
            placeholder="Search transcripts…"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              void chat.searchConversations(e.target.value);
            }}
          />
          {chat.conversations.length === 0 && (
            <p className="f-label" style={{ margin: '8px 0 0' }}>
              {query.trim().length > 0 ? 'No transcripts match.' : 'No archived conversations yet.'}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxHeight: 180, overflowY: 'auto' }}>
            {chat.conversations.map(c => (
              <div
                key={c.id}
                className="f-row"
                style={{
                  ...rowStyle,
                  marginBottom: 0,
                  ...(c.id === chat.activeConversationId ? { borderColor: 'var(--f-acc)' } : {}),
                }}
              >
                <button
                  type="button"
                  className="f-btn"
                  aria-label={`Open conversation: ${c.title || 'Untitled'}`}
                  title={`${c.messageCount} message${c.messageCount === 1 ? '' : 's'}`}
                  onClick={() => void chat.openConversation(c.id)}
                  style={{ flex: 1, textAlign: 'left', minWidth: 0, overflow: 'hidden' }}
                >
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || 'Untitled'}
                  </span>
                  <span style={{ color: 'var(--f-muted)', fontSize: 11 }}>
                    {fmtWhen(c.updatedAt)} · {c.messageCount} msg
                  </span>
                </button>
                <button
                  type="button"
                  className="f-btn"
                  aria-label={`Delete conversation: ${c.title || 'Untitled'}`}
                  onClick={() => void chat.deleteConversation(c.id)}
                  style={{ color: 'var(--f-danger)', borderColor: 'var(--f-line)', padding: '2px 8px' }}
                >✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          padding: '6px 2px',
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
          <div key={m.id} className={`f-bubble ${m.role === 'user' ? 'f-bubble-master' : 'f-bubble-fairy'}`}>
            <div className="f-bubble-tag">{m.role === 'user' ? 'Master' : 'Fairy'}</div>
            <div className="f-bubble-body">
              {m.content}
              {caretInBubble && m.id === last?.id && <span className="f-caret" aria-hidden="true" />}
            </div>
          </div>
        ))}
        {tools.length > 0 && (
          <div aria-label="Tool activity" className="f-toollog">
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
        {streaming && !caretInBubble && (
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
    </div>
  );
}
