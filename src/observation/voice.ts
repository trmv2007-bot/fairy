// Continuous voice session (T15). User-started, persistent indicator, barge-in, no raw audio persisted.
export interface VoiceSession {
  active: boolean;
  muted: boolean;
  start(): void;
  end(): void;
  mute(): void;
  unmute(): void;
  onTranscript(cb: (text: string) => void): void;
  onBargeIn(cb: () => void): void;
}

export class VoiceSessionImpl implements VoiceSession {
  active = false;
  muted = false;
  private transcriptCb: ((t: string) => void) | null = null;
  private bargeInCb: (() => void) | null = null;

  start(): void { this.active = true; this.muted = false; }
  end(): void { this.active = false; this.muted = false; }
  mute(): void { this.muted = true; }
  unmute(): void { this.muted = false; }
  onTranscript(cb: (text: string) => void): void { this.transcriptCb = cb; }
  onBargeIn(cb: () => void): void { this.bargeInCb = cb; }

  // feed transcript from speech recognizer
  feedTranscript(text: string): void {
    if (!this.active || this.muted) return;
    this.transcriptCb?.(text);
  }
  // detect user speaking over Fairy -> barge-in
  triggerBargeIn(): void { if (this.active) this.bargeInCb?.(); }
}
