import { describe, it, expect } from 'vitest';
import { loadConfig, sanitizeProvider, sanitizeConfigForPersist } from '../../src/providers/config.js';

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
