// Security-focused tests: secrets on disk, journal replay exactness, FTS robustness,
// and the secret vault contract. These encode the app's stated security claims as
// executable gates (see fairyplan.md §11-§12).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../../src/storage/settings.js';
import { SecretVault } from '../../src/providers/secret-vault.js';
import { openInMemoryDatabase } from '../../src/storage/database.js';
import { EventJournalImpl } from '../../src/storage/journal.js';
import { MemoryStoreImpl } from '../../src/storage/memory.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'fairy-sec-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('SEC: no raw secrets on disk', () => {
  it('config persistence keeps only opaque handles; keys stay in the vault', () => {
    const dir = tempDir();
    const file = join(dir, 'fairy-config.json');
    const store = new SettingsStore(file);
    const vault = new SecretVault();
    const handle = 'cred_' + 'test-handle';
    vault.store(handle, 'sk-REALLY-SECRET-123');

    store.save({
      cloudProviders: [{
        endpointId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authHandle: handle,
        includedCost: true,
        allowedDataScopes: ['public'],
      }],
      allowLocalModels: false,
    });

    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('sk-REALLY-SECRET-123');
    expect(raw).toContain('cred_');
    // the vault resolves the handle for main-process use only
    expect(vault.resolve(handle)).toBe('sk-REALLY-SECRET-123');
    expect(vault.size()).toBe(1);
  });

  it('vault removal invalidates the key immediately', () => {
    const v = new SecretVault();
    v.store('cred_a', 'sk-1');
    expect(v.resolve('cred_a')).toBe('sk-1');
    v.remove('cred_a');
    expect(v.resolve('cred_a')).toBeUndefined();
  });

  it('vault rejects empty handles/secrets', () => {
    const v = new SecretVault();
    expect(() => v.store('', 'sk')).toThrow();
    expect(() => v.store('cred_a', '')).toThrow();
  });
});

describe('SEC: journal replay exactness', () => {
  it('no event is lost or duplicated across same-ms bursts', () => {
    const db = openInMemoryDatabase();
    const j = new EventJournalImpl(db);
    const events = [];
    for (let i = 0; i < 30; i++) events.push(j.append({ type: 'burst', payload: { i }, acknowledged: false }));
    let replayed: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const batch = j.since(cursor);
      replayed = replayed.concat(batch.map(e => e.eventId));
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.eventId;
    }
    const expected = events.map(e => e.eventId);
    expect(replayed).toEqual(expected);
  });
});

describe('SEC: memory sensitivity scoping', () => {
  it('default search cannot leak secret-tier rows', () => {
    const m = new MemoryStoreImpl(openInMemoryDatabase());
    m.add({ content: 'swordfish recipe public', source: 'chat', sensitivity: 'public' });
    m.add({ content: 'swordfish api key confidential', source: 'chat', sensitivity: 'secret' });
    const hits = m.search('swordfish');
    expect(hits.length).toBe(1);
    expect(hits[0]!.sensitivity).toBe('public');
  });
});
