import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  ToolRegistry,
  buildSystemSnapshot,
  isSensitivePath,
  toolDeclarations,
  type SystemDeps,
} from '../../src/system/tools.js';

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'fairy-tools-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fakeDeps(over: Partial<SystemDeps> = {}): SystemDeps {
  return {
    versions: () => ({ node: '24.0.0', electron: '45.0.0', chrome: '1.0' }),
    battery: () => null,
    displays: () => [{ width: 1920, height: 1080 }],
    openExternal: async () => {},
    openPath: async () => '',
    brokerWindows: async () => null,
    tcpConnect: async () => 12,
    dnsResolve: async () => ['1.1.1.1'],
    spawn: async () => ({ code: 0, stdout: 'stub-out', stderr: '', timedOut: false }),
    roots: () => [root],
    now: () => Date.now(),
    ...over,
  };
}

const noGate = { allowCommandExecution: false };
const armed = { allowCommandExecution: true };

describe('ToolRegistry specs', () => {
  it('exposes eight tools with JSON-serializable OpenAI declarations', () => {
    const reg = new ToolRegistry(fakeDeps());
    const specs = reg.specs();
    expect(specs.map(s => s.name).sort()).toEqual([
      'command_run', 'fs_read_text', 'fs_search', 'net_diagnostics',
      'power_status', 'shell_open', 'system_info', 'window_list',
    ]);
    const decl = reg.declarations();
    expect(decl.length).toBe(8);
    for (const d of decl) {
      expect(d.type).toBe('function');
      expect(d.function.name.length).toBeGreaterThan(0);
      expect(d.function.description.length).toBeGreaterThan(0);
      // must round-trip through JSON without loss
      expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    }
    expect(toolDeclarations(specs).length).toBe(specs.length);
  });

  it('marks only shell_open and command_run as act-risk', () => {
    const reg = new ToolRegistry(fakeDeps());
    const acts = reg.specs().filter(s => s.risk === 'act').map(s => s.name);
    expect(acts.sort()).toEqual(['command_run', 'shell_open']);
  });
});

describe('isSensitivePath', () => {
  it('withholds credential-like paths in both notations', () => {
    expect(isSensitivePath('/home/z/.ssh/id_rsa')).toBe(true);
    expect(isSensitivePath('C:\\Users\\z\\.ssh\\id_rsa')).toBe(true);
    expect(isSensitivePath('/home/z/.aws/credentials')).toBe(true);
    expect(isSensitivePath('/home/z/secrets/token.txt')).toBe(true);
    expect(isSensitivePath('/home/z/backup.pem')).toBe(true);
    expect(isSensitivePath('/home/z/.env')).toBe(true);
    expect(isSensitivePath('/home/z/.config/fairy/fairy-keys.json')).toBe(true);
  });
  it('passes ordinary files', () => {
    expect(isSensitivePath('/home/z/Documents/notes.txt')).toBe(false);
    expect(isSensitivePath('/home/z/thesis_final_v2.docx')).toBe(false);
  });
});

describe('system_info / power_status / window_list', () => {
  it('system_info reports real measured values from this process', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('system_info', '{}', noGate);
    expect(r.ok).toBe(true);
    const payload = JSON.parse(r.json) as { platform: string; hostname: string; cpu: { cores: number } };
    expect(payload.platform).toBe(process.platform);
    expect(payload.hostname.length).toBeGreaterThan(0);
    expect(payload.cpu.cores).toBeGreaterThan(0);
    expect(r.summary).toContain('cores');
  });

  it('power_status is honest about mains power and about batteries', async () => {
    const mains = new ToolRegistry(fakeDeps());
    const r1 = await mains.execute('power_status', '{}', noGate);
    expect(r1.ok).toBe(true);
    expect(JSON.parse(r1.json)).toMatchObject({ hasBattery: false, power: 'mains' });

    const charged = new ToolRegistry(fakeDeps({ battery: () => ({ hasBattery: true, isCharging: false, percent: 57 }) }));
    const r2 = await charged.execute('power_status', '{}', noGate);
    expect(JSON.parse(r2.json)).toMatchObject({ hasBattery: true, percent: 57, charging: false });
    expect(r2.summary).toContain('57%');
  });

  it('window_list reports the H.D.D. link honestly when the broker is offline', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('window_list', '{}', noGate);
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.json)).toMatchObject({ available: false });
    expect(r.summary).toContain('offline');
  });

  it('window_list enumerates broker windows when the link is up', async () => {
    const reg = new ToolRegistry(fakeDeps({
      brokerWindows: async () => [
        { handle: 1, title: 'Deep Space Nine - S02E14', process: 'vlc' },
        { handle: 2, title: 'work.xlsx - Excel', process: 'excel' },
      ],
    }));
    const r = await reg.execute('window_list', '{}', noGate);
    const payload = JSON.parse(r.json) as { available: boolean; count: number; windows: { title: string }[] };
    expect(payload.available).toBe(true);
    expect(payload.count).toBe(2);
    expect(payload.windows[0]?.title).toContain('Deep Space');
  });
});

describe('fs_search', () => {
  it('finds files case-insensitively under the root', async () => {
    mkdirSync(path.join(root, 'deep', 'nested'), { recursive: true });
    writeFileSync(path.join(root, 'notes.txt'), 'hello');
    writeFileSync(path.join(root, 'deep', 'nested', 'Photo.JPG'), 'img');
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('fs_search', JSON.stringify({ query: 'photo' }), noGate);
    expect(r.ok).toBe(true);
    const payload = JSON.parse(r.json) as { matches: { name: string; path: string }[]; truncated: boolean };
    expect(payload.matches.length).toBe(1);
    expect(payload.matches[0]?.name).toBe('Photo.JPG');
    expect(payload.truncated).toBe(false);
  });

  it('excludes sensitive files from results', async () => {
    writeFileSync(path.join(root, 'notes.txt'), 'hello');
    writeFileSync(path.join(root, 'auth_token.txt'), 'secret');
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('fs_search', JSON.stringify({ query: 'token' }), noGate);
    const payload = JSON.parse(r.json) as { matches: unknown[] };
    expect(payload.matches.length).toBe(0);
  });

  it('rejects path-shaped queries and bad arguments', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const slash = await reg.execute('fs_search', JSON.stringify({ query: 'a/b' }), noGate);
    expect(slash.ok).toBe(false);
    const bad = await reg.execute('fs_search', '{not json', noGate);
    expect(bad.ok).toBe(false);
    expect(JSON.parse(bad.json)).toMatchObject({ error: expect.stringContaining('not valid JSON') });
  });
});

describe('fs_read_text', () => {
  it('reads a text file inside the root and reports its size', async () => {
    writeFileSync(path.join(root, 'report.txt'), 'Detected: all systems nominal.');
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('fs_read_text', JSON.stringify({ path: path.join(root, 'report.txt') }), noGate);
    expect(r.ok).toBe(true);
    const payload = JSON.parse(r.json) as { content: string; bytes: number };
    expect(payload.content).toContain('nominal');
    expect(payload.bytes).toBeGreaterThan(10);
  });

  it('refuses paths that escape the root', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('fs_read_text', JSON.stringify({ path: '/etc/passwd' }), noGate);
    expect(r.ok).toBe(false);
    expect(JSON.parse(r.json)).toMatchObject({ error: expect.stringContaining('inside') });
  });

  it('withholds credential-like files even inside the root', async () => {
    writeFileSync(path.join(root, 'id_rsa'), 'PRIVATE KEY MATERIAL');
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('fs_read_text', JSON.stringify({ path: path.join(root, 'id_rsa') }), noGate);
    expect(r.ok).toBe(false);
    expect(JSON.parse(r.json)).toMatchObject({ error: expect.stringContaining('withheld') });
  });

  it('refuses binary files', async () => {
    writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('fs_read_text', JSON.stringify({ path: path.join(root, 'blob.bin') }), noGate);
    expect(r.ok).toBe(false);
    expect(JSON.parse(r.json)).toMatchObject({ error: expect.stringContaining('binary') });
  });
});

describe('net_diagnostics', () => {
  it('probes DNS and TCP latency without transmitting user data', async () => {
    const reg = new ToolRegistry(fakeDeps({
      dnsResolve: async () => ['104.16.132.229'],
      tcpConnect: async () => 23,
    }));
    const r = await reg.execute('net_diagnostics', JSON.stringify({ host: 'example.com' }), noGate);
    expect(r.ok).toBe(true);
    const payload = JSON.parse(r.json) as {
      host: string;
      dns: { ok: boolean; addresses: string[] };
      tcp: { port: number; reachable: boolean; latencyMs: number }[];
    };
    expect(payload.host).toBe('example.com');
    expect(payload.dns.ok).toBe(true);
    expect(payload.tcp.every(t => t.reachable && t.latencyMs === 23)).toBe(true);
  });

  it('reports unreachable ports honestly', async () => {
    const reg = new ToolRegistry(fakeDeps({
      dnsResolve: async () => { throw new Error('NXDOMAIN'); },
      tcpConnect: async () => { throw new Error('connect ECONNREFUSED'); },
    }));
    const r = await reg.execute('net_diagnostics', '{}', noGate);
    expect(r.ok).toBe(true);
    const payload = JSON.parse(r.json) as { dns: { ok: boolean }; tcp: { reachable: boolean }[] };
    expect(payload.dns.ok).toBe(false);
    expect(payload.tcp.every(t => !t.reachable)).toBe(true);
    expect(r.summary).toContain('0/2');
  });
});

describe('shell_open', () => {
  it('opens http(s) URLs through the injected opener', async () => {
    const opened: string[] = [];
    const reg = new ToolRegistry(fakeDeps({ openExternal: async url => { opened.push(url); } }));
    const r = await reg.execute('shell_open', JSON.stringify({ target: 'https://example.com/page' }), noGate);
    expect(r.ok).toBe(true);
    expect(opened).toEqual(['https://example.com/page']);
    expect(JSON.parse(r.json)).toMatchObject({ opened: 'url' });
  });

  it('opens paths inside the root through openPath', async () => {
    const opened: string[] = [];
    writeFileSync(path.join(root, 'doc.pdf'), 'pdf');
    const reg = new ToolRegistry(fakeDeps({ openPath: async p => { opened.push(p); return ''; } }));
    const r = await reg.execute('shell_open', JSON.stringify({ target: path.join(root, 'doc.pdf') }), noGate);
    expect(r.ok).toBe(true);
    expect(opened.length).toBe(1);
    expect(opened[0]).toContain('doc.pdf');
  });

  it('refuses non-http protocols and paths outside the root', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const scheme = await reg.execute('shell_open', JSON.stringify({ target: 'file:///etc/passwd' }), noGate);
    expect(scheme.ok).toBe(false);
    const escaped = await reg.execute('shell_open', JSON.stringify({ target: '/etc/hosts' }), noGate);
    expect(escaped.ok).toBe(false);
  });
});

describe('command_run', () => {
  it('refuses while Master has not armed it, with instructions', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const r = await reg.execute('command_run', JSON.stringify({ command: 'whoami' }), noGate);
    expect(r.ok).toBe(false);
    const payload = JSON.parse(r.json) as { error: string; hint: string };
    expect(payload.error).toContain('disabled');
    expect(payload.hint).toContain('Status tab');
  });

  it('rejects non-allowlisted commands and shell-syntax arguments', async () => {
    const reg = new ToolRegistry(fakeDeps());
    const evil = await reg.execute('command_run', JSON.stringify({ command: 'curl' }), armed);
    expect(evil.ok).toBe(false);
    expect(JSON.parse(evil.json)).toMatchObject({ error: expect.stringContaining('not allowlisted') });

    const injected = await reg.execute(
      'command_run',
      JSON.stringify({ command: 'ls', args: ['-la; rm -rf /'] }),
      armed,
    );
    expect(injected.ok).toBe(false);
    expect(JSON.parse(injected.json)).toMatchObject({ error: expect.stringContaining('rejected') });
  });

  it('runs a real allowlisted command with a stripped environment', async () => {
    process.env.FAIRY_TEST_SECRET = 'leak-me-not';
    const seen: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const realSpawn: SystemDeps['spawn'] = (command, args, opts) =>
      new Promise(resolve => {
        seen.push({ cmd: command, args, env: opts.env });
        execFile(command, args, { timeout: opts.timeoutMs, cwd: opts.cwd, env: opts.env }, (err, stdout) => {
          resolve({
            code: err ? 1 : 0,
            stdout: String(stdout ?? ''),
            stderr: '',
            timedOut: false,
          });
        });
      });
    try {
      const reg = new ToolRegistry(fakeDeps({ spawn: realSpawn }));
      const r = await reg.execute('command_run', JSON.stringify({ command: 'whoami' }), armed);
      expect(r.ok).toBe(true);
      const payload = JSON.parse(r.json) as { exitCode: number; stdout: string };
      expect(payload.exitCode).toBe(0);
      expect(payload.stdout.trim().length).toBeGreaterThan(0);
      expect(seen[0]?.env['FAIRY_TEST_SECRET']).toBeUndefined(); // env filtered
      expect(seen[0]?.env['PATH']).toBeDefined();
    } finally {
      delete process.env.FAIRY_TEST_SECRET;
    }
  });
});

describe('buildSystemSnapshot', () => {
  it('measures the real device this process runs on', () => {
    const snap = buildSystemSnapshot(fakeDeps({
      battery: () => ({ hasBattery: true, isCharging: true, percent: 88 }),
    }));
    expect(snap.platform).toBe(process.platform);
    expect(snap.cores).toBeGreaterThan(0);
    expect(snap.memoryTotalMb).toBeGreaterThan(0);
    expect(snap.battery).toMatchObject({ percent: 88, isCharging: true });
    expect(snap.displays).toEqual([{ width: 1920, height: 1080 }]);
    expect(snap.runtime.node).toBe('24.0.0');
  });
});
