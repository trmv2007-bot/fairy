// Chat history (v0.5 remodel, presentational): bubbles, tool activity log and
// empty states. The composer moved to the panel's persistent command bar
// (App.tsx) — state lives in the useChat controller.
import React, { useEffect, useRef } from 'react';
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

export function Chat({ chat, hasProvider, onOpenProviders }: ChatProps): React.ReactElement {
  const { messages, streaming, error, tools } = chat;
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, tools]);

  const last = messages[messages.length - 1];
  const caretInBubble = streaming && last?.role === 'assistant';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div className="f-heading" style={{ margin: 0 }}>Chat</div>
        <button type="button" className="f-btn" onClick={() => void chat.clear()} disabled={streaming}>
          Clear
        </button>
      </div>

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
