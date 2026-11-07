# Changelog

All notable changes to Fairy. Format loosely follows Keep a Changelog;
version numbers are milestone tags, not semver promises.

## [0.6.0] — The companion update — 2026-11-08

### Added
- **Persistent chat history**: new `ConversationStore` in the fairy.db SQLite
  file. Every turn (user, assistant, tool calls, tool results) is persisted as
  it enters history; the latest transcript resumes automatically at boot, both
  in the model's context and the UI. `Clear` archives — it never destroys. The
  Chat panel gains a History strip: full-text search (LIKE with escaped
  wildcards), reopen, delete (deleting the active transcript clears live
  memory too). Store failures degrade to log lines — chat never dies with the
  database.
- **`fairy-doctor`**: `npm run doctor` / `electron . --doctor` probes every
  registered provider with a free `GET {baseUrl}/models` and prints a
  canon-flavored verdict — 200 OK, 401/403 auth-rejected, 429 rate-limited
  (key VALID), timeout unreachable — plus config/key-storage/journal health.
  Exits 0 only when every keyed route is live. Keyless local endpoints are
  probed without an auth header. 12 unit tests; no key material is ever
  printed.
- **Ollama preset (keyless local routes)**: `http://localhost:11434/v1` with
  no API key. `CloudProvider`/gateway accept keyless configs; the sanitizer
  keeps `keyless` ONLY for loopback/RFC1918 hosts (public hosts silently lose
  the flag — no unauthenticated cloud routes). `saveProvider` registers new
  keyless providers without a vault handle.
- **Fairy's voice (opt-in TTS)**: `Voice` chip in Chat speaks replies through
  the renderer's OS speech engine. Deterministic canon voice pick,
  `forSpeech()` strips code blocks/URLs/markup and caps at a sentence
  boundary, speak replaces the queue instead of stacking. Persisted in
  localStorage, off by default, hidden when no engine exists.
- **Floating orb widget (opt-in)**: borderless transparent always-on-top
  window rendering the eye (`?view=orb`); it mirrors runtime state live,
  summons the panel on click, and can be dragged anywhere. Toggle in
  Status → Shell presence; journaled like every arm switch.
- **System tray + global hotkey**: tray icon (embedded 16 px eye data-URL —
  no packaging resources) with Open / Floating-orb / Quit; `Ctrl/Cmd+Shift+F`
  summons the panel. Tray present → closing parks to tray; tray unavailable
  (headless Linux) → quit behavior unchanged.
- **Light theme + accent picker**: 41 hardcoded accent `rgba()` calls became
  `--f-acc-rgb`/`--f-cyan-rgb`/`--f-shine-rgb` triplets. Four iris accents
  (Fairy Blue / Signal Cyan / Holo Violet / Neon Magenta), each with a darker
  light-theme variant; light theme owns surfaces and dials scanlines to 0.16.
  Persisted renderer-side, applied before first paint in both windows.
- **Packaging**: win NSIS + mac DMG + linux AppImage targets; tag-triggered
  Release workflow builds on native runners and attaches installers;
  `dist:dir` for fast unpacked sanity checks.

### Fixed
- **Packaged app could never boot** (found by smoke-testing the unpacked
  build): the electron-builder `files` list shipped only `dist/desktop` +
  `dist/ui`, so main-process ESM imports (`dist/storage`, `dist/providers`,
  …) failed with ERR_MODULE_NOT_FOUND inside the asar. Now `dist/**/*`
  ships whole. Verified: `linux-unpacked/fairy --doctor` boots, opens the DB,
  probes, exits 0.
- Light-theme readability: dark glass surfaces (buttons, chips, inputs, rows,
  wordmark gradient) became theme-aware vars.
- Doctor probe misclassified real fetch timeouts (Node `DOMException` is not
  an `Error` instance) — names are now read structurally.
- Same-millisecond transcript creation could tie on `updated_at` — ordering
  is now monotonic within the process.

### Security
- Keyless routes are host-restricted (loopback/private only); the doctor
  probes keyless endpoints without credentials and never prints key material.

## [Unreleased]

### Planned
- Anthropic's native Messages API (Claude is reachable today via the
  OpenRouter preset); dictation/ASR (Electron's Chromium lacks the Google
  speech backend — a cloud ASR endpoint or whisper.cpp would be needed).

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
