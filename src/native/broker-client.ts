// Broker client: typed JSON-line protocol to the native Fairy.Broker host
// (named pipe on Windows: \\.\pipe\fairy-broker; .NET on Unix maps the pipe name
// to /tmp/CoreFxPipe_<name>).
//
// The broker is OPTIONAL infrastructure: if it is not running, callers degrade
// gracefully (see desktop/main.ts). Transport is injectable so tests run against
// an in-memory double without sockets.
import { connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import type { Socket } from 'node:net';

export interface BrokerRequest {
  id: string;
  op: string;
  payload?: unknown;
}

export interface BrokerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Minimal duplex surface used for the transport; satisfied by net.Socket and test doubles. */
export interface DuplexLike {
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  once(event: 'connect', cb: () => void): void;
}

export type BrokerDial = () => Promise<DuplexLike>;

export class BrokerClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerClientError';
  }
}

export interface BrokerClientOptions {
  pipeName?: string;
  timeoutMs?: number;
  dial?: BrokerDial;
}

export function defaultDial(pipeName: string): BrokerDial {
  return () =>
    new Promise((resolve, reject) => {
      const path =
        process.platform === 'win32'
          ? `\\\\.\\pipe\\${pipeName}`
          : `${tmpdir()}/CoreFxPipe_${pipeName}`; // matches .NET Unix named-pipe mapping
      const socket = netConnect({ path });
      const onError = (err: Error): void => {
        socket.destroy();
        reject(err);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        resolve(socket as unknown as DuplexLike);
      });
    });
}

export class BrokerClient {
  private readonly pipeName: string;
  private readonly timeoutMs: number;
  private readonly dial: BrokerDial;
  private requestSeq = 0;

  constructor(opts: BrokerClientOptions = {}) {
    this.pipeName = opts.pipeName ?? 'fairy-broker';
    this.timeoutMs = opts.timeoutMs ?? 3_000;
    this.dial = opts.dial ?? defaultDial(this.pipeName);
  }

  /** One request per connection: the broker serves clients serially and this
   *  keeps the protocol stateless from our side. */
  private async request(op: string, payload?: unknown): Promise<unknown> {
    const socket = await this.dial().catch(err => {
      throw new BrokerClientError(`broker unreachable: ${err instanceof Error ? err.message : String(err)}`);
    });
    const id = `r${++this.requestSeq}_${Date.now().toString(36)}`;
    const line = JSON.stringify({ id, op, ...(payload !== undefined ? { payload } : {}) }) + '\n';

    return new Promise((resolve, reject) => {
      const decoder = new TextDecoder();
      let buffer = '';
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new BrokerClientError(`broker request '${op}' timed out after ${this.timeoutMs}ms`)));
      }, this.timeoutMs);

      socket.on('data', (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const respLine = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          let resp: BrokerResponse;
          try {
            resp = JSON.parse(respLine) as BrokerResponse;
          } catch {
            continue; // tolerate keep-alive noise
          }
          if (resp.id !== id) continue;
          if (resp.ok) finish(() => resolve(resp.result));
          else finish(() => reject(new BrokerClientError(resp.error ?? 'broker request failed')));
          return;
        }
      });
      socket.on('error', (err: Error) => {
        finish(() => reject(new BrokerClientError(`broker connection error: ${err.message}`)));
      });
      socket.on('close', () => {
        finish(() => reject(new BrokerClientError('broker closed the connection before responding')));
      });

      socket.write(line);
    });
  }

  async ping(): Promise<{ pong: boolean; version: string }> {
    const r = (await this.request('ping')) as { pong?: unknown; version?: unknown };
    if (r?.pong !== true || typeof r.version !== 'string') {
      throw new BrokerClientError('broker ping returned malformed response');
    }
    return { pong: true, version: r.version };
  }

  async sandboxResolve(root: string, requested: string): Promise<string | null> {
    const r = (await this.request('sandbox.resolve', { root, requested })) as { resolved?: unknown };
    return typeof r?.resolved === 'string' ? r.resolved : null;
  }

  async egressCheck(data: {
    id: string;
    sensitivity: string;
    allowedDestinations: string[];
    parents?: string[];
    destination: string;
    isCloud: boolean;
  }): Promise<boolean> {
    const r = (await this.request('egress.check', data)) as { allowed?: unknown };
    return r?.allowed === true;
  }

  async policyIssue(input: {
    capabilityId: string;
    target: string;
    effect: string;
    payloadDigest: string;
    uiStateHash: string;
    ttlMs: number;
  }): Promise<string> {
    const r = (await this.request('policy.issue', input)) as { nonce?: unknown };
    if (typeof r?.nonce !== 'string') throw new BrokerClientError('policy.issue returned no nonce');
    return r.nonce;
  }

  async policyConsume(input: {
    nonce: string;
    capabilityId: string;
    target: string;
    effect: string;
    payloadDigest: string;
    uiStateHash: string;
  }): Promise<boolean> {
    const r = (await this.request('policy.consume', input)) as { granted?: unknown };
    return r?.granted === true;
  }

  /** Enumerate visible top-level windows (broker-side EnumWindows). Throws when the broker is offline. */
  async windowList(): Promise<{ handle: number; title: string; process: string }[]> {
    const r = (await this.request('window.list')) as { windows?: unknown };
    if (!Array.isArray(r?.windows)) {
      throw new BrokerClientError('window.list returned malformed response');
    }
    const out: { handle: number; title: string; process: string }[] = [];
    for (const w of r.windows) {
      if (typeof w !== 'object' || w === null) continue;
      const rec = w as { handle?: unknown; title?: unknown; process?: unknown };
      if (typeof rec.title !== 'string' || typeof rec.process !== 'string') continue;
      out.push({ handle: typeof rec.handle === 'number' ? rec.handle : 0, title: rec.title, process: rec.process });
    }
    return out;
  }
}

// Re-export so embedders can reference the socket type without importing node:net.
export type { Socket };
