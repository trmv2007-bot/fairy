import { describe, it, expect } from 'vitest';
import { CloudProvider } from '../../src/providers/cloud.js';
import type { CloudChatMessage, CloudToolSpec } from '../../src/providers/cloud.js';

function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const cfg = {
  endpointId: 'mock',
  baseUrl: 'http://127.0.0.1:1/v1',
  authHandle: 'cred_00000000-0000-0000-0000-000000000000',
  includedCost: true,
  allowedDataScopes: ['public'],
};

const tools: CloudToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: 'read the device',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('CloudProvider function calling (wire protocol)', () => {
  it('sends tools + tool_choice and serializes assistant/tool messages correctly', async () => {
    let captured: { model?: string; messages?: unknown[]; tools?: unknown; tool_choice?: unknown } = {};
    const provider = new CloudProvider(cfg, async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ model: 'm', choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const messages: CloudChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'status' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'system_info', arguments: '{}' }],
      },
      { role: 'tool', content: '{"cores":4}', toolCallId: 'call_1' },
    ];
    const completion = await provider.chat(messages, { apiKey: 'sk-x', tools });
    expect(completion.content).toBe('ok');
    expect(captured.tools).toEqual(tools);
    expect(captured.tool_choice).toBe('auto');
    const wire = captured.messages as { role: string; tool_calls?: unknown; tool_call_id?: string }[];
    expect(wire[2]?.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'system_info', arguments: '{}' } },
    ]);
    expect(wire[3]?.tool_call_id).toBe('call_1');
    expect(wire[3]?.role).toBe('tool');
  });

  it('omits the tools field entirely when no tools are supplied', async () => {
    let captured: Record<string, unknown> = {};
    const provider = new CloudProvider(cfg, async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ model: 'm', choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    await provider.chat([{ role: 'user', content: 'hi' }], { apiKey: 'sk-x' });
    expect('tools' in captured).toBe(false);
    expect('tool_choice' in captured).toBe(false);
  });

  it('parses tool_calls from a non-streaming response (empty content allowed)', async () => {
    const provider = new CloudProvider(cfg, async () => new Response(
      JSON.stringify({
        model: 'm',
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'fs_search', arguments: '{"query":"notes"}' } }],
          },
        }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const completion = await provider.chat([{ role: 'user', content: 'find notes' }], { apiKey: 'sk-x', tools });
    expect(completion.content).toBe('');
    expect(completion.toolCalls).toEqual([
      { id: 'call_9', name: 'fs_search', arguments: '{"query":"notes"}' },
    ]);
  });
});

describe('CloudProvider.chatStream tool_call fragments', () => {
  it('assembles tool calls from fragmented deltas across SSE chunks', async () => {
    const provider = new CloudProvider(cfg, async () => sseResponse([
      // fragment 1: id + name
      'data: {"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"system_info","arguments":""}}]}}]}',
      // fragment 2-3: argument JSON split mid-string
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"se"}}]}}]}',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ction\\":\\"system\\"}"}}]}}]}',
      'data: [DONE]',
    ]));
    const chunks: string[] = [];
    const completion = await provider.chatStream([{ role: 'user', content: 'go' }], { apiKey: 'sk-x', tools }, d => chunks.push(d));
    expect(chunks).toEqual([]); // tool fragments are not text deltas
    expect(completion.content).toBe('');
    expect(completion.toolCalls).toEqual([
      { id: 'call_1', name: 'system_info', arguments: '{"section":"system"}' },
    ]);
  });

  it('keeps parallel tool calls separate by index', async () => {
    const provider = new CloudProvider(cfg, async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a1","function":{"name":"system_info","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"a2","function":{"name":"power_status","arguments":"{}"}}]}}]}',
      'data: [DONE]',
    ]));
    const completion = await provider.chatStream([{ role: 'user', content: 'go' }], { apiKey: 'sk-x', tools }, () => {});
    expect(completion.toolCalls?.map(t => t.name)).toEqual(['system_info', 'power_status']);
    expect(completion.toolCalls?.map(t => t.id)).toEqual(['a1', 'a2']);
  });

  it('mixes text deltas and tool calls in one stream', async () => {
    const provider = new CloudProvider(cfg, async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Inspecting"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"system_info","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{"content":" now."}}]}',
      'data: [DONE]',
    ]));
    const chunks: string[] = [];
    const completion = await provider.chatStream([{ role: 'user', content: 'go' }], { apiKey: 'sk-x', tools }, d => chunks.push(d));
    expect(chunks).toEqual(['Inspecting', ' now.']);
    expect(completion.content).toBe('Inspecting now.');
    expect(completion.toolCalls).toEqual([{ id: 't1', name: 'system_info', arguments: '{}' }]);
  });
});
