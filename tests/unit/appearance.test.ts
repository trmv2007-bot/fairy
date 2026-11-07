import { describe, it, expect, beforeEach } from 'vitest';
import {
  readStoredTheme,
  readStoredAccent,
  applyStoredAppearance,
  storeTheme,
  storeAccent,
  THEMES,
  ACCENTS,
} from '../../src/desktop/ui/appearance.js';

describe('appearance (theme + accent)', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
  });

  it('defaults: dark + Fairy Blue when nothing (or junk) is stored', () => {
    expect(readStoredTheme()).toBe('dark');
    expect(readStoredAccent()).toBe('fairy');
    globalThis.localStorage?.setItem('fairy.theme', 'sepia');
    globalThis.localStorage?.setItem('fairy.accent', 'chartreuse');
    expect(readStoredTheme()).toBe('dark');
    expect(readStoredAccent()).toBe('fairy');
  });

  it('stores and reapplies the user look onto <html> data attributes', () => {
    storeTheme('light');
    storeAccent('violet');
    expect(globalThis.localStorage?.getItem('fairy.theme')).toBe('light');
    expect(globalThis.localStorage?.getItem('fairy.accent')).toBe('violet');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('violet');
    // Idempotent re-apply (orb window + panel both call it)
    applyStoredAppearance();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.accent).toBe('violet');
  });

  it('registry ids match the CSS data-attribute selectors', () => {
    // theme.css ships :root[data-accent='…'] for exactly these ids.
    expect(ACCENTS.map(a => a.id)).toEqual(['fairy', 'cyan', 'violet', 'magenta']);
    expect(THEMES.map(t => t.id)).toEqual(['dark', 'light']);
  });

  it('survives a missing localStorage (private mode)', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    try {
      expect(readStoredTheme()).toBe('dark');
      expect(() => storeTheme('light')).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe('light');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
    }
  });
});
