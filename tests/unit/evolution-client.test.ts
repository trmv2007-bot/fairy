import { describe, it, expect, vi, afterEach } from 'vitest';
import { EvolutionClient } from '../../src/evolution/client.js';

// The evolution client is the self-modification approval path. Its contract is
// FAIL CLOSED: anything other than an explicit, well-formed "passed: true" from
// the evaluator results in passed:false. A stub that defaulted to true would let
// every candidate self-approve (the attack UpgradeGate.cs exists to prevent).
describe('EvolutionClient fail-closed', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the evaluator verdict on a well-formed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ candidateId: 'c1', passed: true, checks: ['baseline'] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    const client = new EvolutionClient('http://127.0.0.1:5099');
    const receipt = await client.requestEvaluation('c1');
    expect(receipt.passed).toBe(true);
    expect(receipt.checks).toEqual(['baseline']);
  });

  it('fails closed when the evaluator is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const receipt = await new EvolutionClient('http://127.0.0.1:1').requestEvaluation('c2');
    expect(receipt.passed).toBe(false);
    expect(receipt.checks).toContain('evaluator-unreachable');
  });

  it('fails closed on HTTP error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const receipt = await new EvolutionClient('http://127.0.0.1:5099').requestEvaluation('c3');
    expect(receipt.passed).toBe(false);
    expect(receipt.checks).toContain('evaluator-http-500');
  });

  it('fails closed on malformed response bodies (no passed field)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"hello":"world"}', { status: 200 })));
    const receipt = await new EvolutionClient('http://127.0.0.1:5099').requestEvaluation('c4');
    expect(receipt.passed).toBe(false);
    expect(receipt.checks).toContain('evaluator-malformed-response');
  });

  it('fails closed when passed is not a boolean (string "true" is not approval)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"passed":"true"}', { status: 200 })));
    const receipt = await new EvolutionClient('http://127.0.0.1:5099').requestEvaluation('c5');
    expect(receipt.passed).toBe(false);
  });

  it('sends the candidate id to the evaluate endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ candidateId: 'c6', passed: false, checks: [] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await new EvolutionClient('http://127.0.0.1:5099/').requestEvaluation('c6');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://127.0.0.1:5099/evaluate');
    expect(JSON.parse(String(init.body))).toMatchObject({ candidateId: 'c6' });
  });
});
