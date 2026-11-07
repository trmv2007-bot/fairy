// fairy-doctor (v0.6): provider diagnostics. Answers the one question the
// sandbox could never settle — "is my key actually good?" — from the machine
// Fairy runs on.
//
// The probe is a GET {baseUrl}/models with the vaulted key: free (no tokens),
// supported by every OpenAI-compatible endpoint Fairy routes to (Groq, OpenAI,
// OpenRouter, Ollama), and a precise key-health signal:
//   200 → key accepted · 401/403 → auth rejected · 429 → key valid, rate-limited.
//
// Electron-free by design: everything is injected, so this module runs in
// plain vitest without mocking Electron. main.ts wires the real deps.
export type DoctorVerdict =
  | 'ok'
  | 'auth-rejected'
  | 'rate-limited'
  | 'http-error'
  | 'network-error'
  | 'no-key'
  | 'bad-config';

export interface DoctorProviderCore {
  endpointId: string;
  baseUrl: string;
  model?: string;
  /** Local keyless endpoint (Ollama) — probed WITHOUT an auth header. */
  keyless?: boolean;
}

export interface DoctorProviderInput extends DoctorProviderCore {
  /** Vault handle for this provider; '' when keyless. */
  authHandle: string;
}

export interface DoctorProviderReport extends DoctorProviderCore {
  keyPresent: boolean;
  verdict: DoctorVerdict;
  httpStatus?: number;
  latencyMs?: number;
  /** Human-readable one-liner; verdict carries the semantics. */
  detail: string;
}

export interface DoctorReport {
  configOk: boolean;
  encryptionAvailable: boolean;
  persistedKeys: number;
  pool: string[];
  journalAvailable: boolean;
  providers: DoctorProviderReport[];
  /** true when every provider with a key probed ok/rate-limited and none are misconfigured. */
  overallOk: boolean;
}

export interface DoctorProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** Classify one HTTP status from a /models probe. */
export function classifyStatus(status: number): DoctorVerdict {
  if (status === 200) return 'ok';
  if (status === 401 || status === 403) return 'auth-rejected';
  if (status === 429) return 'rate-limited';
  return 'http-error';
}

/**
 * Probe one provider. Never throws — every failure becomes a verdict.
 * With no key the endpoint is not contacted at all (a keyless probe would
 * leak the provider's auth posture, not the key's).
 */
export async function probeProvider(
  p: DoctorProviderCore,
  key: string | undefined,
  opts: DoctorProbeOptions = {},
): Promise<DoctorProviderReport> {
  const base: DoctorProviderReport = {
    ...p,
    keyPresent: p.keyless === true || (typeof key === 'string' && key.length > 0),
    verdict: 'bad-config',
    detail: '',
  };
  const baseUrl = p.baseUrl.trim();
  if (!/^https?:\/\/.{1,2000}$/i.test(baseUrl)) {
    return { ...base, verdict: 'bad-config', detail: 'base URL is not a valid http(s) URL' };
  }
  if (!base.keyPresent) {
    return { ...base, verdict: 'no-key', detail: 'no key vaulted this session — register or seed one' };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = baseUrl.replace(/\/+$/, '') + '/models';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      // Keyless local endpoints get no auth header — sending one would probe
      // the wrong thing (and leak a credential-shaped string to a local server).
      headers: p.keyless === true ? {} : { authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const verdict = classifyStatus(res.status);
    const detail =
      verdict === 'ok'
        ? `key accepted — /models 200 (${res.status})`
        : verdict === 'auth-rejected'
          ? `key rejected by provider — HTTP ${res.status} (check the key, its scopes, or org policy)`
          : verdict === 'rate-limited'
            ? `key is VALID — HTTP 429 rate limit hit (cooldown then retry)`
            : `unexpected HTTP ${res.status} from /models — verify the base URL`;
    return { ...base, verdict, httpStatus: res.status, latencyMs, detail };
  } catch (err) {
    const latencyMs = Date.now() - started;
    // NB: fetch abort surfaces as DOMException, which is NOT an Error instance
    // in Node — read the name structurally or real timeouts get misclassified.
    const name = (err as { name?: string } | null)?.name;
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return {
      ...base,
      verdict: 'network-error',
      latencyMs,
      detail: timedOut
        ? `no answer within ${timeoutMs}ms — endpoint unreachable from this machine (firewall/egress/DNS)`
        : `connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface DoctorEnv {
  /** Sanitized providers from the settings store (with their vault handles). */
  providers: DoctorProviderInput[];
  /** Resolves a provider's vaulted key (undefined = none this session). */
  resolveKey(authHandle: string): string | undefined;
  encryptionAvailable: boolean;
  persistedKeys: number;
  journalAvailable: boolean;
  pool: string[];
  probeOpts?: DoctorProbeOptions;
}

export async function runDoctor(env: DoctorEnv): Promise<DoctorReport> {
  const providers: DoctorProviderReport[] = [];
  for (const p of env.providers) {
    providers.push(
      await probeProvider(
        {
          endpointId: p.endpointId,
          baseUrl: p.baseUrl,
          ...(p.model !== undefined ? { model: p.model } : {}),
          ...(p.keyless === true ? { keyless: true } : {}),
        },
        env.resolveKey(p.authHandle),
        env.probeOpts,
      ),
    );  }
  const probed = providers.filter(r => r.verdict !== 'no-key' && r.verdict !== 'bad-config');
  const live = providers.filter(r => r.verdict === 'ok' || r.verdict === 'rate-limited');
  const configBroken = providers.some(r => r.verdict === 'bad-config');
  // "Fairy can chat right now": at least one live route, every KEYED route
  // live, nothing misconfigured. A keyless member is informational — the pool
  // fails over around it — but a dead keyed route is not.
  const overallOk = providers.length > 0 && !configBroken && live.length > 0 && live.length === probed.length;
  return {
    configOk: !configBroken,
    encryptionAvailable: env.encryptionAvailable,
    persistedKeys: env.persistedKeys,
    pool: [...env.pool],
    journalAvailable: env.journalAvailable,
    providers,
    overallOk,
  };
}

const VERDICT_MARK: Record<DoctorVerdict, string> = {
  ok: 'OK',
  'rate-limited': 'OK*',
  'auth-rejected': 'REJECTED',
  'http-error': 'HTTP-ERR',
  'network-error': 'UNREACHABLE',
  'no-key': 'NO-KEY',
  'bad-config': 'BAD-CONFIG',
};

/** Canon-flavored readout, printed by the `--doctor` entry point. */
export function formatReport(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push('FAIRY DOCTOR — system probe');
  lines.push('────────────────────────────────────────');
  lines.push(`config ............ ${r.configOk ? 'OK' : 'BROKEN'} (${r.providers.length} provider${r.providers.length === 1 ? '' : 's'}, pool: ${r.pool.length})`);
  lines.push(`key storage ....... ${r.encryptionAvailable ? 'OS-encrypted' : 'session-only (no OS keyring)'} · ${r.persistedKeys} persisted`);
  lines.push(`journal ........... ${r.journalAvailable ? 'online (fairy.db)' : 'offline (chat still works)'}`);
  for (const p of r.providers) {
    lines.push('');
    lines.push(`  ${p.endpointId}`);
    lines.push(`    endpoint .... ${p.baseUrl}${p.model ? ` · ${p.model}` : ''}`);
    lines.push(`    key ......... ${p.keyless === true ? 'none (local endpoint)' : p.keyPresent ? 'vaulted' : 'missing'}`);
    const latency = p.latencyMs !== undefined ? ` in ${p.latencyMs}ms` : '';
    lines.push(`    probe ....... ${VERDICT_MARK[p.verdict]}${p.httpStatus !== undefined ? ` (HTTP ${p.httpStatus})` : ''}${latency} — ${p.detail}`);
  }
  lines.push('');
  if (r.overallOk) {
    lines.push('verdict: ALL SYSTEMS NOMINAL — routes are live, Master.');
  } else if (r.providers.length === 0) {
    lines.push('verdict: NO PROVIDERS — add one in the Providers panel or seed via .env.');
  } else {
    lines.push('verdict: ATTENTION REQUIRED — see the marked routes above.');
  }
  return lines.join('\n');
}
