import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../../src/storage/settings.js';

const dirs: string[] = [];
function makeStore(): { store: SettingsStore; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-settings-'));
  dirs.push(dir);
  const file = join(dir, 'fairy-config.json');
  return { store: new SettingsStore(file), file };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('round-trips a valid config', () => {
    const { store, file } = makeStore();
    store.save({
      cloudProviders: [{
        endpointId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authHandle: 'cred_abc',
        includedCost: true,
        allowedDataScopes: ['public'],
      }],
      allowLocalModels: false,
    });
    expect(store.exists()).toBe(true);
    const cfg = store.load();
    expect(cfg.cloudProviders[0]?.endpointId).toBe('openai');
    expect(cfg.cloudProviders[0]?.authHandle).toBe('cred_abc');
  });

  it('load() on missing file returns safe defaults', () => {
    const { store } = makeStore();
    expect(store.load()).toEqual({ cloudProviders: [], allowLocalModels: false });
  });

  it('load() on corrupt file returns safe defaults', () => {
    const { store, file } = makeStore();
    store.save({ cloudProviders: [], allowLocalModels: false });
    writeFileSync(file, '{not json');
    expect(store.load()).toEqual({ cloudProviders: [], allowLocalModels: false });
  });

  it('secret-shaped fields never reach the file even if passed through save()', () => {
    const { store, file } = makeStore();
    const sneaky = {
      cloudProviders: [{
        endpointId: 'x',
        baseUrl: 'https://api.example.com/v1',
        authHandle: 'cred_x',
        includedCost: true,
        allowedDataScopes: ['public'],
        apiKey: 'sk-SHOULD-NOT-PERSIST',
        nested: { token: 'also-nope' },
      }],
      allowLocalModels: false,
    };
    store.save(sneaky as Parameters<SettingsStore['save']>[0]);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('sk-SHOULD-NOT-PERSIST');
    expect(raw).not.toContain('also-nope');
  });

  it('invalid providers are dropped at load, not just at save', () => {
    const { store, file } = makeStore();
    writeFileSync(file, JSON.stringify({
      cloudProviders: [{ endpointId: 'evil', baseUrl: 'file:///etc/passwd' }],
    }));
    expect(store.load().cloudProviders).toEqual([]);
  });
});
