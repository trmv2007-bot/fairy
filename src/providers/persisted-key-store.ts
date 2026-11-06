// Persistent key store: API keys survive app restarts, encrypted at rest.
//
// Core is framework-free (testable with a fake codec). The production codec in
// desktop/main.ts uses Electron safeStorage — OS-backed protection (DPAPI on
// Windows, Keychain on macOS, kwallet/libsecret on Linux).
//
// Security posture:
// - The file stores ONLY ciphertext (base64). Raw keys never touch disk — same
//   contract as fairy-config.json storing opaque handles.
// - If OS-level encryption is unavailable (Linux without a keyring service),
//   persistence REFUSES rather than falling back to plaintext: session-only
//   keys are the safe degradation, plaintext-on-disk is not an option.
// - The file only contains handles matching the cred_<uuid> namespace; unknown
//   or malformed entries are dropped on load (hostile-file hardening).
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** Abstraction over the OS crypto so tests can run without Electron. */
export interface KeyCodec {
  /** false = OS key storage unavailable; the store refuses to persist keys. */
  readonly available: boolean;
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
}

export const KEY_FILE_FORMAT_VERSION = 1;
const HANDLE_PATTERN = /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface KeyFileShape {
  version?: unknown;
  keys?: unknown;
}

export class PersistedKeyStore {
  private encrypted = new Map<string, string>(); // handle -> base64 ciphertext

  constructor(private filePath: string, private codec: KeyCodec) {
    this.reload();
  }

  reload(): void {
    this.encrypted = new Map();
    if (!existsSync(this.filePath)) return;
    let raw: KeyFileShape;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as KeyFileShape;
    } catch {
      return; // corrupted file: start fresh (session vault still works)
    }
    if (!raw || typeof raw !== 'object' || raw.version !== KEY_FILE_FORMAT_VERSION) return;
    if (!raw.keys || typeof raw.keys !== 'object' || Array.isArray(raw.keys)) return;
    for (const [handle, blob] of Object.entries(raw.keys as Record<string, unknown>)) {
      if (!HANDLE_PATTERN.test(handle)) continue;
      if (typeof blob !== 'string' || blob.length === 0 || blob.length > 16_384) continue;
      this.encrypted.set(handle, blob);
    }
  }

  /**
   * Decrypt every stored handle and hand it to `sink`. Undecryptable entries
   * (e.g. OS storage reset between machines/profiles) are dropped, not fatal.
   * Returns the number of keys successfully restored.
   */
  loadInto(sink: (handle: string, plainKey: string) => void): number {
    if (!this.codec.available) return 0;
    let restored = 0;
    for (const [handle, blob] of this.encrypted) {
      try {
        sink(handle, this.codec.decrypt(Buffer.from(blob, 'base64')));
        restored += 1;
      } catch {
        this.encrypted.delete(handle); // stale ciphertext: drop and rewrite on next flush
      }
    }
    return restored;
  }

  has(handle: string): boolean {
    return this.encrypted.has(handle);
  }

  setKey(handle: string, plainKey: string): void {
    if (!this.codec.available) {
      throw new Error('key persistence unavailable: OS key storage missing (keys stay session-only)');
    }
    if (!HANDLE_PATTERN.test(handle)) throw new Error('key persistence: invalid handle namespace');
    if (plainKey.length === 0) throw new Error('key persistence: key must be non-empty');
    this.encrypted.set(handle, this.codec.encrypt(plainKey).toString('base64'));
  }

  removeKey(handle: string): void {
    this.encrypted.delete(handle);
  }

  size(): number {
    return this.encrypted.size;
  }

  /** Write the ciphertext file. Throws on I/O failure — callers decide policy. */
  flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(this.filePath), 0o700); } catch { /* best effort on Windows */ }
    const payload = {
      version: KEY_FILE_FORMAT_VERSION,
      keys: Object.fromEntries(this.encrypted),
    };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(this.filePath, 0o600); } catch { /* best effort on Windows */ }
  }
}
