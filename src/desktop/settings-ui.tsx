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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  boxSizing: 'border-box',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#e2e8f0',
};

export function SettingsPanel({ onSave, saving }: { onSave: (p: SaveProviderPayload) => void; saving?: boolean }): React.ReactElement {
  const [form, setForm] = useState<ProviderForm>({ ...EMPTY_FORM });
  const set = (patch: Partial<ProviderForm>) => setForm(f => ({ ...f, ...patch }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formToPayload(form)); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label>Provider id
        <input style={inputStyle} value={form.endpointId} placeholder="openai" onChange={e => set({ endpointId: e.target.value })} />
      </label>
      <label>Base URL
        <input style={inputStyle} value={form.baseUrl} placeholder="https://api.openai.com/v1" onChange={e => set({ baseUrl: e.target.value })} />
      </label>
      <label>API key (encrypted by the OS and restored automatically on next launch)
        <input style={inputStyle} type="password" value={form.apiKey} onChange={e => set({ apiKey: e.target.value })} />
      </label>
      <label>Model (optional)
        <input style={inputStyle} value={form.model} placeholder="gpt-4o-mini" onChange={e => set({ model: e.target.value })} />
      </label>
      <label>
        <input type="checkbox" checked={form.includedCost} onChange={e => set({ includedCost: e.target.checked })} /> Included cost (zero additional spend) — tick to enable chat on this provider
      </label>
      <label>Allowed data scopes (comma)
        <input style={inputStyle} value={form.allowedDataScopes} onChange={e => set({ allowedDataScopes: e.target.value })} />
      </label>
      <button type="submit" disabled={saving === true}>Save provider</button>
    </form>
  );
}
