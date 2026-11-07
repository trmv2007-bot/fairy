// Key-pool tests (v0.4): round-robin routing, failover before first delta,
// cooldowns (rate-limit vs dead key), exhaustion aggregation, and state
// preservation across reconfigure. Uses a scripted fetch — no sockets.
import { describe, it, expect } from 'vitest';
import { ModelGateway, type PoolAttemptEvent } from '../../src/providers/gateway.js';
import type { FairyConfig } from '../../src/providers/config.js';
import type { CloudProviderConfig } from '../../src/providers/cloud.js';

interface CallLogEntry {
  key: string;
  url: string;
}

function provider(id: string, handle: string): CloudProviderConfig {
  return {
    endpointId: id,
    baseUrl: `https://${id}.example.com/v1`,
    authHandle: handle,
    includedCost: true,
    allowedDataScopes: ['public', 'internal'],
  };
}

function cfg(providers: CloudProviderConfig[], activeProviderIds?: string[]): FairyConfig {
  return {
    cloudProviders: providers,
    allowLocalModels: false,
    ...(activeProviderIds !== undefined ? { activeProviderIds } : {}),
  };
}

// ── Scripted provider responses, keyed by API key ───────────────────────────

type Behavior =
  | { kind: 'ok'; content: string }
  | { kind: 'http-error'; status: number; body: string }
  | { kind: 'stream-then-die'; firstDelta: string };

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completion(content: string): Response {
  return jsonResponse(200, { model: 'mock', choices: [{ message: { content } }] });
}

function sseResponse(deltas: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const d of deltas) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ model: 'mock', choices: [{ delta: { content: d } }] })}\n\n`));
      }
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function dyingStreamResponse(firstDelta: string): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ model: 'mock', choices: [{ delta: { content: firstDelta } }] })}\n\n`));
      // deferred: error() clears the queue synchronously, so the failure must
      // land AFTER the reader has consumed the first chunk
      setTimeout(() => c.error(new Error('connection reset mid-stream')), 0);
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function makeFetch(behavior: (key: string) => Behavior) {
  const calls: CallLogEntry[] = [];
  const fetchImpl = (url: unknown, init?: { headers?: Record<string, string> }): Promise<Response> => {
    const auth = init?.headers?.['authorization'] ?? '';
    const key = auth.replace(/^Bearer /, '');
    calls.push({ key, url: String(url) });
    const b = behavior(key);
    if (b.kind === 'ok') return Promise.resolve(completion(b.content));
    if (b.kind === 'http-error') {
      return Promise.resolve(jsonResponse(b.status, { error: { message: b.body } }));
    }
    return Promise.resolve(dyingStreamResponse(b.firstDelta));
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function harness(opts: {
  active?: string[];
  behavior: (key: string) => Behavior;
  resolver?: (handle: string) => string | undefined;
  clockStart?: number;
}) {
  const fetchScript = makeFetch(opts.behavior);
  let clock = opts.clockStart ?? 1_000_000;
  const attempts: PoolAttemptEvent[] = [];
  const gw = new ModelGateway(
    cfg([provider('key-a', 'cred_a'), provider('key-b', 'cred_b')], opts.active ?? ['key-a', 'key-b']),
    opts.resolver ?? ((h: string) => (h === 'cred_a' ? 'sk-a' : 'sk-b')),
    {
      fetchImpl: fetchScript.fetchImpl,
      now: () => clock,
      onAttempt: e => attempts.push(e),
    },
  );
  return {
    gw,
    attempts,
    calls: fetchScript.calls,
    advanceClock: (ms: number) => { clock += ms; },
    get clock() { return clock; },
  };
}

const MSGS = [{ role: 'user' as const, content: 'hi' }];

describe('Key pool: round-robin routing', () => {
  it('spreads consecutive requests across all pool keys', async () => {
    const h = harness({ behavior: k => ({ kind: 'ok', content: `reply from ${k}` }) });
    const first = await h.gw.chat(MSGS, ['public']);
    const second = await h.gw.chat(MSGS, ['public']);
    expect([first.content, second.content]).toEqual(['reply from sk-a', 'reply from sk-b']);
    expect(h.calls.map(c => c.key)).toEqual(['sk-a', 'sk-b']);
    expect(h.gw.poolStatus().requests).toBe(2);
    expect(h.attempts).toEqual([]); // no failures, no failovers
  });

  it('routes only through eligible pool members (cost/scope still enforced)', async () => {
    const h = harness({
      active: ['key-a', 'key-b'],
      behavior: k => ({ kind: 'ok', content: `reply from ${k}` }),
    });
    // key-a only consents to 'public' — an 'internal' request must skip it
    const reconfigured = cfg(
      [provider('key-a', 'cred_a'), provider('key-b', 'cred_b')],
      ['key-a', 'key-b'],
    );
    reconfigured.cloudProviders[0]!.allowedDataScopes = ['public'];
    h.gw.reconfigure(reconfigured);
    const res = await h.gw.chat(MSGS, ['public', 'internal']);
    expect(res.content).toBe('reply from sk-b');
    expect(h.calls.map(c => c.key)).toEqual(['sk-b']);
  });
});

describe('Key pool: failover', () => {
  it('fails over to the next key on HTTP 429 and cools the rate-limited key', async () => {
    const h = harness({ behavior: k => (k === 'sk-a' ? { kind: 'http-error', status: 429, body: 'rate limit exceeded' } : { kind: 'ok', content: 'served by b' }) });
    const res = await h.gw.chat(MSGS, ['public']);
    expect(res.content).toBe('served by b');
    expect(h.attempts).toEqual([
      { from: 'key-a', to: 'key-b', reason: 'rate-limited', status: 429 },
    ]);
    const status = h.gw.poolStatus();
    expect(status.lastUsedId).toBe('key-b');
    expect(status.failovers).toBe(1);
    expect(status.cooling.map(c => [c.id, c.reason])).toEqual([['key-a', 'rate-limited']]);
  });

  it('skips a cooling key on the next request, then re-admits it after the cooldown', async () => {
    let aFails = true; // scripted: a is rate-limited until the cooldown window passes
    const h = harness({ behavior: k => (k === 'sk-a' && aFails ? { kind: 'http-error', status: 429, body: 'rl' } : { kind: 'ok', content: `reply from ${k}` }) });
    await h.gw.chat(MSGS, ['public']);          // a 429s -> b serves
    await h.gw.chat(MSGS, ['public']);          // a cooling -> b serves directly
    expect(h.calls.map(c => c.key)).toEqual(['sk-a', 'sk-b', 'sk-b']);
    h.advanceClock(90_001);                     // 429 cooldown expires
    aFails = false;                             // and the provider recovers
    const third = await h.gw.chat(MSGS, ['public']);
    expect(third.content).toBe('reply from sk-a');
    expect(h.calls.map(c => c.key)).toEqual(['sk-a', 'sk-b', 'sk-b', 'sk-a']);
    expect(h.gw.poolStatus().cooling).toEqual([]);
  });

  it('gives a dead key (401) a long cooldown — it stays benched past a rate-limit window', async () => {
    const h = harness({ behavior: k => (k === 'sk-a' ? { kind: 'http-error', status: 401, body: 'bad key' } : { kind: 'ok', content: 'b' }) });
    await h.gw.chat(MSGS, ['public']);
    h.advanceClock(90_001); // past a 429 window, still inside the 401 window
    await h.gw.chat(MSGS, ['public']);
    // key-a is skipped entirely on the second request — never fetched
    expect(h.calls.map(c => c.key)).toEqual(['sk-a', 'sk-b', 'sk-b']);
    expect(h.gw.poolStatus().cooling[0]?.reason).toBe('auth rejected');
  });

  it('aggregates when every key fails, naming each failure', async () => {
    const h = harness({ behavior: () => ({ kind: 'http-error', status: 429, body: 'rl' }) });
    await expect(h.gw.chat(MSGS, ['public'])).rejects.toThrow(
      /all 2 pool key\(s\) failed.*'key-a'.*'key-b'/s,
    );
    expect(h.attempts.at(-1)?.to).toBeNull(); // pool exhausted
    expect(h.gw.poolStatus().failovers).toBe(2);
  });

  it('fails over when a key is missing from the vault (key missing)', async () => {
    const h = harness({
      behavior: k => ({ kind: 'ok', content: `reply from ${k}` }),
      resolver: h2 => (h2 === 'cred_a' ? undefined : 'sk-b'),
    });
    const res = await h.gw.chat(MSGS, ['public']);
    expect(res.content).toBe('reply from sk-b');
    expect(h.attempts[0]?.reason).toBe('key missing');
  });

  it('does NOT fail over after text has already streamed — partial answers stay honest', async () => {
    const h = harness({ behavior: k => (k === 'sk-a' ? { kind: 'stream-then-die', firstDelta: 'Hel' } : { kind: 'ok', content: 'b' }) });
    const seen: string[] = [];
    await expect(h.gw.chat(MSGS, ['public'], false, d => seen.push(d))).rejects.toThrow(/mid-stream/);
    expect(seen).toEqual(['Hel']);
    // key-b was never contacted — a half-delivered answer is not re-rolled
    expect(h.calls.map(c => c.key)).toEqual(['sk-a']);
  });
});

describe('Key pool: status + lifecycle', () => {
  it('poolStatus reports the ordered pool, registered count and session counters', () => {
    const h = harness({ behavior: () => ({ kind: 'ok', content: 'x' }) });
    const s = h.gw.poolStatus();
    expect(s.activeIds).toEqual(['key-a', 'key-b']);
    expect(s.registered).toBe(2);
    expect(s.requests).toBe(0);
    expect(s.failovers).toBe(0);
  });

  it('reconfigure() preserves cooldowns, counters and rotation across settings edits', async () => {
    const h = harness({ behavior: k => (k === 'sk-a' ? { kind: 'http-error', status: 429, body: 'rl' } : { kind: 'ok', content: 'b' }) });
    await h.gw.chat(MSGS, ['public']); // a cooling, b served
    h.gw.reconfigure(cfg([provider('key-a', 'cred_a'), provider('key-b', 'cred_b')], ['key-a', 'key-b']));
    await h.gw.chat(MSGS, ['public']); // a STILL cooling after reconfigure
    expect(h.calls.map(c => c.key)).toEqual(['sk-a', 'sk-b', 'sk-b']);
    expect(h.gw.poolStatus().failovers).toBe(1); // counters survived the rebuild
    expect(h.gw.poolStatus().cooling.map(c => c.id)).toEqual(['key-a']);
  });

  it('a pool of one degrades to plain single-key routing', async () => {
    const h = harness({ active: ['key-a'], behavior: k => ({ kind: 'ok', content: `reply from ${k}` }) });
    const res = await h.gw.chat(MSGS, ['public']);
    expect(res.content).toBe('reply from sk-a');
    expect(h.calls.map(c => c.key)).toEqual(['sk-a']);
  });
});

describe('Key pool: legacy configs keep working', () => {
  it('without a pool, the selected provider is preferred (old single-selection behavior)', async () => {
    const fetchScript = makeFetch(k => ({ kind: 'ok', content: `reply from ${k}` }));
    const gw = new ModelGateway(
      cfg([provider('key-a', 'cred_a'), provider('key-b', 'cred_b')]),
      (h: string) => (h === 'cred_a' ? 'sk-a' : 'sk-b'),
      { fetchImpl: fetchScript.fetchImpl },
    );
    gw.reconfigure({ ...cfg([provider('key-a', 'cred_a'), provider('key-b', 'cred_b')], undefined), selectedProviderId: 'key-b' });
    const res = await gw.chat(MSGS, ['public']);
    expect(res.content).toBe('reply from sk-b');
    expect(fetchScript.calls.map(c => c.key)).toEqual(['sk-b']);
  });
});
