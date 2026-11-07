import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, sanitizeProvider, sanitizeConfigForPersist, effectivePool, isPrivateHttpHost } from '../../src/providers/config.js';
import { SettingsStore } from '../../src/storage/settings.js';

describe('loadConfig sanitization', () => {
  it('returns defaults for non-object input', () => {
    expect(loadConfig(null)).toEqual({ cloudProviders: [], allowLocalModels: false });
    expect(loadConfig('nope')).toEqual({ cloudProviders: [], allowLocalModels: false });
    expect(loadConfig([1, 2])).toEqual({ cloudProviders: [], allowLocalModels: false });
  });

  it('drops malformed providers (bad baseUrl, missing id)', () => {
    const cfg = loadConfig({
      cloudProviders: [
        { endpointId: 'good', baseUrl: 'https://api.example.com/v1', allowedDataScopes: ['public'], includedCost: true },
        { endpointId: '', baseUrl: 'https://api.example.com/v1' },
        { endpointId: 'badurl', baseUrl: 'not-a-url' },
        { endpointId: 'fileurl', baseUrl: 'file:///etc/passwd' },
        'garbage',
        null,
      ],
    });
    expect(cfg.cloudProviders.length).toBe(1);
    expect(cfg.cloudProviders[0]?.endpointId).toBe('good');
  });

  it('strips unknown fields from provider entries', () => {
    const p = sanitizeProvider({
      endpointId: 'x',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-LEAK',
      token: 'secret',
      __proto__: { evil: true },
      allowedDataScopes: ['public'],
    });
    expect(p).not.toBeNull();
    expect(JSON.stringify(p)).not.toContain('sk-LEAK');
    expect(JSON.stringify(p)).not.toContain('secret');
  });

  it('rejects non cred_ authHandle values', () => {
    expect(sanitizeProvider({ endpointId: 'x', baseUrl: 'https://a.com/v1', authHandle: 'raw-key-material' })).toBeNull();
    expect(sanitizeProvider({ endpointId: 'x', baseUrl: 'https://a.com/v1', authHandle: 'cred_ok' })).not.toBeNull();
  });

  it('clears a selectedProviderId that does not match any provider', () => {
    const cfg = loadConfig({
      cloudProviders: [],
      selectedProviderId: 'ghost',
    });
    expect(cfg.selectedProviderId).toBeUndefined();
  });

  it('keeps allowLocalModels false unless explicitly true (cloud-only policy)', () => {
    expect(loadConfig({}).allowLocalModels).toBe(false);
    expect(loadConfig({ allowLocalModels: 'yes' }).allowLocalModels).toBe(false);
    expect(loadConfig({ allowLocalModels: true }).allowLocalModels).toBe(true);
  });

  it('round-trips a well-formed agreement timestamp, drops malformed ones', () => {
    const good = '2026-11-07T05:41:00.000Z';
    expect(loadConfig({ agreementAcceptedAt: good }).agreementAcceptedAt).toBe(good);
    expect(loadConfig({}).agreementAcceptedAt).toBeUndefined();
    expect(loadConfig({ agreementAcceptedAt: 'yes' }).agreementAcceptedAt).toBeUndefined();
    expect(loadConfig({ agreementAcceptedAt: '2026-11-07 lies' }).agreementAcceptedAt).toBeUndefined();
    expect(loadConfig({ agreementAcceptedAt: 42 }).agreementAcceptedAt).toBeUndefined();
  });
});

describe('allowCommandExecution (command_run gate)', () => {
  it('defaults off and only activates on an explicit true', () => {
    expect(loadConfig({}).allowCommandExecution).toBeUndefined();
    expect(loadConfig({ allowCommandExecution: true }).allowCommandExecution).toBe(true);
    expect(loadConfig({ allowCommandExecution: false }).allowCommandExecution).toBeUndefined();
    expect(loadConfig({ allowCommandExecution: 'yes' }).allowCommandExecution).toBeUndefined();
    expect(loadConfig({ allowCommandExecution: 1 }).allowCommandExecution).toBeUndefined();
  });

  it('round-trips through persistence (off -> on -> off)', async () => {
    const { SettingsStore } = await import('../../src/storage/settings.js');
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'fairy-cfg-'));
    const file = path.join(dir, 'cfg.json');
    try {
      const store = new SettingsStore(file);
      expect(store.load().allowCommandExecution).toBeUndefined();
      const on = store.load();
      on.allowCommandExecution = true;
      store.save(on);
      expect(store.load().allowCommandExecution).toBe(true);
      const off = store.load();
      delete off.allowCommandExecution;
      store.save(off);
      expect(store.load().allowCommandExecution).toBeUndefined();
      // raw file contains the flag when on
      writeFileSync(file, JSON.stringify({ allowCommandExecution: true }));
      expect(store.load().allowCommandExecution).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sanitizeConfigForPersist', () => {
  it('recursively strips secret-shaped fields at any depth', () => {
    const dirty = {
      cloudProviders: [{ endpointId: 'a', apiKey: 'sk-1', nested: { api_key: 'sk-2', token: 't', password: 'p', keep: 'me' } }],
      topSecret: 'nope',
    };
    const clean = sanitizeConfigForPersist(dirty);
    const json = JSON.stringify(clean);
    expect(json).not.toContain('sk-1');
    expect(json).not.toContain('sk-2');
    expect(json).not.toContain('t"'); // token removed, keep survives
    expect(json).toContain('me');
    expect(clean.topSecret).toBeUndefined();
  });

  it('leaves scalars and arrays untouched', () => {
    expect(sanitizeConfigForPersist(42)).toBe(42);
    expect(sanitizeConfigForPersist(null)).toBeNull();
    expect(sanitizeConfigForPersist(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('activeProviderIds (key pool, v0.4)', () => {
  const providers = [
    { endpointId: 'a', baseUrl: 'https://a.com/v1', allowedDataScopes: ['public'], includedCost: true },
    { endpointId: 'b', baseUrl: 'https://b.com/v1', allowedDataScopes: ['public'], includedCost: true },
  ];

  it('keeps an ordered, deduplicated pool of existing providers', () => {
    const cfg = loadConfig({ cloudProviders: providers, activeProviderIds: ['b', 'a', 'b', 'a'] });
    expect(cfg.activeProviderIds).toEqual(['b', 'a']);
  });

  it('drops ghost ids and non-string entries — a deleted key silently leaves the pool', () => {
    const cfg = loadConfig({ cloudProviders: providers, activeProviderIds: ['a', 'ghost', 42, null, 'b'] });
    expect(cfg.activeProviderIds).toEqual(['a', 'b']);
  });

  it('treats an all-ghost pool as absent (legacy routing, not a dead end)', () => {
    const cfg = loadConfig({ cloudProviders: providers, activeProviderIds: ['ghost'] });
    expect(cfg.activeProviderIds).toBeUndefined();
  });

  it('ignores a non-array pool field entirely', () => {
    expect(loadConfig({ cloudProviders: providers, activeProviderIds: 'a' }).activeProviderIds).toBeUndefined();
  });

  it('effectivePool: explicit pool wins, else legacy selection, else empty', () => {
    const explicit = loadConfig({ cloudProviders: providers, activeProviderIds: ['b', 'a'], selectedProviderId: 'a' });
    expect(effectivePool(explicit)).toEqual(['b', 'a']);
    const legacy = loadConfig({ cloudProviders: providers, selectedProviderId: 'b' });
    expect(effectivePool(legacy)).toEqual(['b']);
    const bare = loadConfig({ cloudProviders: providers });
    expect(effectivePool(bare)).toEqual([]);
  });

  it('survives a settings save/load round-trip (no secret-stripping collision)', () => {
    const store = new SettingsStore(join(tmpdir(), `fairy-pool-${randomUUID()}.json`));
    const cfg = loadConfig({ cloudProviders: providers, activeProviderIds: ['a', 'b'] });
    store.save(cfg);
    expect(store.load().activeProviderIds).toEqual(['a', 'b']);
  });
});

describe('keyless local routes (v0.6, Ollama)', () => {
  it('keeps keyless on loopback/private hosts', () => {
    const p = sanitizeProvider({ endpointId: 'ollama', baseUrl: 'http://localhost:11434/v1', authHandle: '', includedCost: true, allowedDataScopes: ['public'], keyless: true });
    expect(p?.keyless).toBe(true);
    const lan = sanitizeProvider({ endpointId: 'lan-llm', baseUrl: 'http://192.168.1.50:11434/v1', authHandle: '', includedCost: true, allowedDataScopes: ['public'], keyless: true });
    expect(lan?.keyless).toBe(true);
  });

  it('silently downgrades keyless on public hosts (no unauthenticated cloud routes)', () => {
    const p = sanitizeProvider({ endpointId: 'evil', baseUrl: 'https://api.example.com/v1', authHandle: '', includedCost: true, allowedDataScopes: ['public'], keyless: true });
    expect(p?.keyless).toBeUndefined();
  });

  it('round-trips keyless through persistence (no secret-stripping collision)', () => {
    const store = new SettingsStore(join(tmpdir(), `fairy-keyless-${randomUUID()}.json`));
    const cfg = loadConfig({ cloudProviders: [{ endpointId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', authHandle: '', includedCost: true, allowedDataScopes: ['public', 'internal'], keyless: true }] });
    store.save(cfg);
    expect(store.load().cloudProviders[0]?.keyless).toBe(true);
    expect(store.load().cloudProviders[0]?.authHandle).toBe('');
  });

  it('isPrivateHttpHost classification', () => {
    expect(isPrivateHttpHost('http://localhost:11434/v1')).toBe(true);
    expect(isPrivateHttpHost('http://127.0.0.1:8080')).toBe(true);
    expect(isPrivateHttpHost('http://10.0.0.5/v1')).toBe(true);
    expect(isPrivateHttpHost('http://172.16.0.1/v1')).toBe(true);
    expect(isPrivateHttpHost('http://172.32.0.1/v1')).toBe(false);
    expect(isPrivateHttpHost('https://api.groq.com/v1')).toBe(false);
    expect(isPrivateHttpHost('not a url')).toBe(false);
  });
});

describe('floatingOrb shell setting (v0.6)', () => {
  it('defaults off and only activates on an explicit true', () => {
    const off = loadConfig({ cloudProviders: [] });
    expect(off.floatingOrb).toBeUndefined();
    const on = loadConfig({ cloudProviders: [], floatingOrb: true });
    expect(on.floatingOrb).toBe(true);
    const junk = loadConfig({ cloudProviders: [], floatingOrb: 'yes' });
    expect(junk.floatingOrb).toBeUndefined();
  });

  it('round-trips through persistence', () => {
    const store = new SettingsStore(join(tmpdir(), `fairy-orb-${randomUUID()}.json`));
    store.save(loadConfig({ cloudProviders: [], floatingOrb: true }));
    expect(store.load().floatingOrb).toBe(true);
    store.save(loadConfig({ cloudProviders: [] }));
    expect(store.load().floatingOrb).toBeUndefined();
  });
});
