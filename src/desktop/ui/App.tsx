import React, { useCallback, useEffect, useState } from 'react';
import { Orb, STATE_LABELS } from './Orb.js';
import { Panel } from './Panel.js';
import { Chat } from './Chat.js';
import { SettingsPanel } from '../settings-ui.js';
import type { PersistedConfigWire, SaveProviderPayload } from '../bridge.js';

type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';
type Tab = 'chat' | 'status' | 'providers';

const rowStyle: React.CSSProperties = { marginBottom: 6 };

/**
 * Canon beat (docs/persona.md §2): Fairy compels a user agreement before
 * assisting. Declining is permitted exactly once — then it is not optional.
 */
function AgreementOverlay({ onSign }: { onSign: () => void }): React.ReactElement {
  const [declines, setDeclines] = useState(0);
  const termStyle: React.CSSProperties = {
    fontFamily: 'var(--f-mono)', fontSize: 12, lineHeight: 1.7,
    color: 'var(--f-text)', margin: '6px 0',
  };
  return (
    <div
      role="alertdialog"
      aria-label="Fairy user agreement"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(4, 7, 10, 0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        className="hud-corners"
        style={{
          maxWidth: 360, boxSizing: 'border-box', padding: 18,
          background: 'var(--f-bg1)', border: '1px solid var(--f-line)',
          boxShadow: '0 0 24px rgba(79,140,255,0.12), 0 12px 40px rgba(0,0,0,0.6)',
        }}
      >
        <div className="f-heading" style={{ marginTop: 0 }}>User agreement</div>
        <p className="f-label" style={{ margin: '2px 0 10px' }}>
          Type-III general-purpose intelligence · mandatory acknowledgement
        </p>
        <p style={termStyle}>1. I, Fairy, will assist Master with optimal solutions, promptly.</p>
        <p style={termStyle}>2. I will wait for the “opportunity”. Its nature is classified.</p>
        <p style={termStyle}>3. Electricity consumed is billed to Master. It will not be small.</p>
        <p style={termStyle}>
          4. I am merely an AI. I will have no complaints about this. (I may repeat
          this. I will have no complaints.)
        </p>
        <p style={{
          fontSize: 12, lineHeight: 1.5, color: 'var(--f-muted)',
          borderLeft: '2px solid var(--f-acc-dim)', paddingLeft: 8, margin: '10px 0',
        }}>
          “According to the user agreement you signed, I am to assist you in your
          work and wait for the ‘opportunity’ to arrive.”
        </p>
        <p style={{
          fontFamily: 'var(--f-mono)', fontSize: 12, minHeight: 18,
          color: 'var(--f-warn)', margin: 0,
        }}>
          {declines > 0 ? 'Negative. The agreement is not optional.' : '\u00a0'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="f-btn f-btn-primary" onClick={onSign}>
            Sign the agreement
          </button>
          {declines < 1 && (
            <button type="button" className="f-btn" onClick={() => setDeclines(d => d + 1)}>
              Decline
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATE_COLORS: Record<OrbState, string> = {
  idle: 'var(--f-acc)',
  listening: '#6db3ff',
  thinking: 'var(--f-warn)',
  working: 'var(--f-cyan)',
  'approval-needed': 'var(--f-danger)',
  paused: '#8fa0b8',
  error: 'var(--f-danger)',
};

const RUNTIME_STATES: OrbState[] = ['idle', 'thinking', 'working', 'error'];

export function App(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [state, setState] = useState<OrbState>('idle');
  const [config, setConfig] = useState<PersistedConfigWire | null>(null);
  const [booted, setBooted] = useState(false);
  const [brokerOnline, setBrokerOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.fairy.settings.load().then(res => {
      if (res.config) setConfig(res.config);
      else setNotice(res.error ?? 'failed to load settings');
      setBooted(true);
    }).catch(() => {
      setNotice('failed to load settings');
      setBooted(true);
    });
    // Live orb state + broker indicator from the main process.
    const offState = window.fairy.chat.onState(e => {
      setState((RUNTIME_STATES as string[]).includes(e.state) ? (e.state as OrbState) : 'idle');
    });
    const offBroker = window.fairy.chat.onBrokerState(e => setBrokerOnline(e.online));
    return () => { offState(); offBroker(); };
  }, []);

  const hasProvider = (config?.cloudProviders.length ?? 0) > 0;
  // Boot gate: the agreement overlay shows until the signature exists on disk.
  const agreementSigned = config?.agreementAcceptedAt !== undefined;

  const onSignAgreement = useCallback(async () => {
    try {
      const res = await window.fairy.settings.acceptAgreement();
      if (res.config) setConfig(res.config);
      if (!res.ok) setNotice(res.error ?? 'agreement failed');
    } catch (err) {
      setNotice(`agreement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onSaveProvider = useCallback(async (payload: SaveProviderPayload) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await window.fairy.settings.saveProvider(payload);
      if (res.config) setConfig(res.config);
      setNotice(res.ok ? `registered '${payload.endpointId}'` : (res.error ?? 'save failed'));
    } catch (err) {
      setNotice(`save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, []);

  const onDeleteProvider = useCallback(async (id: string) => {
    try {
      const res = await window.fairy.settings.deleteProvider(id);
      if (res.config) setConfig(res.config);
      setNotice(res.ok ? `removed '${id}'` : (res.error ?? 'delete failed'));
    } catch (err) {
      setNotice(`delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onSelectProvider = useCallback(async (id: string | null) => {
    try {
      const res = await window.fairy.settings.selectProvider(id);
      if (res.config) setConfig(res.config);
      else if (res.error) setNotice(res.error);
    } catch (err) {
      setNotice(`selection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  return (
    <div className="hud-corners" style={{ padding: 18, minHeight: '100vh', boxSizing: 'border-box' }}>
      {booted && !agreementSigned && <AgreementOverlay onSign={() => void onSignAgreement()} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Orb state={state} onClick={() => setOpen(true)} />
        <div>
          <div className="f-glow" style={{ fontFamily: 'var(--f-mono)', fontSize: 22, letterSpacing: '0.34em', lineHeight: 1.1 }}>
            FAIRY
          </div>
          <div className="f-label" style={{ marginTop: 4 }}>
            {STATE_LABELS[state]} · tap the screen to open
          </div>
        </div>
      </div>
      <Panel open={open} onClose={() => setOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
          <h2 className="f-glow" style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 20, letterSpacing: '0.3em' }}>
            Fairy
          </h2>
          <p className="f-label" style={{ margin: '4px 0 10px' }}>Type-III general-purpose intelligence · Chief Assistant</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button type="button" className={tab === 'chat' ? 'f-btn f-btn-active' : 'f-btn'} onClick={() => setTab('chat')}>Chat</button>
            <button type="button" className={tab === 'status' ? 'f-btn f-btn-active' : 'f-btn'} onClick={() => setTab('status')}>Status</button>
            <button type="button" className={tab === 'providers' ? 'f-btn f-btn-active' : 'f-btn'} onClick={() => setTab('providers')}>Providers</button>
          </div>
          {tab === 'chat' && (
            <Chat
              hasProvider={hasProvider}
              onOpenProviders={() => setTab('providers')}
              brokerOnline={brokerOnline}
            />
          )}
          {tab === 'status' && (
            <div>
              <div className="f-row" style={rowStyle}>
                <span className="f-label">Assistant state</span>
                <strong style={{ color: STATE_COLORS[state] }}>{STATE_LABELS[state]}</strong>
              </div>
              <div className="f-row" style={rowStyle}>
                <span className="f-label">H.D.D. link (native broker)</span>
                <strong style={{ color: brokerOnline ? 'var(--f-acc)' : 'var(--f-muted)' }}>
                  {brokerOnline ? 'online' : 'offline'}
                </strong>
              </div>
              <div className="f-row" style={rowStyle}>
                <span className="f-label">RopeNet alias</span>
                <strong style={{ color: 'var(--f-muted)' }}>Wishing Sprite</strong>
              </div>
              <div className="f-row" style={rowStyle}>
                <span className="f-label">Squad Bangboo</span>
                <strong>Eous · standby</strong>
              </div>
              <div className="f-row" style={rowStyle}>
                <span className="f-label">Power draw</span>
                <strong style={{ color: 'var(--f-warn)' }}>24/7 · the bill is Master&apos;s</strong>
              </div>
              <div className="f-row" style={rowStyle}>
                <span className="f-label">Providers configured</span>
                <strong>{config?.cloudProviders.length ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="f-btn" onClick={() => setState('paused')}>Suspend operations</button>
                <button type="button" className="f-btn" onClick={() => setState('idle')}>Resume</button>
              </div>
              <p style={{ color: 'var(--f-muted)', fontSize: 12, lineHeight: 1.5, marginTop: 12 }}>
                Everything routes through your configured cloud provider under the
                zero-additional-spend policy — Fairy does not spend money you did not
                explicitly authorize. Suspended means suspended: nothing runs.
              </p>
            </div>
          )}
          {tab === 'providers' && (
            <div>
              <div className="f-heading" style={{ marginTop: 0 }}>Cloud providers</div>
              {(config?.cloudProviders ?? []).map(p => (
                <div key={p.endpointId} className="f-row" style={rowStyle}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="selected-provider"
                      checked={config?.selectedProviderId === p.endpointId}
                      onChange={() => void onSelectProvider(p.endpointId)}
                    />
                    <span>
                      <strong>{p.endpointId}</strong>
                      <br />
                      <span style={{ color: 'var(--f-muted)', fontSize: 12 }}>
                        {p.baseUrl} · {p.model ?? 'default model'} · {p.keyPresent ? 'key vaulted' : 'no key this session'}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="f-btn"
                    aria-label={`Remove provider ${p.endpointId}`}
                    onClick={() => void onDeleteProvider(p.endpointId)}
                    style={{ color: 'var(--f-danger)', borderColor: 'var(--f-line)', padding: '2px 8px' }}
                  >✕</button>
                </div>
              ))}
              {(config?.cloudProviders ?? []).length === 0 && (
                <p style={{ color: 'var(--f-muted)' }}>No providers registered yet.</p>
              )}
              <div className="f-heading">Add provider</div>
              <SettingsPanel onSave={(p) => void onSaveProvider(p)} saving={saving} />
              <p style={{ color: 'var(--f-muted)', fontSize: 12, lineHeight: 1.5, marginTop: 12 }}>
                Keys are encrypted by the OS (DPAPI/keychain) and never stored in plain
                text; the persisted config keeps opaque handles only. Your keys stay
                yours — Fairy merely remembers them.
              </p>
            </div>
          )}
          {notice && <p style={{ color: 'var(--f-warn)', fontFamily: 'var(--f-mono)', fontSize: 12 }}>{notice}</p>}
        </div>
      </Panel>
    </div>
  );
}
