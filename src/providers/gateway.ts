// Model gateway (T08): normalizes provider capabilities, routing, privacy/cost checks.
// v0.4 — key pool: when several providers are ticked into the active pool, Fairy
// round-robins across them, fails over between keys on remote failures (before any
// text has streamed), and puts rate-limited or dead keys on a cooldown instead of
// letting one bad key take the conversation down. A pool of one behaves exactly
// like the legacy single-selection route.
import type { ProviderDescriptor } from '../contracts/providers.js';
import { CloudProvider, CloudRouteError, type CloudErrorKind } from './cloud.js';
import type { CloudChatMessage, CloudCompletion, CloudProviderConfig, CloudToolSpec } from './cloud.js';
import type { FairyConfig } from './config.js';
import { effectivePool } from './config.js';

export type SecretResolver = (handle: string) => string | undefined;

/** One failover decision, surfaced live (journal / Status HUD). */
export interface PoolAttemptEvent {
  /** Key that just failed. */
  from: string;
  /** Key tried next, or null when the pool is exhausted. */
  to: string | null;
  /** Short failure family, e.g. 'rate-limited', 'auth rejected'. */
  reason: string;
  /** HTTP status when the provider answered with one. */
  status?: number;
}

export interface PoolCoolingEntry {
  id: string;
  untilMs: number;
  reason: string;
}

export interface PoolStatus {
  /** Ordered effective pool (explicit pool, else legacy selection, else []). */
  activeIds: string[];
  /** Providers registered overall. */
  registered: number;
  /** Key that served the most recent successful request. */
  lastUsedId?: string;
  /** Keys currently on cooldown (reason included). */
  cooling: PoolCoolingEntry[];
  /** Total requests routed through the pool this session. */
  requests: number;
  /** Total failovers performed this session. */
  failovers: number;
}

export interface GatewayHooks {
  /** Fired on every failover decision — the audit trail for the pool. */
  onAttempt?(e: PoolAttemptEvent): void;
  /** Injectable clock (tests pin cooldowns without sleeping). */
  now?(): number;
  /** Injectable fetch (tests script per-key responses without sockets). */
  fetchImpl?: typeof fetch;
}

// ── Failure classification → cooldown ───────────────────────────────────────
// Every CloudRouteError raised inside a provider call is pool-retryable: trying
// the next key can only help (the request is re-issued in full). Only the
// COOLDOWN differs, so a hard-dead key stops wasting turns quickly.

interface Classification {
  reason: string;
  cooldownMs: number;
}

function classifyFailure(err: CloudRouteError): Classification {
  if (err.kind === 'http' && err.status !== undefined) {
    if (err.status === 429) return { reason: 'rate-limited', cooldownMs: 90_000 };
    if (err.status === 401 || err.status === 403) return { reason: 'auth rejected', cooldownMs: 900_000 };
    if (err.status === 408 || err.status >= 500) return { reason: `HTTP ${err.status}`, cooldownMs: 20_000 };
    return { reason: `HTTP ${err.status}`, cooldownMs: 60_000 };
  }
  switch (err.kind) {
    case 'network': return { reason: 'network error', cooldownMs: 20_000 };
    case 'timeout': return { reason: 'timed out', cooldownMs: 20_000 };
    case 'bad-response': return { reason: 'bad response', cooldownMs: 20_000 };
    default: return { reason: 'key missing', cooldownMs: 900_000 };
  }
}

export class ModelGateway {
  private providers = new Map<string, CloudProvider>();
  private readonly selectedProviderId: string | undefined;
  /** Ordered active key pool (validated against registered providers). */
  private pool: string[] = [];
  /** Round-robin cursor — advances once per chat() call so load spreads. */
  private rrIndex = 0;
  private readonly cooldowns = new Map<string, PoolCoolingEntry>();
  private lastUsedId: string | undefined;
  private requests = 0;
  private failovers = 0;

  constructor(
    cfg: FairyConfig,
    private secretResolver: SecretResolver | null = null,
    private readonly hooks: GatewayHooks = {},
  ) {
    this.selectedProviderId = cfg.selectedProviderId;
    for (const c of cfg.cloudProviders) {
      this.providers.set(c.endpointId, new CloudProvider(c, this.hooks.fetchImpl));
    }
    this.pool = this.validPool(effectivePool(cfg));
  }

  /**
   * Swap providers/pool after a settings change while PRESERVING pool health:
   * cooldowns, round-robin position and session counters survive edits.
   */
  reconfigure(cfg: FairyConfig): void {
    this.providers = new Map(cfg.cloudProviders.map(c => [c.endpointId, new CloudProvider(c, this.hooks.fetchImpl)]));
    this.pool = this.validPool(effectivePool(cfg));
    for (const id of [...this.cooldowns.keys()]) {
      if (!this.providers.has(id)) this.cooldowns.delete(id);
    }
    if (this.lastUsedId !== undefined && !this.providers.has(this.lastUsedId)) this.lastUsedId = undefined;
  }

  private validPool(ids: string[]): string[] {
    return [...new Set(ids.filter(id => this.providers.has(id)))];
  }

  list(): string[] {
    return [...this.providers.keys()];
  }

  get(id: string): CloudProvider | undefined {
    return this.providers.get(id);
  }

  configs(): CloudProviderConfig[] {
    return [...this.providers.values()].map(p => p.cfg);
  }

  /** Pool membership + eligibility snapshot (external read-only view). */
  poolStatus(): PoolStatus {
    const now = this.hooks.now?.() ?? Date.now();
    return {
      activeIds: [...this.pool],
      registered: this.providers.size,
      ...(this.lastUsedId !== undefined ? { lastUsedId: this.lastUsedId } : {}),
      cooling: [...this.cooldowns.values()].filter(c => c.untilMs > now),
      requests: this.requests,
      failovers: this.failovers,
    };
  }

  // Route by capability + data eligibility + included cost; never a paid fallback.
  // Vision-capable providers are only selected when vision is actually needed.
  // Pool members are preferred (in pool order); without a pool this falls back
  // to the legacy behavior: selected provider first, then any eligible.
  selectFor(dataScopes: string[], needsVision: boolean): CloudProvider | null {
    const eligible = (cfg: CloudProviderConfig): boolean => {
      if (!cfg.includedCost) return false;
      if (needsVision && cfg.supportsVision !== true) return false;
      return dataScopes.every(s => cfg.allowedDataScopes.includes(s));
    };
    for (const id of this.pool) {
      const p = this.providers.get(id);
      if (p && eligible(p.cfg)) return p;
    }
    if (this.selectedProviderId) {
      const preferred = this.providers.get(this.selectedProviderId);
      if (preferred && eligible(preferred.cfg)) return preferred;
    }
    for (const p of this.providers.values()) {
      if (eligible(p.cfg)) return p;
    }
    return null;
  }

  /**
   * When `selectFor` returns null, explain WHY no route matched, per provider, so
   * the user sees exactly which knob (included-cost tick, scopes, vision) to turn
   * in the Providers tab instead of a bare "no eligible route".
   */
  routeBlockReason(dataScopes: string[], needsVision: boolean): string | null {
    if (this.providers.size === 0) {
      return 'no provider configured — add one in the Providers tab';
    }
    const reasons: string[] = [];
    for (const p of this.providers.values()) {
      if (needsVision && p.cfg.supportsVision !== true) {
        reasons.push(`'${p.cfg.endpointId}' is not vision-capable`);
        continue;
      }
      if (!p.cfg.includedCost) {
        reasons.push(`'${p.cfg.endpointId}' is not marked included-cost (tick 'Included cost' in Providers to allow chat on this key)`);
        continue;
      }
      const missing = dataScopes.filter(s => !p.cfg.allowedDataScopes.includes(s));
      if (missing.length > 0) {
        reasons.push(`'${p.cfg.endpointId}' does not allow data scope(s) ${missing.join(', ')} (add them under Allowed data scopes in Providers)`);
        continue;
      }
      // Fully eligible by the same predicate selectFor uses — no block exists.
      return null;
    }
    return reasons.join('; ');
  }

  /**
   * One-call completion: routes to an eligible provider and resolves its key from
   * the configured SecretResolver (main-process vault / broker handle).
   */
  async complete(prompt: string, dataScopes: string[], needsVision = false): Promise<CloudCompletion> {
    return this.chat([{ role: 'user', content: prompt }], dataScopes, needsVision);
  }

  /**
   * Message-list chat through the key pool: eligible pool members are tried in
   * round-robin order; a failing key is cooled down and the request fails over to
   * the next key — but only while nothing has streamed yet (a half-delivered
   * answer is honest failure, not something to silently re-roll). Without a pool
   * this degrades to the legacy single-route behavior.
   */
  async chat(
    messages: CloudChatMessage[],
    dataScopes: string[],
    needsVision = false,
    onChunk?: (delta: string) => void,
    tools?: CloudToolSpec[],
  ): Promise<CloudCompletion> {
    if (!this.secretResolver) throw new CloudRouteError('gateway has no secret resolver configured');
    const candidates = this.candidatesFor(dataScopes, needsVision);
    if (candidates.length === 0) {
      const reason = this.routeBlockReason(dataScopes, needsVision);
      throw new CloudRouteError(
        `no eligible cloud route for request (cost/capability/scope)${reason ? `: ${reason}` : ''}`,
      );
    }

    const ordered = this.attemptOrder(candidates);
    this.requests++;

    const failures: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const provider = ordered[i]!;
      const id = provider.cfg.endpointId;
      let emitted = false;
      const chunkTap = onChunk === undefined
        ? undefined
        : (delta: string) => { emitted = true; onChunk(delta); };
      try {
        const apiKey = this.resolveKey(provider);
        const toolsOpt = tools !== undefined && tools.length > 0 ? { tools } : {};
        const opts = { apiKey, ...toolsOpt };
        const result = chunkTap === undefined
          ? await provider.chat(messages, opts)
          : await provider.chatStream(messages, opts, chunkTap);
        this.cooldowns.delete(id);
        this.lastUsedId = id;
        return result;
      } catch (err) {
        if (!(err instanceof CloudRouteError)) throw err; // implementation bug — bubble, don't mask
        if (emitted) throw err; // deltas already delivered — fail honestly
        const cls = classifyFailure(err);
        const now = this.hooks.now?.() ?? Date.now();
        this.cooldowns.set(id, { id, untilMs: now + cls.cooldownMs, reason: cls.reason });
        this.failovers++;
        const next = ordered[i + 1]?.cfg.endpointId ?? null;
        this.hooks.onAttempt?.({ from: id, to: next, reason: cls.reason, ...(err.status !== undefined ? { status: err.status } : {}) });
        failures.push(`'${id}': ${err.message}`);
      }
    }

    throw new CloudRouteError(
      `all ${ordered.length} pool key(s) failed — ${failures.join('; ')}`,
    );
  }

  /** Eligible pool members; falls back to all eligible providers when no pool. */
  private candidatesFor(dataScopes: string[], needsVision: boolean): CloudProvider[] {
    const eligible = (cfg: CloudProviderConfig): boolean => {
      if (!cfg.includedCost) return false;
      if (needsVision && cfg.supportsVision !== true) return false;
      return dataScopes.every(s => cfg.allowedDataScopes.includes(s));
    };
    const fromIds = (ids: string[]): CloudProvider[] => {
      const out: CloudProvider[] = [];
      for (const id of ids) {
        const p = this.providers.get(id);
        if (p && eligible(p.cfg)) out.push(p);
      }
      return out;
    };
    const pooled = fromIds(this.pool);
    if (pooled.length > 0) return pooled;
    // legacy / no-pool path: any eligible provider (selected preferred)
    const all = [...this.providers.values()].filter(p => eligible(p.cfg));
    if (all.length === 0) return [];
    if (this.selectedProviderId) {
      const preferred = this.providers.get(this.selectedProviderId);
      if (preferred && eligible(preferred.cfg)) {
        return [preferred, ...all.filter(p => p !== preferred)];
      }
    }
    return all;
  }

  /**
   * Round-robin rotation + cooldown ordering: healthy keys first (rotated start),
   * then cooling keys sorted by soonest recovery. When everything is cooling the
   * soonest-recovery key is still tried — the pool never refuses to try.
   */
  private attemptOrder(candidates: CloudProvider[]): CloudProvider[] {
    if (candidates.length === 0) return [];
    const start = this.rrIndex++ % candidates.length;
    const ring = [...candidates.slice(start), ...candidates.slice(0, start)];
    const now = this.hooks.now?.() ?? Date.now();
    const coolingAt = (p: CloudProvider): number => {
      const c = this.cooldowns.get(p.cfg.endpointId);
      return c !== undefined && c.untilMs > now ? c.untilMs : Number.POSITIVE_INFINITY;
    };
    const healthy = ring.filter(p => coolingAt(p) === Number.POSITIVE_INFINITY);
    const cooling = ring
      .filter(p => coolingAt(p) !== Number.POSITIVE_INFINITY)
      .sort((a, b) => coolingAt(a) - coolingAt(b));
    return [...healthy, ...cooling];
  }

  private resolveKey(provider: CloudProvider): string {
    if (this.secretResolver === null) {
      throw new CloudRouteError('gateway has no secret resolver configured');
    }
    const apiKey = this.secretResolver(provider.cfg.authHandle);
    if (!apiKey) {
      // Missing vault key is a local config failure — classify and fail over.
      throw new CloudRouteError(`no key in vault for provider '${provider.cfg.endpointId}'`);
    }
    return apiKey;
  }

  descriptor(id: string): ProviderDescriptor | null {
    const p = this.providers.get(id);
    if (!p) return null;
    return {
      endpointId: p.cfg.endpointId,
      modelId: p.cfg.model ?? 'default',
      capabilities: { text: true, tools: true, vision: p.cfg.supportsVision === true, streaming: true },
      contextLimit: 8_000, // conservative default until per-connection discovery (T08 follow-up)
      authHandle: p.cfg.authHandle,
      allowedDataScopes: [...p.cfg.allowedDataScopes],
      includedCost: p.cfg.includedCost,
      cancellation: false,
    };
  }
}
