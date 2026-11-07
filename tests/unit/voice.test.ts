import { describe, it, expect, vi } from 'vitest';
import {
  speechAvailable,
  pickVoice,
  forSpeech,
  speak,
  cancelSpeech,
  type SpeechSynthLike,
} from '../../src/desktop/ui/voice.js';

function fakeSynth(voices: { name: string; lang: string }[] = []): SpeechSynthLike & { spoken: unknown[]; cancelled: number } {
  const spoken: unknown[] = [];
  let cancelled = 0;
  return {
    spoken,
    get cancelled() { return cancelled; },
    set cancelled(_: number) { /* unused */ },
    speak(u: unknown) { spoken.push(u); },
    cancel() { cancelled++; },
    getVoices() { return voices; },
  } as SpeechSynthLike & { spoken: unknown[]; cancelled: number };
}

describe('Fairy voice (TTS)', () => {
  it('reports availability from an injected engine; nothing available means silent', () => {
    expect(speechAvailable(fakeSynth())).toBe(true);
    expect(speechAvailable(null)).toBe(false);
    expect(speechAvailable(undefined)).toBe(false);
    // @ts-expect-error — broken engine shape must count as absent
    expect(speechAvailable({ speak: () => {} })).toBe(false);
  });

  it('picks a deterministic English, calm-female-register voice', () => {
    const voices = [
      { name: 'Microsoft David', lang: 'en-US' },
      { name: 'Microsoft Zira', lang: 'en-US' },
      { name: 'Google français', lang: 'fr-FR' },
    ];
    expect(pickVoice(voices)?.name).toBe('Microsoft Zira');
    // No English at all → falls back to the first available voice
    expect(pickVoice([{ name: 'X', lang: 'de-DE' }])?.name).toBe('X');
    expect(pickVoice([])).toBeNull();
  });

  it('forSpeech strips code blocks, urls, markup, and caps the length', () => {
    const out = forSpeech('Here: ```\nSECRET=1\n``` and see https://example.com/x for `details` *now*.');
    expect(out).not.toContain('SECRET=1');
    expect(out).not.toContain('https://');
    expect(out).not.toContain('`');
    expect(out).not.toContain('*');
    expect(out.length).toBeLessThanOrEqual(700 + 1);
    const long = forSpeech('a'.repeat(3000) + '. tail');
    expect(long.length).toBeLessThan(720);
    expect(long).not.toContain('tail'); // cut at the sentence boundary inside the budget
  });

  it('speaks through the engine, replacing any stale utterance', () => {
    const synth = fakeSynth();
    expect(speak('Detected. Affirmative.', { synth })).toBe(true);
    expect(synth.spoken).toHaveLength(1);
    expect(synth.cancelled).toBe(1); // queue replaced, not stacked
    const u = synth.spoken[0] as { text: string; rate: number };
    expect(u.text).toBe('Detected. Affirmative.');
    expect(u.rate).toBeCloseTo(1.02);
  });

  it('stays silent on empty payloads and missing engines — never throws', () => {
    expect(speak('   ', { synth: fakeSynth() })).toBe(false);
    expect(speak('hello', { synth: null })).toBe(false);
    const broken = { speak: () => { throw new Error('engine exploded'); }, cancel: () => {}, getVoices: () => [] };
    expect(speak('hello', { synth: broken as unknown as SpeechSynthLike })).toBe(false);
  });

  it('cancelSpeech cancels when available, no-ops when not', () => {
    const synth = fakeSynth();
    cancelSpeech(synth);
    expect(synth.cancelled).toBe(1);
    expect(() => cancelSpeech(null)).not.toThrow();
  });

  it('the speak toggle contract: globalThis.speechSynthesis is used when present', () => {
    const synth = fakeSynth();
    const original = (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = synth;
    try {
      expect(speak('Fairy online')).toBe(true);
      expect(synth.spoken).toHaveLength(1);
    } finally {
      (globalThis as { speechSynthesis?: unknown }).speechSynthesis = original;
    }
  });
});
