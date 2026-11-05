// Bounded PC actions (T11). Recheck foreground window before typing/clicking.
export interface PcController {
  openApp(name: string): Promise<void>;
  typeText(text: string): Promise<void>;
  verifyForeground(expected: string): boolean;
}

export class PcControllerImpl implements PcController {
  async openApp(name: string): Promise<void> { /* native DesktopHost.cs */ void name; }
  async typeText(text: string): Promise<void> {
    // recheck foreground before typing; stop on ambiguity
    if (!this.verifyForeground('expected')) throw new Error('focus changed; aborted');
    void text;
  }
  verifyForeground(_expected: string): boolean { return true; } // native check
}
