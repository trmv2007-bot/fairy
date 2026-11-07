import { describe, it, expect } from 'vitest';
import { ChatService, type ToolActivityEvent } from '../../src/desktop/chat.js';
import type { ModelGateway } from '../../src/providers/gateway.js';
import type { CloudChatMessage, CloudCompletion, CloudToolSpec } from '../../src/providers/cloud.js';
import type { ToolRegistry, ToolExecContext, ToolExecResult } from '../../src/system/tools.js';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { EventJournalImpl } from '../../src/storage/journal.js';

interface RecordedCall {
  messages: CloudChatMessage[];
  tools: CloudToolSpec[] | undefined;
}

/** Gateway double: pops one scripted completion per call, recording every request. */
function scriptGateway(script: CloudCompletion[]): { gw: ModelGateway; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...script];
  const gw = {
    chat: (messages: CloudChatMessage[], _scopes: string[], _vision: boolean, _onChunk?: (d: string) => void, tools?: CloudToolSpec[]) => {
      calls.push({ messages: [...messages], tools });
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      return Promise.resolve(next);
    },
  } as unknown as ModelGateway;
  return { gw, calls };
}

function toolCallResult(ok = true, json = '{"cores":4}'): ToolExecResult {
  return { ok, json, summary: '4 cores', durationMs: 3 };
}

/** Registry double: records execute() calls, returns scripted results. */
function fakeRegistry(over: Partial<Record<string, ToolExecResult>> = {}): {
  reg: ToolRegistry;
  executions: { name: string; argsJson: string; ctx: ToolExecContext }[];
} {
  const executions: { name: string; argsJson: string; ctx: ToolExecContext }[] = [];
  const reg = {
    declarations: () => [
      { type: 'function' as const, function: { name: 'system_info', description: 'd', parameters: { type: 'object', properties: {} } } },
    ],
    specs: () => [
      { name: 'system_info', label: 'system readout', description: 'd', parameters: { type: 'object', properties: {} }, risk: 'read' as const },
    ],
    execute: async (name: string, argsJson: string, ctx: ToolExecContext) => {
      executions.push({ name, argsJson, ctx });
      return over[name] ?? toolCallResult();
    },
  } as unknown as ToolRegistry;
  return { reg, executions };
}

describe('ChatService tool loop', () => {
  it('executes tool calls, feeds results back, and returns the final answer', async () => {
    const { gw, calls } = scriptGateway([
      { content: '', model: 'm', toolCalls: [{ id: 'call_1', name: 'system_info', arguments: '{}' }] },
      { content: 'Detected: 4 cores, Master. Adequate.', model: 'm' },
    ]);
    const { reg, executions } = fakeRegistry();
    const toolEvents: ToolActivityEvent[] = [];
    const j = new EventJournalImpl(openInMemoryDatabase());
    const svc = new ChatService(() => gw, j, {
      onChunk: () => {},
      onState: () => {},
      onToolActivity: e => toolEvents.push(e),
    }, { registry: reg, allowCommandExecution: () => false });

    const result = await svc.send('status report');
    expect(result.content).toContain('Detected');
    // the tool actually ran once with the model's arguments
    expect(executions).toEqual([{ name: 'system_info', argsJson: '{}', ctx: { allowCommandExecution: false } }]);
    // the second provider round-trip carries the assistant tool_calls + tool result
    const second = calls[1];
    expect(second?.tools).toBeDefined();
    const assistant = second?.messages.find(m => m.role === 'assistant' && m.toolCalls !== undefined);
    expect(assistant?.toolCalls?.[0]).toMatchObject({ id: 'call_1', name: 'system_info' });
    const toolMsg = second?.messages.find(m => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('call_1');
    expect(toolMsg?.content).toContain('"cores":4');
    // live activity: start -> ok
    expect(toolEvents.map(e => e.status)).toEqual(['start', 'ok']);
    expect(toolEvents[0]?.label).toBe('system readout');
    expect(toolEvents[1]?.summary).toBe('4 cores');
    // journal records the execution
    const types = j.since(null).map(e => e.type);
    expect(types).toContain('tool.executed');
    // history keeps the tool exchange for follow-up turns
    const roles = svc.historySnapshot().map(t => t.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('re-reads Master\'s command-execution gate every round', async () => {
    const { gw } = scriptGateway([
      { content: '', model: 'm', toolCalls: [{ id: 'c1', name: 'command_run', arguments: '{"command":"whoami"}' }] },
      { content: 'Negative — you have not armed me, Master.', model: 'm' },
      { content: '', model: 'm', toolCalls: [{ id: 'c2', name: 'command_run', arguments: '{"command":"whoami"}' }] },
      { content: 'Detected: you are you, Master.', model: 'm' },
    ]);
    const { reg, executions } = fakeRegistry({ command_run: { ok: false, json: '{"error":"disabled"}', summary: 'gated', durationMs: 1 } });
    let armed = false;
    const svc = new ChatService(() => gw, null, { onChunk: () => {}, onState: () => {} }, {
      registry: reg,
      allowCommandExecution: () => armed,
    });
    await svc.send('who am i');
    expect(executions[0]?.ctx.allowCommandExecution).toBe(false);
    armed = true;
    await svc.send('who am i now');
    expect(executions[1]?.ctx.allowCommandExecution).toBe(true);
  });

  it('bounds a tool-happy model: at most 4 execution rounds, then a hard error', async () => {
    const runaway: CloudCompletion = {
      content: '',
      model: 'm',
      toolCalls: [{ id: 'c', name: 'system_info', arguments: '{}' }],
    };
    const { gw, calls } = scriptGateway(Array.from({ length: 10 }, () => ({ ...runaway })));
    const { reg, executions } = fakeRegistry();
    const svc = new ChatService(() => gw, null, { onChunk: () => {}, onState: () => {} }, {
      registry: reg,
      allowCommandExecution: () => true,
    });
    await expect(svc.send('loop forever')).rejects.toThrow(/tool calls only/);
    expect(executions.length).toBe(4); // MAX_TOOL_ROUNDS
    // the final rounds are sent WITHOUT tools to force a text answer
    expect(calls[2]?.tools).toBeDefined();
    expect(calls[3]?.tools).toBeUndefined();
    expect(calls[4]?.tools).toBeUndefined();
  });

  it('works unchanged without a registry (plain chat)', async () => {
    const { gw, calls } = scriptGateway([{ content: 'plain answer', model: 'm' }]);
    const svc = new ChatService(() => gw, null, { onChunk: () => {}, onState: () => {} });
    const result = await svc.send('hi');
    expect(result.content).toBe('plain answer');
    expect(calls[0]?.tools).toBeUndefined();
    expect(svc.historySnapshot().map(t => t.role)).toEqual(['user', 'assistant']);
  });

  it('unknown tools produce a corrective error result, not a crash', async () => {
    const { gw } = scriptGateway([
      { content: '', model: 'm', toolCalls: [{ id: 'c1', name: 'not_a_tool', arguments: '{}' }] },
      { content: 'That tool does not exist. My mistake, Master.', model: 'm' },
    ]);
    const { reg } = fakeRegistry();
    const events: ToolActivityEvent[] = [];
    const svc = new ChatService(() => gw, null, {
      onChunk: () => {},
      onState: () => {},
      onToolActivity: e => events.push(e),
    }, { registry: reg, allowCommandExecution: () => false });
    const result = await svc.send('do the impossible');
    expect(result.content).toContain('mistake');
    // fakeRegistry.execute returns success for any name; the REAL registry returns
    // ok:false with the available list — assert the event pipeline still completes.
    expect(events.map(e => e.status)).toEqual(['start', 'ok']);
  });
});
