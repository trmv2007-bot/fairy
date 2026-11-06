import { describe, it, expect } from 'vitest';
import { ModelGateway } from '../../src/providers/gateway.js';
import type { FairyConfig } from '../../src/providers/config.js';
import type { CloudProviderConfig } from '../../src/providers/cloud.js';

function provider(patch: Partial<CloudProviderConfig>): CloudProviderConfig {
  return {
    endpointId: 'p1',
    baseUrl: 'https://api.example.com/v1',
    authHandle: 'cred_test',
    includedCost: true,
    allowedDataScopes: ['public', 'internal'],
    ...patch,
  };
}

function cfg(providers: CloudProviderConfig[], selectedProviderId?: string): FairyConfig {
  return {
    cloudProviders: providers,
    allowLocalModels: false,
    ...(selectedProviderId !== undefined ? { selectedProviderId } : {}),
  };
}

describe('ModelGateway.selectFor', () => {
  it('routes to an eligible provider (cost + scope)', () => {
    const gw = new ModelGateway(cfg([provider({})]));
    expect(gw.selectFor(['public'], false)?.cfg.endpointId).toBe('p1');
  });

  it('returns null when provider is not included-cost (no paid fallback)', () => {
    const gw = new ModelGateway(cfg([provider({ includedCost: false })]));
    expect(gw.selectFor(['public'], false)).toBeNull();
  });

  it('returns null when requested scope is not allowed', () => {
    const gw = new ModelGateway(cfg([provider({ allowedDataScopes: ['public'] })]));
    expect(gw.selectFor(['internal'], false)).toBeNull();
  });

  it('vision request skips providers without verified vision capability', () => {
    const gw = new ModelGateway(cfg([provider({})]));
    expect(gw.selectFor(['public'], true)).toBeNull();
    const visionGw = new ModelGateway(cfg([provider({ supportsVision: true })]));
    expect(visionGw.selectFor(['public'], true)?.cfg.endpointId).toBe('p1');
  });

  it('prefers the user-selected provider when it is eligible', () => {
    const providers = [
      provider({ endpointId: 'first' }),
      provider({ endpointId: 'second' }),
    ];
    const gw = new ModelGateway(cfg(providers, 'second'));
    expect(gw.selectFor(['public'], false)?.cfg.endpointId).toBe('second');
  });

  it('ignores a selected provider that is not eligible for the request', () => {
    const providers = [
      provider({ endpointId: 'no-scope', allowedDataScopes: ['public'] }),
      provider({ endpointId: 'full' }),
    ];
    const gw = new ModelGateway(cfg(providers, 'no-scope'));
    expect(gw.selectFor(['internal'], false)?.cfg.endpointId).toBe('full');
  });

  it('complete() resolves key through the secret resolver', async () => {
    const gw = new ModelGateway(cfg([provider({})]), handle =>
      handle === 'cred_test' ? 'sk-test' : undefined);
    await expect(gw.complete('hello', ['public'])).rejects.toThrow(/network error|provider request/);
  });

  it('complete() without a stored key fails closed', async () => {
    const gw = new ModelGateway(cfg([provider({})]), () => undefined);
    await expect(gw.complete('hello', ['public'])).rejects.toThrow(/no key in vault/);
  });

  it('descriptor() reports config-derived capabilities', () => {
    const gw = new ModelGateway(cfg([provider({ supportsVision: true, model: 'm1' })]));
    const d = gw.descriptor('p1');
    expect(d?.capabilities.vision).toBe(true);
    expect(d?.modelId).toBe('m1');
    expect(d?.includedCost).toBe(true);
    expect(gw.descriptor('nope')).toBeNull();
  });
});
