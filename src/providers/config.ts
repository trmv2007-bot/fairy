// Config-driven cloud route (T08). Loaded from app settings at runtime; secrets via broker handle.
import type { CloudProviderConfig } from './cloud.js';

export interface FairyConfig {
  cloudProviders: CloudProviderConfig[];
  selectedProviderId?: string;
  // local models disabled by default (cloud-only mode)
  allowLocalModels: boolean;
}

export const DEFAULT_CONFIG: FairyConfig = {
  cloudProviders: [],
  allowLocalModels: false,
};

export function loadConfig(raw: unknown): FairyConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const r = raw as Record<string, unknown>;
  const cfg: FairyConfig = {
    cloudProviders: Array.isArray(r.cloudProviders) ? (r.cloudProviders as CloudProviderConfig[]) : [],
    allowLocalModels: r.allowLocalModels === true,
  };
  if (typeof r.selectedProviderId === 'string') cfg.selectedProviderId = r.selectedProviderId;
  return cfg;
}
