// Window.fairy type surface (set by preload.cts via contextBridge).
import type { FairyBridge } from '../bridge.js';

declare global {
  interface Window {
    fairy: FairyBridge;
  }
}

export {};
