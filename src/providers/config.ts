// Config-driven cloud route (T08). Loaded from app settings at runtime; secrets via broker handle.
// loadConfig validates and NORMALIZES input: unknown fields (including any raw apiKey
// material smuggled in by a caller) are stripped, malformed provider entries are dropped.
import type { CloudProviderConfig } from './cloud.js';

export interface FairyConfig {
  cloudProviders: CloudProviderConfig[];
  selectedProviderId?: string;
  /**
   * Ordered key-pool member ids (v0.4): Fairy round-robins across these and
   * fails over between them. Absent = legacy single-selection routing.
   */
  activeProviderIds?: string[];
  // local models disabled by default (cloud-only mode)
  allowLocalModels: boolean;
  /** ISO timestamp of the user-agreement signing (canon: Fairy compels the contract). */
  agreementAcceptedAt?: string;
  /** Master's explicit opt-in for the command_run tool (default: off). */
  allowCommandExecution?: boolean;
}

export const DEFAULT_CONFIG: FairyConfig = {
  cloudProviders: [],
  allowLocalModels: false,
};

const MAX_PROVIDERS = 32;
const MAX_SCOPES = 16;
const KNOWN_SENSITIVITIES = new Set(['public', 'internal', 'private', 'secret']);

function sanitizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['public'];
  const scopes = [...new Set(raw.filter((s): s is string => typeof s === 'string' && s.length > 0))]
    .filter(s => KNOWN_SENSITIVITIES.has(s) || /^[a-z0-9-]{1,32}$/i.test(s))
    .slice(0, MAX_SCOPES);
  return scopes.length > 0 ? scopes : ['public'];
}

/** Validate one provider entry; returns null for anything malformed. */
export function sanitizeProvider(item: unknown): CloudProviderConfig | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const it = item as Record<string, unknown>;
  const endpointId = typeof it.endpointId === 'string' ? it.endpointId.trim() : '';
  const baseUrl = typeof it.baseUrl === 'string' ? it.baseUrl.trim() : '';
  if (endpointId.length === 0 || endpointId.length > 64) return null;
  if (!/^https?:\/\/.{1,2000}$/i.test(baseUrl)) return null;
  const authHandle = typeof it.authHandle === 'string' ? it.authHandle : '';
  if (!authHandle.startsWith('cred_') && authHandle !== '') return null;
  const cfg: CloudProviderConfig = {
    endpointId,
    baseUrl,
    authHandle,
    includedCost: it.includedCost === true,
    allowedDataScopes: sanitizeScopes(it.allowedDataScopes),
  };
  if (typeof it.model === 'string' && it.model.trim().length > 0 && it.model.trim().length <= 128) {
    cfg.model = it.model.trim();
  }
  if (it.supportsVision === true) cfg.supportsVision = true;
  return cfg;
}

export function loadConfig(raw: unknown): FairyConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
  const r = raw as Record<string, unknown>;
  const providers: CloudProviderConfig[] = [];
  if (Array.isArray(r.cloudProviders)) {
    for (const item of r.cloudProviders.slice(0, MAX_PROVIDERS)) {
      const p = sanitizeProvider(item);
      if (p) providers.push(p);
    }
  }
  const selectedRaw = typeof r.selectedProviderId === 'string' ? r.selectedProviderId : undefined;
  const selected = selectedRaw !== undefined && providers.some(p => p.endpointId === selectedRaw)
    ? selectedRaw
    : undefined;
  // Key pool: ordered, deduped, and only ids that actually exist survive — a
  // deleted provider must silently leave the pool, not crash routing.
  const activeRaw = Array.isArray(r.activeProviderIds) ? r.activeProviderIds : undefined;
  const active = activeRaw !== undefined
    ? [...new Set(
        activeRaw
          .filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 64)
          .filter(s => providers.some(p => p.endpointId === s)),
      )].slice(0, MAX_PROVIDERS)
    : undefined;
  const activeIds = active !== undefined && active.length > 0 ? active : undefined;
  // Agreement timestamp: accept only ISO-8601-shaped strings, capped for safety.
  const agreementAcceptedAt = typeof r.agreementAcceptedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(r.agreementAcceptedAt)
    && r.agreementAcceptedAt.length <= 40
    ? r.agreementAcceptedAt
    : undefined;
  const cfg: FairyConfig = {
    cloudProviders: providers,
    allowLocalModels: r.allowLocalModels === true, // policy: stays false in cloud-only mode
    ...(selected !== undefined ? { selectedProviderId: selected } : {}),
    ...(activeIds !== undefined ? { activeProviderIds: activeIds } : {}),
    ...(agreementAcceptedAt !== undefined ? { agreementAcceptedAt } : {}),
    ...(r.allowCommandExecution === true ? { allowCommandExecution: true } : {}),
  };
  return cfg;
}

/**
 * The pool the gateway should route through: explicit activeProviderIds when
 * present, else the legacy single selection, else [] (auto routing).
 */
export function effectivePool(cfg: FairyConfig): string[] {
  if (cfg.activeProviderIds !== undefined) return [...cfg.activeProviderIds];
  if (cfg.selectedProviderId !== undefined) return [cfg.selectedProviderId];
  return [];
}

/**
 * Defense in depth for persistence: recursively strips any secret-looking fields
 * from the object graph before it touches disk. Matching is by SUBSTRING, not
 * exact name — `topSecret`, `authToken`, `myApiKey` all count — because a missed
 * alias that survives to disk is far worse than an over-stripped benign field.
 */
const SECRET_FIELD_PATTERN = /(api_?key|secret|token|password)/i;

export function sanitizeConfigForPersist<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => sanitizeConfigForPersist(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD_PATTERN.test(k)) continue;
      out[k] = sanitizeConfigForPersist(v);
    }
    return out as unknown as T;
  }
  return value;
}
