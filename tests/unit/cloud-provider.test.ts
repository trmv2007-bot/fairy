import { describe, it, expect } from 'vitest';
import { CloudProvider, CloudRouteError } from '../../src/providers/cloud.js';
import type { CloudProviderConfig } from '../../src/providers/cloud.js';

function okFetch(body: unknown = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({
      model: 'm-1',
      choices: [{ message: { content: 'pong' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

function baseCfg(): CloudProviderConfig {
  return {
    endpointId: 'test',
    baseUrl: 'https://api.example.com/v1',
    authHandle: 'cred_x',
    includedCost: true,
    allowedDataScopes: ['public'],
  };
}

describe('CloudProvider.complete', () => {
  it('returns provider content on success', async () => {
    const p = new CloudProvider(baseCfg(), okFetch());
    const res = await p.complete('ping', { apiKey: 'sk-1' });
    expect(res.content).toBe('pong');
    expect(res.model).toBe('m-1');
    expect(res.usage?.promptTokens).toBe(3);
  });

  it('fails closed without included-cost consent (zero-additional-spend)', async () => {
    const p = new CloudProvider({ ...baseCfg(), includedCost: false }, okFetch());
    await expect(p.complete('ping', { apiKey: 'sk-1' })).rejects.toThrow(CloudRouteError);
    await expect(p.complete('ping', { apiKey: 'sk-1' })).rejects.toThrow(/zero-additional-spend|blocked/);
  });

  it('fails closed without a resolved key', async () => {
    const p = new CloudProvider(baseCfg(), okFetch());
    await expect(p.complete('ping')).rejects.toThrow(/no API key resolved/);
  });

  it('surfaces provider HTTP errors', async () => {
    const errFetch = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const p = new CloudProvider(baseCfg(), errFetch);
    await expect(p.complete('ping', { apiKey: 'sk-1' })).rejects.toThrow(/HTTP 429/);
  });

  it('surfaces network errors', async () => {
    const boom = (async () => { throw new Error('socket down'); }) as unknown as typeof fetch;
    const p = new CloudProvider(baseCfg(), boom);
    await expect(p.complete('ping', { apiKey: 'sk-1' })).rejects.toThrow(/network error/);
  });

  it('rejects non-http baseUrl', async () => {
    const p = new CloudProvider({ ...baseCfg(), baseUrl: 'file:///etc/passwd' }, okFetch());
    await expect(p.complete('ping', { apiKey: 'sk-1' })).rejects.toThrow(/baseUrl must be http/);
  });

  it('rejects malformed provider payloads missing completion content', async () => {
    const empty = (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    const p = new CloudProvider(baseCfg(), empty);
    await expect(p.complete('ping', { apiKey: 'sk-1' })).rejects.toThrow(/missing completion content/);
  });
});

describe('keyless local chat (v0.6, Ollama)', () => {
  it('chats with no API key when keyless is set', async () => {
    const p = new CloudProvider({ ...baseCfg(), keyless: true, baseUrl: 'http://localhost:11434/v1' }, okFetch());
    const res = await p.complete('ping', {});
    expect(res.content).toBe('pong');
  });

  it('still refuses keyless without included-cost consent', async () => {
    const p = new CloudProvider({ ...baseCfg(), keyless: true, includedCost: false }, okFetch());
    await expect(p.complete('ping', {})).rejects.toThrow(/zero-additional-spend/);
  });

  it('non-keyless providers still require a key', async () => {
    const p = new CloudProvider(baseCfg(), okFetch());
    await expect(p.complete('ping', {})).rejects.toThrow(/no API key resolved/);
  });
});
