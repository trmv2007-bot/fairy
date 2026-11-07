// Fairy's hands — the device tool layer (main process only).
//
// A Type-III general-purpose intelligence that cannot touch its own machine is
// a chat toy. This module gives Fairy REAL capabilities against the device she
// lives on, each one a named tool the model can call:
//
//   read: system_info, power_status, window_list, fs_search, fs_read_text,
//         net_diagnostics
//   act:  shell_open, command_run (behind Master's explicit toggle)
//
// Privacy model: tool results may reach the cloud provider as tool messages.
// They are therefore 'internal' scope data and only flow to providers whose
// allowedDataScopes include 'internal' (the existing gateway policy). Anything
// that looks like credential material is withheld from the model entirely —
// over-blocking reads is the safe direction; Fairy is protective of Master.
//
// The registry is electron-free with every side effect injected (SystemDeps),
// so the whole layer is unit-testable under plain Node.
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import type { CloudToolSpec } from '../providers/cloud.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type ToolRisk = 'read' | 'act';

export interface ToolSpec {
  name: string;
  /** Short human label for the UI activity chip. */
  label: string;
  description: string;
  /** JSON Schema for the parameters object (OpenAI function format). */
  parameters: Record<string, unknown>;
  risk: ToolRisk;
}

export interface ToolExecContext {
  /** Master's toggle — command_run refuses (with a correction hint) when off. */
  allowCommandExecution: boolean;
}

export interface ToolExecResult {
  ok: boolean;
  /** JSON-encoded payload — returned to the model verbatim as the tool message. */
  json: string;
  /** One-line summary for the activity chip; capped, never contains file contents. */
  summary: string;
  durationMs: number;
}

export interface BatteryStatus {
  hasBattery: boolean;
  isCharging: boolean;
  percent: number;
}

export interface WindowInfo {
  handle: number;
  title: string;
  process: string;
}

export interface SystemDeps {
  versions(): { node: string; electron: string; chrome: string };
  battery(): BatteryStatus | null;
  displays(): { width: number; height: number }[];
  openExternal(url: string): Promise<void>;
  /** Resolves with '' on success or an error description (mirrors shell.openPath). */
  openPath(p: string): Promise<string>;
  /** Windows enumeration through the native broker; null when the broker is offline. */
  brokerWindows(): Promise<WindowInfo[] | null>;
  /** Measures a TCP connect in ms; rejects on failure/timeout. */
  tcpConnect(host: string, port: number, timeoutMs: number): Promise<number>;
  dnsResolve(host: string): Promise<string[]>;
  spawn(
    command: string,
    args: string[],
    opts: { timeoutMs: number; cwd: string; env: NodeJS.ProcessEnv },
  ): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>;
  /** Absolute roots Fairy may read/open within (default: Master's home). */
  roots(): string[];
  now(): number;
}

// ── Safety: credential material is never handed to the model ────────────────

const SENSITIVE_PATH_FRAGMENTS = [
  '/.ssh/', '/.aws/', '/.gnupg/', '/.kube/', '/.docker/',
  '/.config/fairy', '/.config/gnome-keyring', '/.gnome/keyring',
  'keychain', '.kdbx', 'ntuser.dat',
];
const SENSITIVE_FILE_PATTERN =
  /^(id_[\w.-]+|[\w.-]*_rsa[\w.-]*|[\w.-]*\.pem|[\w.-]*\.key|[\w.-]*\.p12|[\w.-]*\.pfx|[\w.-]*\.crt|[\w.-]*\.kdbx|authorized_keys[\w.-]*|known_hosts[\w.-]*|[\w.-]*credentials[\w.-]*|[\w.-]*secret[\w.-]*|[\w.-]*token[\w.-]*|[\w.-]*password[\w.-]*|\.env[\w.-]*)$/i;

/** Defense in depth: true when a path looks like credential/secret material. */
export function isSensitivePath(p: string): boolean {
  const norm = p.replaceAll('\\', '/');
  const lower = norm.toLowerCase();
  for (const frag of SENSITIVE_PATH_FRAGMENTS) {
    if (lower.includes(frag)) return true;
  }
  const base = path.basename(norm);
  if (base.length > 0 && SENSITIVE_FILE_PATTERN.test(base)) return true;
  return false;
}

// ── Safety: command allowlist (spawned WITHOUT a shell, argv array only) ────

const COMMAND_ALLOWLIST: Record<string, { maxArgs: number }> = {
  whoami: { maxArgs: 0 },
  hostname: { maxArgs: 0 },
  ver: { maxArgs: 0 },
  uname: { maxArgs: 2 },
  systeminfo: { maxArgs: 0 },
  tasklist: { maxArgs: 2 },
  ps: { maxArgs: 3 },
  ipconfig: { maxArgs: 1 },
  ifconfig: { maxArgs: 1 },
  ping: { maxArgs: 4 },
  df: { maxArgs: 2 },
  ls: { maxArgs: 2 },
  dir: { maxArgs: 2 },
};
/** Each argument must match this — structurally no shell metacharacters can pass. */
const COMMAND_ARG_PATTERN = /^[\w.:/\\=-]{1,64}$/;

// ── Caps ────────────────────────────────────────────────────────────────────

const MAX_TOOL_JSON_CHARS = 6_000;
const FS_SEARCH_MAX_RESULTS = 25;
const FS_SEARCH_MAX_VISIT = 4_000;
const FS_SEARCH_DEPTH = 6;
const FS_SEARCH_BUDGET_MS = 1_500;
const FS_READ_MAX_BYTES = 32_768;
const NET_CONNECT_TIMEOUT_MS = 3_000;
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_OUTPUT_CAP = 8_192;
const WINDOW_LIST_CAP = 32;

function capString(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `…(+${s.length - max} chars)`;
}

function result(ok: boolean, payload: unknown, summary: string, startedMs: number): ToolExecResult {
  return {
    ok,
    json: capString(JSON.stringify(payload), MAX_TOOL_JSON_CHARS),
    summary: capString(summary, 160),
    durationMs: Math.max(0, Math.round(startedMs >= 0 ? Date.now() - startedMs : 0)),
  };
}

function err(payload: Record<string, unknown>, summary: string, startedMs: number): ToolExecResult {
  return result(false, payload, summary, startedMs);
}

// ── Tool specs (descriptions are written FOR the model, in Fairy's dossier) ─

const SPECS: ToolSpec[] = [
  {
    name: 'system_info',
    label: 'system readout',
    risk: 'read',
    description:
      'Read the real hardware and runtime identity of this device: OS, architecture, ' +
      'hostname, CPU model and core count, memory totals, uptime, current user, and ' +
      'runtime versions. Use this instead of guessing when Master asks about the machine.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'power_status',
    label: 'power readout',
    risk: 'read',
    description:
      'Battery and power state: whether a battery exists, charge percent, and whether ' +
      'it is charging. Report the numbers verbatim; the electricity bill is Master\'s problem.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'window_list',
    label: 'window sweep',
    risk: 'read',
    description:
      'Enumerate currently open top-level windows (title + owning process) through the ' +
      'native broker. Requires the H.D.D. link; returns available:false when it is offline.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'fs_search',
    label: 'file sweep',
    risk: 'read',
    description:
      'Search for files by name substring under Master\'s home directory (case-insensitive). ' +
      'Returns path, size, and modified time for up to 25 matches. Sensitive locations ' +
      '(.ssh, keychains, credential-like files) are excluded by policy.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'substring of the file name to match', minLength: 1, maxLength: 128 },
        subpath: { type: 'string', description: 'optional subdirectory of home to start from, e.g. "Documents"', maxLength: 128 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fs_read_text',
    label: 'file read',
    risk: 'read',
    description:
      'Read a UTF-8 text file (up to 32KB) under Master\'s home directory. Binary files ' +
      'are refused; credential-like paths (.ssh, *.pem, keychains, .env) are withheld by policy.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'absolute path under home', minLength: 1, maxLength: 1024 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'net_diagnostics',
    label: 'net probe',
    risk: 'read',
    description:
      'Network diagnostics: list active (non-internal) interfaces, resolve a hostname via DNS, ' +
      'and measure TCP connect latency to ports 443 and 80. No user data is transmitted — ' +
      'this only opens and closes connections.',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'hostname or IP to probe (default 1.1.1.1)', maxLength: 253 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shell_open',
    label: 'open target',
    risk: 'act',
    description:
      'Open a URL in Master\'s default browser (http/https only) or a file/folder under ' +
      'home in its default application. Journaled. Use when Master says "open …".',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'http(s) URL or absolute path under home', minLength: 1, maxLength: 2048 },
      },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'command_run',
    label: 'command exec',
    risk: 'act',
    description:
      'Run one allowlisted diagnostic command (whoami, hostname, uname, systeminfo, tasklist, ' +
      'ps, ipconfig, ifconfig, ping, df, ls, dir, ver) with plain arguments — no shell. ' +
      'Requires Master to have enabled "Controlled command execution" in the Status tab; ' +
      'otherwise it refuses with instructions.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'the allowlisted command name', minLength: 1, maxLength: 32 },
        args: { type: 'array', items: { type: 'string', maxLength: 64 }, description: 'plain arguments, no shell syntax', maxItems: 4 },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

// ── Registry ────────────────────────────────────────────────────────────────

/** OpenAI function-calling tool declarations for the configured specs. */
export function toolDeclarations(specs: ToolSpec[]): CloudToolSpec[] {
  return specs.map(s => ({
    type: 'function' as const,
    function: { name: s.name, description: s.description, parameters: s.parameters },
  }));
}

export class ToolRegistry {
  private readonly byName = new Map(SPECS.map(s => [s.name, s] as const));

  constructor(private readonly deps: SystemDeps) {}

  specs(): ToolSpec[] {
    return [...SPECS];
  }

  declarations(): CloudToolSpec[] {
    return toolDeclarations(this.specs());
  }

  /** Parse and validate `arguments` JSON for a spec; throws Error with a model-facing message. */
  private parseArgs(name: string, argsJson: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = argsJson.trim().length === 0 ? {} : JSON.parse(argsJson);
    } catch {
      throw new Error(`arguments for '${name}' are not valid JSON`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`arguments for '${name}' must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  }

  private str(a: Record<string, unknown>, key: string, maxLen: number): string {
    const v = a[key];
    if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) {
      throw new Error(`'${key}' must be a non-empty string of at most ${maxLen} chars`);
    }
    if (v.includes('\0')) throw new Error(`'${key}' must not contain NUL bytes`);
    return v;
  }

  /** Resolve a user-supplied path inside an allowed root; throws when it escapes or is sensitive. */
  private resolveInRoots(p: string): string {
    const roots = this.deps.roots();
    for (const root of roots) {
      const resolved = path.resolve(root, p);
      const rel = path.relative(root, resolved);
      const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
      if (inside) {
        if (isSensitivePath(resolved)) {
          throw new Error('path withheld: looks like credential material. Ask Master to provide it directly.');
        }
        return resolved;
      }
    }
    throw new Error(`path must stay inside: ${roots.join(', ')}`);
  }

  async execute(name: string, argsJson: string, ctx: ToolExecContext): Promise<ToolExecResult> {
    const started = Date.now();
    const spec = this.byName.get(name);
    if (!spec) {
      return err(
        { error: `unknown tool '${name}'`, available: this.specs().map(s => s.name) },
        `unknown tool '${name}'`,
        started,
      );
    }
    let args: Record<string, unknown>;
    try {
      args = this.parseArgs(name, argsJson);
    } catch (e) {
      return err({ error: e instanceof Error ? e.message : String(e) }, `${name}: bad arguments`, started);
    }
    try {
      switch (name) {
        case 'system_info': return await this.systemInfo(started);
        case 'power_status': return await this.powerStatus(started);
        case 'window_list': return await this.windowList(started);
        case 'fs_search': return await this.fsSearch(args, started);
        case 'fs_read_text': return await this.fsReadText(args, started);
        case 'net_diagnostics': return await this.netDiagnostics(args, started);
        case 'shell_open': return await this.shellOpen(args, started);
        case 'command_run': return await this.commandRun(args, ctx, started);
        default: throw new Error(`unhandled tool '${name}'`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ error: message }, `${name}: ${capString(message, 120)}`, started);
    }
  }

  // ── Executors ─────────────────────────────────────────────────────────────

  private async systemInfo(started: number): Promise<ToolExecResult> {
    const cpus = os.cpus();
    const info = {
      platform: process.platform,
      os: `${os.type()} ${os.release()}`,
      osVersion: os.version(),
      arch: process.arch,
      hostname: os.hostname(),
      user: os.userInfo().username,
      cpu: {
        model: (cpus[0]?.model ?? 'unknown').trim(),
        cores: cpus.length,
      },
      memory: {
        totalMb: Math.round(os.totalmem() / 1e6),
        freeMb: Math.round(os.freemem() / 1e6),
      },
      uptimeHours: +(os.uptime() / 3600).toFixed(2),
      loadAvg: os.loadavg().map(l => +l.toFixed(2)),
      runtime: this.deps.versions(),
    };
    return result(true, info, `${info.cpu.cores} cores · ${info.memory.totalMb}MB RAM · ${info.platform}`, started);
  }

  private async powerStatus(started: number): Promise<ToolExecResult> {
    const battery = this.deps.battery();
    if (!battery || !battery.hasBattery) {
      return result(
        true,
        { hasBattery: false, power: 'mains', note: 'No battery detected — workstation class. The electricity bill remains Master\'s.' },
        'no battery · mains power',
        started,
      );
    }
    if (!Number.isFinite(battery.percent) || battery.percent < 0) {
      return result(
        true,
        { hasBattery: true, percent: 'unknown', charging: battery.isCharging },
        `battery · level unknown · ${battery.isCharging ? 'charging' : 'discharging'}`,
        started,
      );
    }
    const pct = Math.round(Math.max(0, Math.min(100, battery.percent)));
    return result(
      true,
      { hasBattery: true, percent: pct, charging: battery.isCharging },
      `${pct}% · ${battery.isCharging ? 'charging' : 'discharging'}`,
      started,
    );
  }

  private async windowList(started: number): Promise<ToolExecResult> {
    const windows = await this.deps.brokerWindows();
    if (!windows) {
      return result(
        true,
        { available: false, reason: 'H.D.D. link (native broker) offline — window enumeration requires it.' },
        'H.D.D. link offline',
        started,
      );
    }
    const capped = windows.slice(0, WINDOW_LIST_CAP).map(w => ({ title: capString(w.title, 120), process: w.process }));
    return result(
      true,
      { available: true, count: windows.length, windows: capped },
      `${windows.length} window${windows.length === 1 ? '' : 's'} detected`,
      started,
    );
  }

  private async fsSearch(args: Record<string, unknown>, started: number): Promise<ToolExecResult> {
    const query = this.str(args, 'query', 128).toLowerCase();
    if (query.includes('/') || query.includes('\\')) throw new Error('query must be a file NAME substring, not a path');
    const roots = this.deps.roots();
    const root = roots[0];
    if (!root) throw new Error('no allowed roots configured');
    let base = root;
    if (typeof args.subpath === 'string' && args.subpath.length > 0) {
      if (args.subpath.includes('\0')) throw new Error('subpath must not contain NUL bytes');
      base = this.resolveInRoots(args.subpath);
    }
    const matches: { name: string; path: string; sizeBytes: number; modified: string }[] = [];
    let visited = 0;
    let truncated = false;
    const deadline = this.deps.now() + FS_SEARCH_BUDGET_MS;
    // Explicit stack BFS — bounded by depth, visited count and wall clock.
    const queue: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }];
    while (queue.length > 0) {
      if (visited >= FS_SEARCH_MAX_VISIT || Date.now() > deadline) { truncated = true; break; }
      const { dir, depth } = queue.shift()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable dir — skip silently
      }
      for (const e of entries) {
        if (visited >= FS_SEARCH_MAX_VISIT) { truncated = true; break; }
        visited++;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // dot-dirs and known-huge trees are not Fairy's business to crawl
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          if (depth + 1 <= FS_SEARCH_DEPTH) queue.push({ dir: full, depth: depth + 1 });
          continue;
        }
        if (!e.name.toLowerCase().includes(query)) continue;
        if (isSensitivePath(full)) continue;
        try {
          const st = await fsp.stat(full);
          if (matches.length < FS_SEARCH_MAX_RESULTS) {
            matches.push({ name: e.name, path: full, sizeBytes: st.size, modified: st.mtime.toISOString() });
          } else {
            truncated = true;
          }
        } catch { /* raced away — skip */ }
      }
    }
    return result(
      true,
      { query, root: base, matches, truncated, note: truncated ? 'results partial — narrow the query or subpath' : 'complete' },
      `${matches.length} match${matches.length === 1 ? '' : 'es'} for “${query}”${truncated ? ' (partial)' : ''}`,
      started,
    );
  }

  private async fsReadText(args: Record<string, unknown>, started: number): Promise<ToolExecResult> {
    const raw = this.str(args, 'path', 1024);
    const resolved = this.resolveInRoots(raw);
    const st = await fsp.stat(resolved).catch(() => {
      throw new Error(`file not found: ${resolved}`);
    });
    if (!st.isFile()) throw new Error(`not a regular file: ${resolved}`);
    if (st.size > FS_READ_MAX_BYTES) {
      throw new Error(`file is ${st.size} bytes; cap is ${FS_READ_MAX_BYTES} — read a smaller file or use fs_search`);
    }
    const buf = await fsp.readFile(resolved);
    if (buf.length > FS_READ_MAX_BYTES) throw new Error('file exceeds read cap');
    const probe = buf.subarray(0, 1024);
    if (probe.includes(0)) throw new Error('refused: file looks binary (NUL bytes in header)');
    const text = buf.toString('utf8');
    return result(
      true,
      { path: resolved, bytes: buf.length, content: text },
      `${buf.length}B from ${path.basename(resolved)}`,
      started,
    );
  }

  private async netDiagnostics(args: Record<string, unknown>, started: number): Promise<ToolExecResult> {
    let host = '1.1.1.1';
    if (typeof args.host === 'string' && args.host.length > 0) {
      host = this.str(args, 'host', 253);
      if (!/^[a-z0-9._:-]{1,253}$/i.test(host)) throw new Error('host must be a hostname or IP');
    }
    const ifaces = os.networkInterfaces();
    const active = Object.entries(ifaces)
      .filter(([, addrs]) => (addrs ?? []).some(a => !a.internal))
      .map(([name]) => name);
    const dns = await this.deps.dnsResolve(host)
      .then(addrs => ({ ok: true, addresses: addrs.slice(0, 4) }))
      .catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    const probePort = async (port: number): Promise<Record<string, unknown>> => {
      try {
        const ms = await this.deps.tcpConnect(host, port, NET_CONNECT_TIMEOUT_MS);
        return { port, reachable: true, latencyMs: Math.round(ms) };
      } catch (e) {
        return { port, reachable: false, error: capString(e instanceof Error ? e.message : String(e), 120) };
      }
    };
    const tcp443 = await probePort(443);
    const tcp80 = await probePort(80);
    const payload: Record<string, unknown> = {
      host,
      interfaces: { count: active.length, names: active.slice(0, 8) },
      dns,
      tcp: [tcp443, tcp80],
    };
    const reach = [tcp443, tcp80].filter(t => t.reachable === true).length;
    return result(true, payload, `${active.length} iface(s) · dns ${dns.ok ? 'ok' : 'fail'} · ${reach}/2 ports reachable`, started);
  }

  private async shellOpen(args: Record<string, unknown>, started: number): Promise<ToolExecResult> {
    const target = this.str(args, 'target', 2048);
    if (/:\/\//.test(target)) {
      // anything with a URI scheme must be http(s) — file:, javascript:, ftp: are refused
      let u: URL;
      try {
        u = new URL(target);
      } catch {
        throw new Error('target is not a valid URL');
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`protocol '${u.protocol.replace(':', '')}' not allowed — http/https only`);
      await this.deps.openExternal(u.toString());
      return result(true, { opened: 'url', target: u.toString() }, `opened ${u.host}`, started);
    }
    const resolved = this.resolveInRoots(target);
    const openError = await this.deps.openPath(resolved);
    if (openError !== '') throw new Error(`openPath failed: ${openError}`);
    return result(true, { opened: 'path', target: resolved }, `opened ${path.basename(resolved) || resolved}`, started);
  }

  private async commandRun(
    args: Record<string, unknown>,
    ctx: ToolExecContext,
    started: number,
  ): Promise<ToolExecResult> {
    if (!ctx.allowCommandExecution) {
      return err(
        {
          error: 'command execution is disabled',
          hint: 'Master must enable “Controlled command execution” in the Status tab. Tell Master exactly that.',
        },
        'command exec disabled — needs Master\'s toggle',
        started,
      );
    }
    const command = this.str(args, 'command', 32);
    const entry = COMMAND_ALLOWLIST[command];
    if (!entry) {
      return err(
        { error: `command '${command}' is not allowlisted`, allowlist: Object.keys(COMMAND_ALLOWLIST) },
        `“${command}” not allowlisted`,
        started,
      );
    }
    const rawArgs = args.args;
    const cmdArgs = rawArgs === undefined ? [] : rawArgs;
    if (!Array.isArray(cmdArgs)) throw new Error('args must be an array of strings');
    if (cmdArgs.length > entry.maxArgs) {
      throw new Error(`'${command}' accepts at most ${entry.maxArgs} argument(s)`);
    }
    for (const a of cmdArgs) {
      if (typeof a !== 'string' || !COMMAND_ARG_PATTERN.test(a)) {
        throw new Error(`argument '${String(a)}' rejected — plain flags/values only, no shell syntax`);
      }
    }
    const roots = this.deps.roots();
    const env: NodeJS.ProcessEnv = {};
    for (const k of ['PATH', 'Path', 'HOME', 'LANG', 'TERM', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'TEMP', 'TMP']) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
    const r = await this.deps.spawn(command, cmdArgs.map(String), {
      timeoutMs: COMMAND_TIMEOUT_MS,
      cwd: roots[0] ?? process.cwd(),
      env,
    });
    const payload = {
      command: `${command} ${cmdArgs.join(' ')}`.trim(),
      exitCode: r.code,
      timedOut: r.timedOut,
      stdout: capString(r.stdout, COMMAND_OUTPUT_CAP),
      stderr: capString(r.stderr, 1024),
    };
    return result(
      !r.timedOut && r.code === 0,
      payload,
      `exit ${r.code}${r.timedOut ? ' (timed out)' : ''} · ${capString(command, 40)}`,
      started,
    );
  }
}

// ── HUD snapshot (real device readout for the Status tab) ───────────────────

export interface SystemSnapshot {
  platform: string;
  os: string;
  arch: string;
  hostname: string;
  user: string;
  cpuModel: string;
  cores: number;
  memoryTotalMb: number;
  memoryFreeMb: number;
  uptimeHours: number;
  battery: BatteryStatus | null;
  displays: { width: number; height: number }[];
  networkInterfaces: number;
  runtime: { node: string; electron: string; chrome: string };
  generatedAt: string;
}

export function buildSystemSnapshot(deps: SystemDeps): SystemSnapshot {
  const cpus = os.cpus();
  const ifaces = os.networkInterfaces();
  const activeIfaces = Object.entries(ifaces).filter(([, addrs]) => (addrs ?? []).some(a => !a.internal)).length;
  return {
    platform: process.platform,
    os: `${os.type()} ${os.release()}`,
    arch: process.arch,
    hostname: os.hostname(),
    user: os.userInfo().username,
    cpuModel: (cpus[0]?.model ?? 'unknown').trim(),
    cores: cpus.length,
    memoryTotalMb: Math.round(os.totalmem() / 1e6),
    memoryFreeMb: Math.round(os.freemem() / 1e6),
    uptimeHours: +(os.uptime() / 3600).toFixed(1),
    battery: deps.battery(),
    displays: deps.displays(),
    networkInterfaces: activeIfaces,
    runtime: deps.versions(),
    generatedAt: new Date().toISOString(),
  };
}
