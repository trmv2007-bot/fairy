// Provider presets (v0.5): one-click fill for known OpenAI-compatible endpoints.
// Guards the contract the routing layer depends on — every preset must produce a
// config the sanitizer accepts and a model the endpoint actually serves.
import { describe, it, expect } from 'vitest';
import { PROVIDER_PRESETS, EMPTY_FORM, formToPayload } from '../../src/desktop/settings-ui.js';

describe('provider presets', () => {
  it('lists Groq first (Master\'s current provider)', () => {
    expect(PROVIDER_PRESETS[0]?.id).toBe('groq');
  });

  it('every preset fills a sanitizer-valid provider payload', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.endpointId.length).toBeGreaterThan(0);
      expect(p.endpointId.length).toBeLessThanOrEqual(64);
      if (p.keyless === true) {
        // Local keyless presets ride plain http on a private host only.
        expect(p.baseUrl).toMatch(/^http:\/\/localhost/);
      } else {
        expect(p.baseUrl).toMatch(/^https:\/\/.{1,2000}$/i);
      }
      expect(p.model.trim().length).toBeGreaterThan(0);
    }
  });

  it('Ollama preset is local, keyless, and offline-friendly', () => {
    const ollama = PROVIDER_PRESETS.find(p => p.id === 'ollama');
    expect(ollama?.baseUrl).toBe('http://localhost:11434/v1');
    expect(ollama?.keyless).toBe(true);
    expect(ollama?.model).not.toBe('');
  });

  it('applying the Ollama preset yields a keyless payload with no key material', () => {
    const ollama = PROVIDER_PRESETS.find(p => p.id === 'ollama')!;
    const payload = formToPayload({
      ...EMPTY_FORM,
      endpointId: ollama.endpointId,
      baseUrl: ollama.baseUrl,
      model: ollama.model,
      keyless: true,
    });
    expect(payload.keyless).toBe(true);
    expect('apiKey' in payload).toBe(false);
  });

  it('preset ids are unique', () => {
    expect(new Set(PROVIDER_PRESETS.map(p => p.id)).size).toBe(PROVIDER_PRESETS.length);
  });

  it('Groq preset targets api.groq.com with a current production model', () => {
    const groq = PROVIDER_PRESETS.find(p => p.id === 'groq');
    expect(groq?.baseUrl).toBe('https://api.groq.com/openai/v1');
    // llama-3.3-70b-versatile was decommissioned 2026-08-16 — never ship it again.
    expect(groq?.model).not.toMatch(/llama-3\.3-70b-versatile/);
    expect(groq?.model).toBe('openai/gpt-oss-120b');
  });

  it('applying a preset through the form payload keeps the key out until typed', () => {
    const groq = PROVIDER_PRESETS[0]!;
    const payload = formToPayload({
      ...EMPTY_FORM,
      endpointId: groq.endpointId,
      baseUrl: groq.baseUrl,
      model: groq.model,
    });
    expect(payload.endpointId).toBe('groq');
    expect(payload.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(payload.model).toBe('openai/gpt-oss-120b');
    expect('apiKey' in payload).toBe(false); // no key typed → no key sent
    expect(payload.includedCost).toBe(false); // zero-spend consent stays manual
  });
});
