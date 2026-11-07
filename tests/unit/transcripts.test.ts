import { describe, it, expect } from 'vitest';
import { ConversationStore } from '../../src/storage/transcripts.js';
import { openInMemoryDatabase } from '../../src/storage/database.js';

function store(): ConversationStore {
  return new ConversationStore(openInMemoryDatabase());
}

describe('ConversationStore', () => {
  it('creates conversations and appends turns with ids + timestamps', () => {
    const s = store();
    const conv = s.createConversation();
    const t1 = s.appendTurn(conv.id, { role: 'user', content: 'hello Fairy' });
    const t2 = s.appendTurn(conv.id, { role: 'assistant', content: 'Affirmative, Master.' });
    expect(t1.id).toMatch(/^msg_/);
    expect(t2.id).toMatch(/^msg_/);
    expect(t1.createdAt).toBeGreaterThan(0);
    const turns = s.getTurns(conv.id);
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant']);
  });

  it('derives the title from the first user turn (one line, truncated)', () => {
    const s = store();
    const conv = s.createConversation();
    s.appendTurn(conv.id, { role: 'user', content: 'what is the battery\nstatus right now?' });
    let list = s.listConversations();
    expect(list[0]?.title).toBe('what is the battery status right now?');

    const conv2 = s.createConversation();
    s.appendTurn(conv2.id, { role: 'user', content: 'x'.repeat(80) });
    list = s.listConversations();
    expect(list[0]?.title).toBe('x'.repeat(48) + '…');
  });

  it('lists newest-first with message counts', async () => {
    const s = store();
    const a = s.createConversation('older');
    const b = s.createConversation('newer');
    s.appendTurn(a.id, { role: 'user', content: 'a1' });
    await new Promise(r => setTimeout(r, 5));
    s.appendTurn(b.id, { role: 'user', content: 'b1' });
    s.appendTurn(b.id, { role: 'assistant', content: 'b2' });
    const list = s.listConversations();
    expect(list.map(c => c.title)).toEqual(['newer', 'older']);
    expect(list[0]?.messageCount).toBe(2);
    expect(list[1]?.messageCount).toBe(1);
  });

  it('searches titles and message content, escaping LIKE wildcards', () => {
    const s = store();
    const c1 = s.createConversation();
    s.appendTurn(c1.id, { role: 'user', content: 'find the quarterly report file' });
    const c2 = s.createConversation('battery question');
    s.appendTurn(c2.id, { role: 'user', content: 'how is the battery' });
    const c3 = s.createConversation('nothing relevant here');
    s.appendTurn(c3.id, { role: 'user', content: 'tell me a joke' });

    expect(s.searchConversations('quarterly').map(c => c.id)).toEqual([c1.id]);
    expect(s.searchConversations('battery').map(c => c.id)).toEqual([c2.id]); // title match
    expect(s.searchConversations('joke').map(c => c.id)).toEqual([c3.id]);
    // '%' must be matched literally, not as a wildcard
    expect(s.searchConversations('%')).toEqual([]);
  });

  it('round-trips tool turns exactly (toolCalls JSON + toolCallId)', () => {
    const s = store();
    const conv = s.createConversation();
    s.appendTurn(conv.id, { role: 'user', content: 'check power' });
    s.appendTurn(conv.id, {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'power_status', arguments: '{}' }],
    });
    s.appendTurn(conv.id, { role: 'tool', content: '{"ok":true,"percent":88}', toolCallId: 'call_1' });
    s.appendTurn(conv.id, { role: 'assistant', content: 'Battery at 88%, Master.' });
    const turns = s.getTurns(conv.id);
    expect(turns[1]?.toolCalls).toEqual([{ id: 'call_1', name: 'power_status', arguments: '{}' }]);
    expect(turns[2]?.toolCallId).toBe('call_1');
    expect(turns[3]?.content).toBe('Battery at 88%, Master.');
  });

  it('latestConversationId + resume semantics + cascade delete', () => {
    const s = store();
    expect(s.latestConversationId()).toBeUndefined();
    const a = s.createConversation('a');
    const b = s.createConversation('b');
    s.appendTurn(a.id, { role: 'user', content: 'old' });
    s.appendTurn(b.id, { role: 'user', content: 'new' });
    expect(s.latestConversationId()).toBe(b.id);
    expect(s.hasConversation(a.id)).toBe(true);
    s.deleteConversation(a.id);
    expect(s.hasConversation(a.id)).toBe(false);
    expect(s.getTurns(a.id)).toEqual([]);
  });

  it('rejects appends to unknown conversations', () => {
    const s = store();
    expect(() => s.appendTurn('conv_missing', { role: 'user', content: 'x' })).toThrow(/unknown conversation/);
  });

  it('caps hostile content sizes without throwing', () => {
    const s = store();
    const conv = s.createConversation();
    s.appendTurn(conv.id, { role: 'user', content: 'y'.repeat(500_000) });
    const turns = s.getTurns(conv.id);
    expect(turns[0]?.content.length).toBe(100_000);
  });
});
