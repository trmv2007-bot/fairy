import React, { useCallback, useEffect, useState } from 'react';
import { Orb } from './Orb.js';
import { Panel } from './Panel.js';
import { SettingsPanel } from '../settings-ui.js';
import type { PersistedConfigWire, SaveProviderPayload } from '../bridge.js';

type OrbState = 'idle' | 'listening' | 'thinking' | 'working' | 'approval-needed' | 'paused' | 'error';

const sectionStyle: React.CSSProperties = { marginTop: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  gap: 8, padding: '6px 8px', background: '#1e293b', borderRadius: 4, marginBottom: 6,
};
const btnStyle: React.CSSProperties = { cursor: 'pointer' };

export function App(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'status' | 'providers'>('status');
  const [state, setState] = useState<OrbState>('idle');
  const [config, setConfig] = useState<PersistedConfigWire | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.fairy.settings.load().then(res => {
      if (res.config) setConfig(res.config);
      else setNotice(res.error ?? 'failed to load settings');
    }).catch(() => setNotice('failed to load settings'));
  }, []);

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
        <h2 style={{ marginTop: 0 }}>Fairy</h2>
        <p style={{ marginTop: 0, color: '#94a3b8' }}>Strong, dry, competent.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button type="button" style={btnStyle} onClick={() => setTab('status')}>Status</button>
          <button type="button" style={btnStyle} onClick={() => setTab('providers')}>Providers</button>
        </div>
        {tab === 'status' ? (
          <div>
            <div style={rowStyle}>
              <span>Assistant state</span>
              <strong>{state}</strong>
            </div>
            <button type="button" style={btnStyle} onClick={() => setState('paused')}>Pause all</button>
            {' '}
            <button type="button" style={btnStyle} onClick={() => setState('idle')}>Resume</button>
            <p style={{ color: '#64748b', fontSize: 12, ...sectionStyle }}>
              Observation, connectors and cloud routes activate per job scope. Nothing runs while paused.
            </p>
          </div>
        ) : (
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
              Keys are held in memory for this session and never written to disk; the persisted config
              stores opaque handles only. Long-term storage moves to the native broker credential store (T05).
            </p>
          </div>
        )}
        {notice && <p style={{ color: '#fbbf24' }}>{notice}</p>}
      </Panel>
    </div>
  );
}
