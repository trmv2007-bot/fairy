import React, { useCallback, useEffect, useState } from 'react';
import { Orb, STATE_LABELS } from './Orb.js';
import { Panel } from './Panel.js';
import { Chat } from './Chat.js';
import { Boot } from './Boot.js';
import { useChat } from './use-chat.js';
import { SettingsPanel } from '../settings-ui.js';
import type { PersistedConfigWire, PoolStatusWire, SaveProviderPayload, SystemSnapshot } from '../bridge.js';

type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';
type Section = 'chat' | 'status' | 'providers';

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
        background: 'rgba(3, 5, 16, 0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        className="hud-corners f-holo f-hairline"
        style={{
          maxWidth: 380, boxSizing: 'border-box', padding: 18,
          border: '1px solid rgba(79, 140, 255, 0.3)',
          boxShadow: '0 0 24px rgba(79,140,255,0.14), 0 12px 40px rgba(0,0,0,0.6)',
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
          fontSize: 12.5, lineHeight: 1.55, color: 'var(--f-muted)',
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

/** Live device readout — real values measured in the main process, none invented. */
function DeviceReadout(): React.ReactElement {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      window.fairy.system.snapshot().then(res => {
        if (!alive) return;
        if (res.ok && res.snapshot) { setSnap(res.snapshot); setErr(null); }
        else setErr(res.error ?? 'snapshot failed');
      }).catch(() => { if (alive) setErr('snapshot failed'); });
    };
    refresh();
    const timer = setInterval(refresh, 10_000); // live, not a screenshot
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (err) {
    return <p style={{ color: 'var(--f-warn)', fontFamily: 'var(--f-mono)', fontSize: 11 }}>{err}</p>;
  }
  if (!snap) {
    return <p className="f-label">measuring device…</p>;
  }
  const usedMb = Math.max(0, snap.memoryTotalMb - snap.memoryFreeMb);
  const usedPct = snap.memoryTotalMb > 0 ? Math.round((usedMb / snap.memoryTotalMb) * 100) : 0;
  const batteryText = snap.battery === null
    ? 'no battery · mains'
    : snap.battery.hasBattery
      ? `${snap.battery.percent >= 0 ? `${Math.round(snap.battery.percent)}%` : 'level unknown'} · ${snap.battery.isCharging ? 'charging' : 'discharging'}`
      : 'no battery · mains';
  return (
    <div aria-label="Device readout">
      <div className="f-heading" style={{ marginTop: 0 }}>Device readout</div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Operating system</span>
        <strong style={{ textAlign: 'right', wordBreak: 'break-all', fontSize: 12 }}>{snap.os} · {snap.arch}</strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Hostname · user</span>
        <strong style={{ textAlign: 'right' }}>{snap.hostname} · {snap.user}</strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">CPU</span>
        <strong style={{ textAlign: 'right', fontSize: 12 }}>{snap.cpuModel} ×{snap.cores}</strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Memory</span>
        <strong style={{ textAlign: 'right' }}>
          {usedMb.toLocaleString()} / {snap.memoryTotalMb.toLocaleString()} MB
          <span
            aria-label="memory bar"
            style={{
              display: 'block', marginTop: 4, height: 4, width: 130,
              background: 'var(--f-line)', borderRadius: 2, overflow: 'hidden',
              marginLeft: 'auto',
            }}
          >
            <span style={{ display: 'block', height: 4, width: `${usedPct}%`, background: usedPct > 85 ? 'var(--f-warn)' : 'var(--f-acc)' }} />
          </span>
        </strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Power</span>
        <strong style={{ color: 'var(--f-warn)' }}>{batteryText}</strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Uptime</span>
        <strong>{snap.uptimeHours.toLocaleString()} h</strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Display · net ifaces</span>
        <strong style={{ textAlign: 'right' }}>
          {snap.displays.length > 0
            ? snap.displays.map(d => `${d.width}×${d.height}`).join(' · ')
            : 'unknown'}
          {' · '}{snap.networkInterfaces} iface{snap.networkInterfaces === 1 ? '' : 's'}
        </strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Runtime</span>
        <strong style={{ textAlign: 'right' }}>electron {snap.runtime.electron} · node {snap.runtime.node}</strong>
      </div>
    </div>
  );
}

/** Live key-pool routing state — measured in the main process, none invented. */
function PoolReadout(): React.ReactElement {
  const [snap, setSnap] = useState<PoolStatusWire | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      window.fairy.settings.poolStatus().then(res => {
        if (!alive) return;
        if (res.ok && res.status) { setSnap(res.status); setErr(null); }
        else setErr(res.error ?? 'pool status failed');
      }).catch(() => { if (alive) setErr('pool status failed'); });
    };
    refresh();
    const timer = setInterval(refresh, 10_000); // cooldowns tick down live
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (err) {
    return <p style={{ color: 'var(--f-warn)', fontFamily: 'var(--f-mono)', fontSize: 11 }}>{err}</p>;
  }
  if (!snap) {
    return <p className="f-label">reading key pool…</p>;
  }
  const cooling = snap.cooling.map(c => `${c.id} (${c.reason})`).join(' · ');
  return (
    <div aria-label="Key pool readout">
      <div className="f-heading" style={{ marginTop: 0 }}>Key pool</div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Active keys</span>
        <strong>
          {snap.activeIds.length} of {snap.registered} · round-robin
          {snap.activeIds.length > 0 && (
            <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--f-muted)' }}>
              {snap.activeIds.join(' · ')}
            </span>
          )}
        </strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Last key used</span>
        <strong>{snap.lastUsedId ?? '—'}</strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Cooling keys</span>
        <strong style={{ color: snap.cooling.length > 0 ? 'var(--f-warn)' : 'var(--f-muted)' }}>
          {snap.cooling.length > 0 ? cooling : 'none'}
        </strong>
      </div>
      <div className="f-row" style={rowStyle}>
        <span className="f-label">Routed · failovers</span>
        <strong>{snap.requests} · {snap.failovers}</strong>
      </div>
    </div>
  );
}

export function App(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('chat');
  const [collapsed, setCollapsed] = useState(false);
  const [state, setState] = useState<OrbState>('idle');
  const [config, setConfig] = useState<PersistedConfigWire | null>(null);
  const [booted, setBooted] = useState(false);
  const [poweredOn, setPoweredOn] = useState(false);
  const [brokerOnline, setBrokerOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cmd, setCmd] = useState('');
  const chat = useChat();

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
  const poolIds = config?.activeProviderIds ?? [];

  const onSignAgreement = useCallback(async () => {
    try {
      const res = await window.fairy.settings.acceptAgreement();
      if (res.config) setConfig(res.config);
      if (!res.ok) setNotice(res.error ?? 'agreement failed');
    } catch (err) {
      setNotice(`agreement failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onToggleCommandExecution = useCallback(async (enabled: boolean) => {
    try {
      const res = await window.fairy.settings.setCommandExecution(enabled);
      if (res.config) setConfig(res.config);
      if (!res.ok) setNotice(res.error ?? 'toggle failed');
    } catch (err) {
      setNotice(`toggle failed: ${err instanceof Error ? err.message : String(err)}`);
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

  // Key-pool membership: tick a key in/out of the round-robin. Order follows the
  // registered list; the pool persists and is journalled in the main process.
  const onTogglePoolMember = useCallback(async (id: string) => {
    const current = config?.activeProviderIds ?? [];
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id];
    try {
      const res = await window.fairy.settings.setActiveProviders(next);
      if (res.config) setConfig(res.config);
      else setNotice(res.error ?? 'pool update failed');
    } catch (err) {
      setNotice(`pool update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [config]);

  // Command bar: one input, always at the top. Sending re-opens the chat
  // section so the exchange is visible no matter which section was up.
  const submitCommand = useCallback(async () => {
    const text = cmd.trim();
    if (text.length === 0 || chat.streaming || !hasProvider) return;
    setCmd('');
    setSection('chat');
    setCollapsed(false);
    await chat.send(text);
  }, [cmd, chat, hasProvider]);

  const onCmdKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitCommand();
    }
  };

  // Section chips: click the active chip again to collapse the section body —
  // the command bar stays, the panel becomes a pure console.
  const pickSection = useCallback((s: Section) => {
    if (s === section) setCollapsed(c => !c);
    else { setSection(s); setCollapsed(false); }
  }, [section]);

  return (
    <div className="hud-corners" style={{ padding: 18, minHeight: '100vh', boxSizing: 'border-box' }}>
      {/* Canon power-on ritual: CRT scan readout -> the eye wakes -> Fairy
          introduces herself. Plays on every window load; auto-dismisses. */}
      {!poweredOn && (
        <Boot agreementSigned={agreementSigned} onDone={() => setPoweredOn(true)} />
      )}
      {booted && !agreementSigned && <AgreementOverlay onSign={() => void onSignAgreement()} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Orb state={state} onClick={() => setOpen(true)} />
        <div>
          <div className="f-wordmark" style={{ fontSize: 22, letterSpacing: '0.34em', lineHeight: 1.1 }}>
            FAIRY
          </div>
          <hr className="f-wordrule" style={{ width: 150, marginLeft: 0 }} />
          <div className="f-label" style={{ marginTop: 6 }}>
            {STATE_LABELS[state]} · tap the screen to open
          </div>
        </div>
      </div>
      <Panel open={open} onClose={() => setOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
          <div className="f-stagger">
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <h2 className="f-wordmark" style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 20, letterSpacing: '0.3em' }}>
                  Fairy
                </h2>
                <span className="f-label" style={{ whiteSpace: 'nowrap' }}>{STATE_LABELS[state]}</span>
              </div>
              <div className="f-label" style={{ marginTop: 3, letterSpacing: '0.12em' }}>
                Type-III intelligence · Chief Assistant
              </div>
            </div>

            {/* Command bar — the panel's one persistent input. */}
            <form
              className="f-cmdbar f-holo f-hairline f-shimmer"
              style={{ marginTop: 10, borderRadius: 10 }}
              onSubmit={(e) => { e.preventDefault(); void submitCommand(); }}
            >
              <textarea
                aria-label="Command bar"
                rows={1}
                value={cmd}
                placeholder={hasProvider ? 'Message Fairy… (Enter to send)' : 'Configure a provider first'}
                onChange={e => setCmd(e.target.value)}
                onKeyDown={onCmdKeyDown}
                disabled={chat.streaming || !hasProvider}
              />
              <button
                type="submit"
                className="f-send"
                aria-label="Send"
                title="Send (Enter)"
                disabled={chat.streaming || cmd.trim().length === 0 || !hasProvider}
              >
                {chat.streaming ? '…' : '▸'}
              </button>
            </form>

            {/* Section chips + passive routing readouts. */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button
                type="button"
                className={section === 'chat' && !collapsed ? 'f-chip f-chip-active' : 'f-chip'}
                aria-pressed={section === 'chat' && !collapsed}
                onClick={() => pickSection('chat')}
              >Chat</button>
              <button
                type="button"
                className={section === 'status' && !collapsed ? 'f-chip f-chip-active' : 'f-chip'}
                aria-pressed={section === 'status' && !collapsed}
                onClick={() => pickSection('status')}
              >Status</button>
              <button
                type="button"
                className={section === 'providers' && !collapsed ? 'f-chip f-chip-active' : 'f-chip'}
                aria-pressed={section === 'providers' && !collapsed}
                onClick={() => pickSection('providers')}
              >Providers</button>
              <span style={{ flex: 1 }} />
              {poolIds.length > 0 && (
                <span
                  className="f-chip f-chip-info"
                  title="Requests round-robin across every active key; failures fail over automatically"
                  style={{ color: poolIds.length > 1 ? 'var(--f-acc)' : undefined }}
                >
                  key pool {poolIds.length}
                </span>
              )}
              <span
                className="f-chip f-chip-info"
                title="Native broker — optional, chat works without it"
              >
                broker {brokerOnline ? 'online' : 'offline'}
              </span>
            </div>
          </div>

          {/* Collapsible section body — re-keyed per section so the staggered
              entrance replays on every switch. Scrolls internally so tall
              sections never paint over the notice line below. */}
          {!collapsed && (
            <div
              key={section}
              className="f-stagger"
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginTop: 10, overflowY: 'auto', overflowX: 'hidden', paddingRight: 2 }}
            >
              {section === 'chat' && (
                <Chat
                  chat={chat}
                  hasProvider={hasProvider}
                  onOpenProviders={() => { setSection('providers'); setCollapsed(false); }}
                />
              )}
              {section === 'status' && (
                <div>
                  <DeviceReadout />
                  <PoolReadout />
                  <div className="f-heading">Operational status</div>
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
                  <div className="f-row" style={{ ...rowStyle, cursor: 'pointer' }}>
                    <label htmlFor="cmd-exec" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        id="cmd-exec"
                        type="checkbox"
                        checked={config?.allowCommandExecution === true}
                        onChange={e => void onToggleCommandExecution(e.target.checked)}
                      />
                      <span>
                        <strong>Controlled command execution</strong>
                        <br />
                        <span style={{ color: 'var(--f-muted)', fontSize: 11 }}>
                          allowlisted diagnostics only — Fairy asks, Master arms
                        </span>
                      </span>
                    </label>
                    <strong style={{ color: config?.allowCommandExecution === true ? 'var(--f-warn)' : 'var(--f-muted)' }}>
                      {config?.allowCommandExecution === true ? 'ARMED' : 'disarmed'}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="f-btn" onClick={() => setState('paused')}>Suspend operations</button>
                    <button type="button" className="f-btn" onClick={() => setState('idle')}>Resume</button>
                  </div>
                  <p style={{ color: 'var(--f-muted)', fontSize: 12, lineHeight: 1.5, marginTop: 12 }}>
                    Device readout is measured live in the main process — OS, CPU, memory,
                    power, displays. Tool results are &apos;internal&apos;-scope data: they flow
                    only to providers that allow that scope, and credential-like paths are
                    withheld from the model entirely.
                  </p>
                </div>
              )}
              {section === 'providers' && (
                <div>
                  <div className="f-heading" style={{ marginTop: 0 }}>Cloud providers</div>
                  <p className="f-label" style={{ margin: '0 0 8px' }}>
                    Key pool: {poolIds.length} of {config?.cloudProviders.length ?? 0} active · round-robin with failover
                  </p>
                  {(config?.cloudProviders ?? []).map(p => (
                    <div key={p.endpointId} className="f-row" style={rowStyle}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          aria-label={`Pool member ${p.endpointId}`}
                          checked={poolIds.includes(p.endpointId)}
                          onChange={() => void onTogglePoolMember(p.endpointId)}
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
                    Every key you save joins the active pool automatically: Fairy routes
                    requests round-robin across all ticked keys, fails over when one is
                    rate-limited or dead, and cools it down while the rest carry the load.
                    Register the same endpoint twice with different keys to pool one
                    provider. Keys are encrypted by the OS (DPAPI/keychain) and never
                    stored in plain text; the persisted config keeps opaque handles only.
                    Your keys stay yours — Fairy merely remembers them.
                  </p>
                </div>
              )}
            </div>
          )}
          {notice && <p style={{ color: 'var(--f-warn)', fontFamily: 'var(--f-mono)', fontSize: 12 }}>{notice}</p>}
        </div>
      </Panel>
    </div>
  );
}
