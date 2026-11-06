import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistedKeyStore, type KeyCodec } from '../../src/providers/persisted-key-store.js';

const HANDLE = 'cred_11111111-1111-4111-8111-111111111111';

/** Fake codec: reversible "encryption" (deterministic, test-only). */
function fakeCodec(available = true): KeyCodec & { calls: number } {
  let calls = 0;
  return {
    get available() { return available; },
    get calls() { return calls; },
    encrypt(plain: string): Buffer {
      calls += 1;
      return Buffer.from([...Buffer.from(plain, 'utf8')].reverse());
    },
    decrypt(blob: Buffer): string {
      calls += 1;
      return Buffer.from([...blob].reverse()).toString('utf8');
    },
  };
}

describe('PersistedKeyStore', () => {
  it('roundtrips keys through the codec and the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-keys-'));
    const file = join(dir, 'keys.json');
    const codec = fakeCodec();
    const store = new PersistedKeyStore(file, codec);
    store.setKey(HANDLE, 'sk-test-123');
    store.flush();

    // the file must not contain the raw key
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('sk-test-123');
    expect(JSON.parse(raw).version).toBe(1);

    // a fresh store restores the key
    const store2 = new PersistedKeyStore(file, fakeCodec());
    const restored: Record<string, string> = {};
    const n = store2.loadInto((h, k) => { restored[h] = k; });
    expect(n).toBe(1);
    expect(restored[HANDLE]).toBe('sk-test-123');
  });

  it('refuses to persist when the OS key storage is unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-keys-'));
    const store = new PersistedKeyStore(join(dir, 'keys.json'), fakeCodec(false));
    expect(() => store.setKey(HANDLE, 'sk-x')).toThrow(/persistence unavailable/);
    expect(store.size()).toBe(0);
    expect(existsSync(join(dir, 'keys.json'))).toBe(false);
  });

  it('loadInto returns 0 keys when unavailable (session-only degradation)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-keys-'));
    const file = join(dir, 'keys.json');
    const store = new PersistedKeyStore(file, fakeCodec());
    store.setKey(HANDLE, 'sk-x');
    store.flush();
    const store2 = new PersistedKeyStore(file, fakeCodec(false));
    let called = 0;
    expect(store2.loadInto(() => { called += 1; })).toBe(0);
    expect(called).toBe(0);
  });

  it('drops malformed handles and entries from a hostile file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-keys-'));
    const file = join(dir, 'keys.json');
    writeFileSync(file, JSON.stringify({
      version: 1,
      keys: {
        [HANDLE]: 'AAAA',
        'evil-handle': 'AAAA',
        [HANDLE.slice(0, -1) + 'zz']: 'AAAA',
        [HANDLE + 'x']: 'AAAA',
        notjson: 42,
      },
    }));
    const store = new PersistedKeyStore(file, fakeCodec());
    expect(store.size()).toBe(1);
    expect(store.has(HANDLE)).toBe(true);
  });

  it('starts fresh on a corrupted file instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-keys-'));
    const file = join(dir, 'keys.json');
    writeFileSync(file, '{not json at all');
    const store = new PersistedKeyStore(file, fakeCodec());
    expect(store.size()).toBe(0);
  });

  it('removes keys and persists the removal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fairy-keys-'));
    const file = join(dir, 'keys.json');
    const store = new PersistedKeyStore(file, fakeCodec());
    store.setKey(HANDLE, 'sk-x');
    store.flush();
    store.removeKey(HANDLE);
    store.flush();
    const store2 = new PersistedKeyStore(file, fakeCodec());
    expect(store2.size()).toBe(0);
  });
});
