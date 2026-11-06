import { describe, it, expect } from 'vitest';
import { BrokerClient, BrokerClientError, type BrokerDial } from '../../src/native/broker-client.js';
import { randomUUID } from 'node:crypto';

/**
 * In-memory broker double speaking the same JSON-line protocol as the C# host.
 * Holds state like the real thing: approvals are one-use.
 */
class MemoryBroker {
  private approvals = new Map<string, { used: boolean; capabilityId: string }>();

  handle(line: string): string {
    const req = JSON.parse(line) as { id: string; op: string; payload?: unknown };
    let resp: { id: string; ok: boolean; result?: unknown; error?: string };
    try {
      const p = (req.payload ?? {}) as Record<string, unknown>;
      switch (req.op) {
        case 'ping':
          resp = { id: req.id, ok: true, result: { pong: true, version: '1' } };
          break;
        case 'sandbox.resolve':
          resp = {
            id: req.id,
            ok: true,
            result: {
              resolved: typeof p.requested === 'string' && !p.requested.includes('..') ? `/jail/${p.requested}` : null,
            },
          };
          break;
        case 'egress.check': {
          const allowed = p.destination === 'api.example.com' && !Array.isArray(p.parents);
          resp = { id: req.id, ok: true, result: { allowed } };
          break;
        }
        case 'policy.issue': {
          const nonce = randomUUID();
          this.approvals.set(nonce, { used: false, capabilityId: String(p.capabilityId) });
          resp = { id: req.id, ok: true, result: { nonce } };
          break;
        }
        case 'policy.consume': {
          const entry = this.approvals.get(String(p.nonce));
          const granted = entry !== undefined && !entry.used && entry.capabilityId === p.capabilityId;
          if (entry) entry.used = true;
          resp = { id: req.id, ok: true, result: { granted } };
          break;
        }
        default:
          resp = { id: req.id, ok: false, error: `unknown op '${req.op}'` };
      }
    } catch (err) {
      resp = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return JSON.stringify(resp) + '\n';
  }
}

interface DoubleHooks {
  onData?: (chunk: Buffer) => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
}

/** Duplex double that pipes writes into the broker and streams responses back. */
class MemoryDuplex implements Partial<typeof MemoryDuplex.prototype> {
  hooks: DoubleHooks = {};

  constructor(
    private readonly broker: MemoryBroker,
    private readonly opts: { closeAfterWrite?: boolean; garbage?: boolean; closeWithoutResponding?: boolean } = {},
  ) {}

  write(chunk: string): boolean {
    if (this.opts.closeWithoutResponding) {
      queueMicrotask(() => this.hooks.onClose?.());
      return true;
    }
    const out = (this.opts.garbage ? 'garbage noise\n' : '') + this.broker.handle(chunk);
    const data = Buffer.from(out);
    queueMicrotask(() => this.hooks.onData?.(data));
    if (this.opts.closeAfterWrite) queueMicrotask(() => this.hooks.onClose?.());
    return true;
  }

  end(): void {}
  destroy(): void {}

  on(event: string, cb: (arg: never) => void): void {
    if (event === 'data') this.hooks.onData = cb as (chunk: Buffer) => void;
    if (event === 'close') this.hooks.onClose = cb as () => void;
    if (event === 'error') this.hooks.onError = cb as (err: Error) => void;
  }

  once(event: string, cb: () => void): void {
    if (event === 'connect') queueMicrotask(cb);
  }
}

function makeDial(
  broker: MemoryBroker,
  opts: { closeAfterWrite?: boolean; garbage?: boolean; closeWithoutResponding?: boolean } = {},
): BrokerDial {
  return () => {
    const duplex = new MemoryDuplex(broker, opts);
    return Promise.resolve(duplex as unknown as import('../../src/native/broker-client.js').DuplexLike);
  };
}

describe('BrokerClient (in-memory protocol double)', () => {
  it('ping roundtrips', async () => {
    const client = new BrokerClient({ dial: makeDial(new MemoryBroker()) });
    const pong = await client.ping();
    expect(pong).toEqual({ pong: true, version: '1' });
  });

  it('sandboxResolve returns jailed path or null', async () => {
    const client = new BrokerClient({ dial: makeDial(new MemoryBroker()) });
    expect(await client.sandboxResolve('/jail', 'a/b.txt')).toBe('/jail/a/b.txt');
    expect(await client.sandboxResolve('/jail', '../escape.txt')).toBeNull();
  });

  it('egressCheck enforces destination + parent fail-closed', async () => {
    const client = new BrokerClient({ dial: makeDial(new MemoryBroker()) });
    expect(await client.egressCheck({ id: 'd1', sensitivity: 'public', allowedDestinations: ['api.example.com'], destination: 'api.example.com', isCloud: true })).toBe(true);
    expect(await client.egressCheck({ id: 'd1', sensitivity: 'public', allowedDestinations: ['api.example.com'], destination: 'evil.com', isCloud: true })).toBe(false);
    expect(await client.egressCheck({ id: 'd1', sensitivity: 'public', allowedDestinations: ['api.example.com'], parents: ['ghost'], destination: 'api.example.com', isCloud: true })).toBe(false);
  });

  it('policy issue + consume is one-use', async () => {
    const client = new BrokerClient({ dial: makeDial(new MemoryBroker()) });
    const nonce = await client.policyIssue({
      capabilityId: 'cap.edit', target: 'C:/w/f.txt', effect: 'file-write',
      payloadDigest: 'AB', uiStateHash: 'U1', ttlMs: 60_000,
    });
    expect(nonce).toMatch(/-/);
    const input = { nonce, capabilityId: 'cap.edit', target: 'C:/w/f.txt', effect: 'file-write', payloadDigest: 'AB', uiStateHash: 'U1' };
    expect(await client.policyConsume(input)).toBe(true);
    expect(await client.policyConsume(input)).toBe(false);
  });

  it('tolerates garbage lines before the response', async () => {
    const client = new BrokerClient({ dial: makeDial(new MemoryBroker(), { garbage: true }) });
    const pong = await client.ping();
    expect(pong.pong).toBe(true);
  });

  it('rejects when the broker closes before responding', async () => {
    const client = new BrokerClient({ dial: makeDial(new MemoryBroker(), { closeWithoutResponding: true }), timeoutMs: 500 });
    await expect(client.ping()).rejects.toBeInstanceOf(BrokerClientError);
  });

  it('times out when nothing answers', async () => {
    const silentDial: BrokerDial = () => Promise.resolve({
      write(): boolean { return true; },
      end(): void {},
      destroy(): void {},
      on(): void {},
      once(event: string, cb: () => void): void { if (event === 'connect') queueMicrotask(cb); },
    } as unknown as import('../../src/native/broker-client.js').DuplexLike);
    const client = new BrokerClient({ dial: silentDial, timeoutMs: 80 });
    await expect(client.ping()).rejects.toThrow(/timed out/);
  });

  it('rejects cleanly when the transport cannot connect', async () => {
    const client = new BrokerClient({
      dial: () => Promise.reject(new Error('ENOENT')),
      timeoutMs: 100,
    });
    await expect(client.ping()).rejects.toThrow(/broker unreachable/);
  });
});
