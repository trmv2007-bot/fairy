// App settings persistence (T08/T30). JSON file in user data dir; secrets stored as broker handles only.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FairyConfig } from '../providers/config.js';
import { loadConfig } from '../providers/config.js';

export class SettingsStore {
  constructor(private path: string) {}

  load(): FairyConfig {
    if (!existsSync(this.path)) return { cloudProviders: [], allowLocalModels: false };
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      return loadConfig(raw);
    } catch {
      return { cloudProviders: [], allowLocalModels: false };
    }
  }

  save(cfg: FairyConfig): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(this.path), 0o700); } catch { /* best effort on Windows */ }
    // Never persist raw secrets — only broker handles (already in config)
    writeFileSync(this.path, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(this.path, 0o600); } catch { /* best effort on Windows */ }
  }

  exists(): boolean { return existsSync(this.path); }
}
