// Appearance registry (v0.6): light/dark theme + accent iris color.
// Renderer-side, persisted in localStorage — the main process never needs to
// know. applyStoredAppearance() runs before React mounts so the first paint
// already carries the user's look (CSP forbids an inline bootstrap script).
export type ThemeId = 'dark' | 'light';
export type AccentId = 'fairy' | 'cyan' | 'violet' | 'magenta';

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Night CRT' },
  { id: 'light', label: 'Daylight ops' },
];

export const ACCENTS: { id: AccentId; label: string }[] = [
  { id: 'fairy', label: 'Fairy Blue' },
  { id: 'cyan', label: 'Signal Cyan' },
  { id: 'violet', label: 'Holo Violet' },
  { id: 'magenta', label: 'Neon Magenta' },
];

const THEME_KEY = 'fairy.theme';
const ACCENT_KEY = 'fairy.accent';

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v !== null && v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readStoredTheme(): ThemeId {
  return stored(THEME_KEY, ['dark', 'light'] as const, 'dark');
}

export function readStoredAccent(): AccentId {
  return stored(ACCENT_KEY, ACCENTS.map(a => a.id) as readonly AccentId[], 'fairy');
}

/** Idempotent: safe to call on every window (main panel AND floating orb). */
export function applyStoredAppearance(): void {
  document.documentElement.dataset.theme = readStoredTheme();
  document.documentElement.dataset.accent = readStoredAccent();
}

export function storeTheme(theme: ThemeId): void {
  try { globalThis.localStorage?.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  document.documentElement.dataset.theme = theme;
}

export function storeAccent(accent: AccentId): void {
  try { globalThis.localStorage?.setItem(ACCENT_KEY, accent); } catch { /* private mode */ }
  document.documentElement.dataset.accent = accent;
}
