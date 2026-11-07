import { describe, it, expect } from 'vitest';
import {
  probeProvider,
  runDoctor,
  formatReport,
  classifyStatus,
  type DoctorProviderReport,
} from '../../src/desktop/doctor.js';

function okFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
}

const BASE = { endpointId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', authHandle: 'cred_x' };

describe('fairy-doctor', () => {
  it('classifies key health from HTTP status', () => {
    expect(classifyStatus(200)).toBe('ok');
    expect(classifyStatus(401)).toBe('auth-rejected');
    expect(classifyStatus(403)).toBe('auth-rejected');
    expect(classifyStatus(429)).toBe('rate-limited');
    expect(classifyStatus(404)).toBe('http-error');
    expect(classifyStatus(500)).toBe('http-error');
  });

  it('reports ok for a live key', async () => {
    const r = await probeProvider(BASE, 'gsk_test', { fetchImpl: okFetch() });
    expect(r.verdict).toBe('ok');
    expect(r.httpStatus).toBe(200);
    expect(r.keyPresent).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
  });

  it('treats 429 as a VALID key that is merely rate-limited', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const r = await probeProvider(BASE, 'gsk_test', { fetchImpl });
    expect(r.verdict).toBe('rate-limited');
    expect(r.detail).toMatch(/VALID/i);
  });

  it('reports auth rejection on 401/403 without leaking the key', async () => {
    const fetchImpl = (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch;
    const r = await probeProvider(BASE, 'gsk_SECRET', { fetchImpl });
    expect(r.verdict).toBe('auth-rejected');
    expect(JSON.stringify(r)).not.toContain('gsk_SECRET');
  });

  it('does not contact the endpoint when no key is vaulted', async () => {
    let called = 0;
    const fetchImpl = (async () => { called++; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const r = await probeProvider(BASE, undefined, { fetchImpl });
    expect(r.verdict).toBe('no-key');
    expect(called).toBe(0);
  });

  it('maps timeouts and network failures to network-error', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const timeoutFetch = (async () => { throw abort; }) as unknown as typeof fetch;
    const r1 = await probeProvider(BASE, 'k', { fetchImpl: timeoutFetch, timeoutMs: 5 });
    expect(r1.verdict).toBe('network-error');
    expect(r1.detail).toMatch(/unreachable/i);

    const netFail = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const r2 = await probeProvider(BASE, 'k', { fetchImpl: netFail });
    expect(r2.verdict).toBe('network-error');
    expect(r2.detail).toMatch(/ECONNREFUSED/);
  });

  it('rejects malformed base URLs as bad-config', async () => {
    const r = await probeProvider({ ...BASE, baseUrl: 'not-a-url' }, 'k', { fetchImpl: okFetch() });
    expect(r.verdict).toBe('bad-config');
  });

  it('runDoctor aggregates: one keyless member does not break a live pool', async () => {
    const report = await runDoctor({
      providers: [
        { ...BASE },
        { endpointId: 'backup', baseUrl: 'https://backup.example/v1', authHandle: 'cred_y' },
        { endpointId: 'idle', baseUrl: 'https://idle.example/v1', authHandle: '' },
      ],
      resolveKey: (h) => (h === 'cred_x' ? 'key-a' : h === 'cred_y' ? 'key-b' : undefined),
      encryptionAvailable: true,
      persistedKeys: 2,
      journalAvailable: true,
      pool: ['groq', 'backup'],
      probeOpts: { fetchImpl: (async (url: string | URL) =>
        String(url).startsWith('https://backup.')
          ? new Response('{}', { status: 429 })
          : new Response('{}', { status: 200 })) as unknown as typeof fetch },
    });
    expect(report.providers.map(p => p.verdict)).toEqual(['ok', 'rate-limited', 'no-key']);
    expect(report.overallOk).toBe(true); // failover covers the keyless member
    expect(formatReport(report)).toContain('ALL SYSTEMS NOMINAL');
  });

  it('runDoctor flags a dead keyed route as attention required', async () => {
    const report = await runDoctor({
      providers: [
        { ...BASE },
        { endpointId: 'backup', baseUrl: 'https://backup.example/v1', authHandle: 'cred_y' },
      ],
      resolveKey: (h) => (h === 'cred_x' ? 'key-a' : 'key-b'),
      encryptionAvailable: true,
      persistedKeys: 2,
      journalAvailable: true,
      pool: ['groq', 'backup'],
      probeOpts: { fetchImpl: (async (url: string | URL) =>
        String(url).startsWith('https://backup.')
          ? new Response('{}', { status: 401 })
          : new Response('{}', { status: 200 })) as unknown as typeof fetch },
    });
    expect(report.providers[1]?.verdict).toBe('auth-rejected');
    expect(report.overallOk).toBe(false);
    expect(formatReport(report)).toContain('ATTENTION REQUIRED');
  });

  it('runDoctor with no providers reports the empty state', async () => {
    const report = await runDoctor({
      providers: [],
      resolveKey: () => undefined,
      encryptionAvailable: true,
      persistedKeys: 0,
      journalAvailable: true,
      pool: [],
    });
    expect(report.overallOk).toBe(false);
    expect(formatReport(report)).toContain('NO PROVIDERS');
  });

  it('overall ok when every keyed provider probes ok', async () => {
    const report = await runDoctor({
      providers: [{ ...BASE }],
      resolveKey: () => 'key-a',
      encryptionAvailable: false,
      persistedKeys: 0,
      journalAvailable: false,
      pool: ['groq'],
      probeOpts: { fetchImpl: okFetch() },
    });
    expect(report.overallOk).toBe(true);
    expect(formatReport(report)).toContain('ALL SYSTEMS NOMINAL');
  });

  it('formatReport never prints raw key material', async () => {
    const reports: DoctorProviderReport[] = [
      await probeProvider(BASE, 'gsk_TOPSECRET', { fetchImpl: okFetch() }),
    ];
    const text = formatReport({
      configOk: true,
      encryptionAvailable: true,
      persistedKeys: 1,
      pool: ['groq'],
      journalAvailable: true,
      providers: reports,
      overallOk: true,
    });
    expect(text).not.toContain('gsk_TOPSECRET');
    expect(text).toContain('vaulted');
  });
});

describe('fairy-doctor · keyless local endpoints', () => {
  it('probes keyless endpoints without an auth header and reports them honestly', async () => {
    let sawAuth: string | undefined;
    const fetchImpl = (async (_url: string | URL, init?: { headers?: Record<string, string> }) => {
      sawAuth = init?.headers?.authorization;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await probeProvider(
      { endpointId: 'ollama', baseUrl: 'http://localhost:11434/v1', keyless: true },
      undefined,
      { fetchImpl },
    );
    expect(sawAuth).toBeUndefined();
    expect(r.verdict).toBe('ok');
    expect(r.keyPresent).toBe(true);
    const text = formatReport({
      configOk: true, encryptionAvailable: true, persistedKeys: 0, pool: ['ollama'],
      journalAvailable: true, providers: [r], overallOk: true,
    });
    expect(text).toContain('none (local endpoint)');
  });

  it('a keyless provider alone makes overallOk achievable (offline-capable)', async () => {
    const report = await runDoctor({
      providers: [{ endpointId: 'ollama', baseUrl: 'http://localhost:11434/v1', authHandle: '', keyless: true }],
      resolveKey: () => undefined,
      encryptionAvailable: true,
      persistedKeys: 0,
      journalAvailable: true,
      pool: ['ollama'],
      probeOpts: { fetchImpl: okFetch() },
    });
    expect(report.overallOk).toBe(true);
  });
});
