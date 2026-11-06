import { describe, it, expect } from 'vitest';
import { CloudProvider, CloudRouteError } from '../../src/providers/cloud.js';
import type { CloudChatMessage } from '../../src/providers/cloud.js';

function sseResponse(lines: string[], headers: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } });
}

const cfg = {
  endpointId: 'mock',
  baseUrl: 'http://127.0.0.1:1/v1',
  authHandle: 'cred_00000000-0000-0000-0000-000000000000',
  includedCost: true,
  allowedDataScopes: ['public'],
};

const messages: CloudChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hello' },
];

describe('CloudProvider.chatStream', () => {
  it('assembles streamed deltas and reports model', async () => {
    const provider = new CloudProvider(cfg, async () => sseResponse([
      'data: {"model":"mock-model","choices":[{"delta":{"content":"Hel"}}]}',
      '',
      'data: {"model":"mock-model","choices":[{"delta":{"content":"lo "}}]}',
      'data: {"choices":[{"delta":{"content":"world"}}]}',
      'data: [DONE]',
      '',
    ]));
    const seen: string[] = [];
    const completion = await provider.chatStream(messages, { apiKey: 'sk-x' }, d => seen.push(d));
    expect(seen).toEqual(['Hel', 'lo ', 'world']);
    expect(completion.content).toBe('Hello world');
    expect(completion.model).toBe('mock-model');
  });

  it('falls back to JSON parsing when the provider ignores stream:true', async () => {
    const provider = new CloudProvider(cfg, async () => new Response(
      JSON.stringify({ model: 'm', choices: [{ message: { content: 'plain' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const seen: string[] = [];
    const completion = await provider.chatStream(messages, { apiKey: 'sk-x' }, d => seen.push(d));
    expect(seen).toEqual(['plain']);
    expect(completion.content).toBe('plain');
  });

  it('tolerates keep-alive noise and malformed lines', async () => {
    const provider = new CloudProvider(cfg, async () => sseResponse([
      ': keep-alive',
      'data: not-json',
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      'data: [DONE]',
    ]));
    const completion = await provider.chatStream(messages, { apiKey: 'sk-x' }, () => {});
    expect(completion.content).toBe('ok');
  });

  it('fails closed on blocked spend / missing key', async () => {
    const noSpend = new CloudProvider({ ...cfg, includedCost: false }, async () => {
      throw new Error('should not be called');
    });
    await expect(noSpend.chatStream(messages, { apiKey: 'sk-x' }, () => {})).rejects.toBeInstanceOf(CloudRouteError);
    const noKey = new CloudProvider(cfg, async () => { throw new Error('should not be called'); });
    await expect(noKey.chatStream(messages, {}, () => {})).rejects.toBeInstanceOf(CloudRouteError);
  });

  it('errors on HTTP failure and empty streams', async () => {
    const http500 = new CloudProvider(cfg, async () => new Response('boom', { status: 500 }));
    await expect(http500.chatStream(messages, { apiKey: 'k' }, () => {})).rejects.toThrow(/HTTP 500/);
    const empty = new CloudProvider(cfg, async () => sseResponse(['data: [DONE]']));
    await expect(empty.chatStream(messages, { apiKey: 'k' }, () => {})).rejects.toThrow(/no content/);
  });
});

describe('CloudProvider.chat (message list)', () => {
  it('sends full message list and returns completion', async () => {
    let capturedBody: unknown;
    const provider = new CloudProvider(cfg, async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ model: 'm1', choices: [{ message: { content: 'hi there' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const completion = await provider.chat(messages, { apiKey: 'sk-x' });
    expect(completion).toMatchObject({ content: 'hi there', model: 'm1', usage: { promptTokens: 5, completionTokens: 2 } });
    const body = capturedBody as { messages: unknown[]; stream?: boolean };
    expect(body.messages).toHaveLength(2);
    expect(body.stream).toBeUndefined();
  });

  it('complete() still works for the single-prompt path', async () => {
    const provider = new CloudProvider(cfg, async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
      expect(body.messages).toEqual([{ role: 'user', content: 'solo' }]);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    const completion = await provider.complete('solo', { apiKey: 'k' });
    expect(completion.content).toBe('ok');
  });
});
