import React, { useCallback, useEffect, useState } from 'react';
import { Orb } from './Orb.js';
import { Panel } from './Panel.js';
import { Chat } from './Chat.js';
import { SettingsPanel } from '../settings-ui.js';
import type { PersistedConfigWire, SaveProviderPayload } from '../bridge.js';

type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';
type Tab = 'chat' | 'status' | 'providers';

const sectionStyle: React.CSSProperties = { marginTop: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 8, padding: '6px 8px', background: '#1e293b', borderRadius: 4, marginBottom: 6,
};
const btnStyle: React.CSSProperties = { cursor: 'pointer' };

const RUNTIME_STATES: OrbState[] = ['idle', 'thinking', 'working', 'error'];

export function App(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [state, setState] = useState<OrbState>('idle');
  const [config, setConfig] = useState<PersistedConfigWire | null>(null);
  const [brokerOnline, setBrokerOnline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.fairy.settings.load().then(res => {
      if (res.config) setConfig(res.config);
      else setNotice(res.error ?? 'failed to load settings');
    }).catch(() => setNotice('failed to load settings'));
    // Live orb state + broker indicator from the main process.
    const offState = window.fairy.chat.onState(e => {
      setState((RUNTIME_STATES as string[]).includes(e.state) ? (e.state as OrbState) : 'idle');
    });
    const offBroker = window.fairy.chat.onBrokerState(e => setBrokerOnline(e.online));
    return () => { offState(); offBroker(); };
  }, []);

  const hasProvider = (config?.cloudProviders.length ?? 0) > 0;

  const onSaveProvider = useCallback(async (payload: SaveProviderPayload) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await window.fairy.settings.saveProvider(payload);
      if (res.config) setConfig(res.config);
      setNotice(res.ok ? `saved '${payload.endpointId}'` : (res.error ?? 'save failed'));
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
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#e2e8f0', padding: 12 }}>
      <Orb state={state} onClick={() => setOpen(true)} />
      <Panel open={open} onClose={() => setOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
          <h2 style={{ margin: 0 }}>Fairy</h2>
          <p style={{ margin: '0 0 8px', color: '#94a3b8' }}>Strong, dry, competent.</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" style={btnStyle} onClick={() => setTab('chat')}>Chat</button>
            <button type="button" style={btnStyle} onClick={() => setTab('status')}>Status</button>
            <button type="button" style={btnStyle} onClick={() => setTab('providers')}>Providers</button>
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
              <div style={rowStyle}>
                <span>Assistant state</span>
                <strong>{state}</strong>
              </div>
              <div style={rowStyle}>
                <span>Native broker (optional)</span>
                <strong>{brokerOnline ? 'online' : 'offline'}</strong>
              </div>
              <div style={rowStyle}>
                <span>Providers configured</span>
                <strong>{config?.cloudProviders.length ?? 0}</strong>
              </div>
              <button type="button" style={btnStyle} onClick={() => setState('paused')}>Pause all</button>
              {' '}
              <button type="button" style={btnStyle} onClick={() => setState('idle')}>Resume</button>
              <p style={{ color: '#64748b', fontSize: 12, ...sectionStyle }}>
                Chat runs through the configured cloud route under the zero-additional-spend
                policy. Observation, connectors and job workers activate per scope as they
                come online. Nothing runs while paused.
              </p>
            </div>
          )}
          {tab === 'providers' && (
            <div>
              <h3 style={{ marginBottom: 4 }}>Cloud providers</h3>
              {(config?.cloudProviders ?? []).map(p => (
                <div key={p.endpointId} style={rowStyle}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="radio"
                      name="selected-provider"
                      checked={config?.selectedProviderId === p.endpointId}
                      onChange={() => void onSelectProvider(p.endpointId)}
                    />
                    <span>
                      <strong>{p.endpointId}</strong>
                      <br />
                      <span style={{ color: '#64748b', fontSize: 12 }}>
                        {p.baseUrl} · {p.model ?? 'default model'} · {p.keyPresent ? 'key vaulted' : 'no key this session'}
                      </span>
                    </span>
                  </label>
                  <button type="button" style={btnStyle} onClick={() => void onDeleteProvider(p.endpointId)}>✕</button>
                </div>
              ))}
              {(config?.cloudProviders ?? []).length === 0 && (
                <p style={{ color: '#64748b' }}>No providers configured yet.</p>
              )}
              <h3 style={{ marginBottom: 4 }}>Add provider</h3>
              <SettingsPanel onSave={(p) => void onSaveProvider(p)} saving={saving} />
              <p style={{ color: '#64748b', fontSize: 12, ...sectionStyle }}>
                Keys are encrypted by the OS (DPAPI/keychain) and never stored in plain text;
                the persisted config stores opaque handles only.
              </p>
            </div>
          )}
          {notice && <p style={{ color: '#fbbf24' }}>{notice}</p>}
        </div>
      </Panel>
    </div>
  );
}
