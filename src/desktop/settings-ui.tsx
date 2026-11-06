// Settings UI (React) — lets the user add cloud providers. The API key is handed to
// the main-process vault via the typed bridge; it is encrypted by the OS
// (DPAPI/keychain) and persisted, so it survives restarts.
import React, { useState } from 'react';
import type { SaveProviderPayload } from './bridge.js';

export interface ProviderForm {
  endpointId: string;
  baseUrl: string;
  apiKey: string; // entered here, immediately vaulted by the main process; never stored
  model: string;
  includedCost: boolean;
  allowedDataScopes: string; // comma-separated text field
}

// Default scopes must cover what chat actually requests ('public', 'internal') —
// otherwise a freshly added provider can never route and chat fails for new users.
export const EMPTY_FORM: ProviderForm = {
  endpointId: '', baseUrl: '', apiKey: '', model: '', includedCost: false, allowedDataScopes: 'public, internal',
};

export function formToPayload(form: ProviderForm): SaveProviderPayload {
  const model = form.model.trim();
  return {
    endpointId: form.endpointId.trim(),
    baseUrl: form.baseUrl.trim(),
    ...(model === '' ? {} : { model }),
    includedCost: form.includedCost,
    allowedDataScopes: form.allowedDataScopes.split(',').map(s => s.trim()).filter(s => s.length > 0),
    ...(form.apiKey.trim() === '' ? {} : { apiKey: form.apiKey.trim() }),
  };
}

export function SettingsPanel({ onSave, saving }: { onSave: (p: SaveProviderPayload) => void; saving?: boolean }): React.ReactElement {
  const [form, setForm] = useState<ProviderForm>({ ...EMPTY_FORM });
  const set = (patch: Partial<ProviderForm>) => setForm(f => ({ ...f, ...patch }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formToPayload(form)); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label>
        <span className="f-label">Provider id</span>
        <input className="f-input" style={{ marginTop: 3 }} value={form.endpointId} placeholder="openai" onChange={e => set({ endpointId: e.target.value })} />
      </label>
      <label>
        <span className="f-label">Base URL</span>
        <input className="f-input" style={{ marginTop: 3 }} value={form.baseUrl} placeholder="https://api.openai.com/v1" onChange={e => set({ baseUrl: e.target.value })} />
      </label>
      <label>
        <span className="f-label">API key (encrypted by the OS, restored on next launch)</span>
        <input className="f-input" style={{ marginTop: 3 }} type="password" value={form.apiKey} onChange={e => set({ apiKey: e.target.value })} />
      </label>
      <label>
        <span className="f-label">Model (optional)</span>
        <input className="f-input" style={{ marginTop: 3 }} value={form.model} placeholder="gpt-4o-mini" onChange={e => set({ model: e.target.value })} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={form.includedCost} onChange={e => set({ includedCost: e.target.checked })} />
        <span>Included cost (zero additional spend) — tick to enable chat on this provider</span>
      </label>
      <label>
        <span className="f-label">Allowed data scopes (comma)</span>
        <input className="f-input" style={{ marginTop: 3 }} value={form.allowedDataScopes} onChange={e => set({ allowedDataScopes: e.target.value })} />
      </label>
      <button type="submit" className="f-btn f-btn-primary" disabled={saving === true}>Save provider</button>
    </form>
  );
}
