// Settings UI (React) — lets user add cloud providers, store keys via broker handle.
import React, { useState } from 'react';

export interface ProviderForm {
  endpointId: string;
  baseUrl: string;
  apiKey: string; // entered here, immediately handed to broker; never stored
  includedCost: boolean;
  allowedDataScopes: string;
}

export function SettingsPanel({ onSave }: { onSave: (f: ProviderForm) => void }): React.ReactElement {
  const [form, setForm] = useState<ProviderForm>({
    endpointId: '', baseUrl: '', apiKey: '', includedCost: false, allowedDataScopes: 'public',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label>Provider id<input value={form.endpointId} onChange={e => setForm({ ...form, endpointId: e.target.value })} /></label>
      <label>Base URL<input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} /></label>
      <label>API key (handed to broker, not stored)<input type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} /></label>
      <label><input type="checkbox" checked={form.includedCost} onChange={e => setForm({ ...form, includedCost: e.target.checked })} /> Included cost (zero additional spend)</label>
      <label>Allowed data scopes (comma)<input value={form.allowedDataScopes} onChange={e => setForm({ ...form, allowedDataScopes: e.target.value })} /></label>
      <button type="submit">Save provider</button>
    </form>
  );
}
