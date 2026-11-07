// Fairy's voice (v0.6): speak replies through the OS speech engine available
// in the renderer (Chromium speechSynthesis — SAPI voices on Windows, say on
// macOS, speech-dispatcher on Linux). Zero dependencies, zero network, fully
// optional: OFF by default, and every entry point is a no-op when the engine
// is missing (CI, jsdom) or the queue gets messy.
//
// Electron-free and DOM-free by injection, so this module unit-tests anywhere.

export interface SpeechVoiceLike {
  name: string;
  lang: string;
}

export interface SpeechSynthLike {
  speak(u: unknown): void;
  cancel(): void;
  getVoices(): SpeechVoiceLike[];
}

/** True when a usable engine exists. */
export function speechAvailable(synth?: SpeechSynthLike | null): boolean {
  const s = synth ?? globalThis.speechSynthesis;
  return typeof s === 'object' && s !== null && typeof s.speak === 'function' && typeof s.cancel === 'function';
}

/**
 * Canon-flavored voice pick: an English voice, preferring the calm
 * machine-female register (Zira/Aria/Jenny on Windows, Samantha on macOS),
 * deterministic — the same machine always picks the same voice.
 */
export function pickVoice(voices: SpeechVoiceLike[]): SpeechVoiceLike | null {
  if (voices.length === 0) return null;
  const en = voices.filter(v => /^en([-_]|$)/i.test(v.lang) || /english/i.test(v.name));
  const pool = en.length > 0 ? en : voices;
  const preferred = pool.find(v => /zira|aria|jenny|samantha|serena|female/i.test(v.name));
  return preferred ?? pool[0]!;
}

/** Strip what must never be spoken: code blocks, urls, markup, tool JSON noise. */
export function forSpeech(text: string): string {
  let out = text;
  out = out.replace(/```[\s\S]*?```/g, ' …code omitted… ');
  out = out.replace(/`([^`]*)`/g, '$1');
  out = out.replace(/https?:\/\/\S+/g, ' link ');
  out = out.replace(/[*_#>~|]/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  // Cap for the engine: cut at the last sentence end inside the budget.
  const MAX_SPOKEN = 700;
  if (out.length > MAX_SPOKEN) {
    const slice = out.slice(0, MAX_SPOKEN);
    const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('。'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    out = stop > 80 ? slice.slice(0, stop + 1) : slice.trim() + '…';
  }
  return out;
}

export interface SpeakOptions {
  /** Injected engine; defaults to the global speechSynthesis. */
  synth?: SpeechSynthLike | null;
  /** Pre-picked voice (skips pickVoice). */
  voice?: SpeechVoiceLike | null;
  rate?: number;
}

/**
 * Speak one reply. Returns false (and stays silent) when the engine is
 * missing or the payload is empty — never throws.
 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  const synth = opts.synth ?? (globalThis.speechSynthesis as SpeechSynthLike | undefined);
  if (!speechAvailable(synth)) return false;
  const payload = forSpeech(text);
  if (payload.length === 0) return false;
  try {
    synth!.cancel(); // one voice, one reply: a new answer replaces a stale one
    const utterance = {
      text: payload,
      rate: opts.rate ?? 1.02,
      ...(opts.voice !== undefined && opts.voice !== null ? { voice: opts.voice } : {}),
    };
    synth!.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/** Silence immediately (clear / switching transcripts / toggling off). */
export function cancelSpeech(synth?: SpeechSynthLike | null): void {
  const s = synth ?? (globalThis.speechSynthesis as SpeechSynthLike | undefined);
  if (!speechAvailable(s)) return;
  try { s!.cancel(); } catch { /* already silent */ }
}
