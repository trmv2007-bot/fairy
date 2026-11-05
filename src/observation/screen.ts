// Opt-in desktop observation (T10). Capture only when enabled; pause stops capture.
export interface ScreenObserver {
  enabled: boolean;
  captureRateFps: number; // max 1
  isPaused: boolean;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  onFrame(cb: (frame: { ts: number; width: number; height: number }) => void): void;
}

export class ScreenObserverImpl implements ScreenObserver {
  enabled = false;
  captureRateFps = 1;
  isPaused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cb: ((f: { ts: number; width: number; height: number }) => void) | null = null;

  start(): void { this.enabled = true; this.isPaused = false; this.arm(); }
  pause(): void { this.isPaused = true; this.disarm(); }
  resume(): void { if (this.enabled) { this.isPaused = false; this.arm(); } }
  stop(): void { this.enabled = false; this.isPaused = false; this.disarm(); }
  onFrame(cb: (frame: { ts: number; width: number; height: number }) => void): void { this.cb = cb; }

  private arm(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.isPaused || !this.enabled) return;
      this.cb?.({ ts: Date.now(), width: 1920, height: 1080 });
    }, Math.max(1000, Math.floor(1000 / this.captureRateFps)));
  }
  private disarm(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
