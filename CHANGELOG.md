# Changelog

All notable changes to Fairy. Format loosely follows Keep a Changelog;
version numbers are milestone tags, not semver promises.

## [Unreleased]

### Planned (v0.6 batch)
- Persistent chat history (SQLite): conversations survive restarts, session
  list, search, resume.
- Provider presets: Ollama (local, OpenAI-compatible).
- Voice: speak replies via the OS speech engine (opt-in).
- Floating orb widget, system tray, global hotkey.
- Appearance: light theme + accent color.
- Packaging: electron-builder targets + release workflow.
- `fairy-doctor` diagnostics CLI.

## [0.5.0] — Shell remodel ("holo-glass") — 2026-11-06

### Added
- Holo-glass design system (`src/desktop/ui/theme.css`): gradient hairline
  borders with slow shimmer, staggered entrances, glass chat bubbles with a
  streaming caret, chip system, `prefers-reduced-motion` support.
- Command-bar-first panel: one persistent input up top; tabs became chips;
  clicking the active chip collapses the section into a pure command console.
- State-reactive iris: mandala rings rotate, pupil dilates per state, throb
  on alerts. `aria-label` orb contract preserved.
- Restyled CRT boot ritual with glitching wordmark and holo readout panels —
  same canon lines and timing.
- Provider preset chips (Groq / OpenAI / OpenRouter) — one-click endpoint +
  model fill; presets never touch credentials.

### Changed
- `index.html` links `theme.css` instead of inline styles.
- Chat logic lifted into the `useChat` controller; `Chat.tsx` is presentational.

### Fixed
- Header tagline no longer wraps to three lines; Status section scrolls
  internally instead of painting over the notice line; OS kernel string no
  longer clips horizontally.

## [0.4.x] — Key pool + Groq — 2026-11-05

### Added
- Key pool (v0.4): multiple API keys per/around providers, round-robin across
  all active keys, automatic failover on 429/401/5xx/network, cooldown classes
  (90 s rate-limit, 15 min auth-rejected, 20 s transient), live pool status in
  the Status HUD, failover + pool-edit journal events.
- Groq wiring: preset chip, `.env` seed re-vault on restart/key rotation,
  Groq quickstart in the README, launch + tour scripts (`scripts/`).

### Security
- Key replacement drops orphaned vault handles; pool payloads validated
  (strings, length caps, dedup, unknown-id filtering).

## [0.3.0] — Power-on ritual — 2026-11-04

### Added
- CRT boot sequence on every window load: scan readout → eye wakes → Fairy
  introduces herself and addresses Master; auto-dismisses.

## [0.2.0] — Fairy's hands — 2026-11-03

### Added
- OpenAI-compatible function calling end to end: tool declarations, streamed
  tool_calls parsing, bounded tool loop (final round forces a text answer).
- Device tools: `system_info`, `power_status`, `window_list`, `fs_search`,
  `fs_read_text`, `net_diagnostics`, `shell_open`, `command_run`
  (allowlisted, off until armed in Status; every flip journalled).
- Live Status HUD measured in the main process; tool activity chips in chat.

## [0.1.x] — Canon foundation — 2026-11-02

### Added
- Canon accuracy pass: pixel avatar, mandatory user agreement (compulsory,
  exactly one refusal permitted), H.D.D. naming, Fairy blue/navy palette.
- Zero-additional-spend gateway, secret vault (opaque `cred_` handles only),
  SQLite event journal, sandboxed renderer with typed contextBridge.
- .NET 8 broker: policy approvals, path-jail, egress provenance, upgrade gate
  (fail-closed), recovery; window enumeration on Windows.
