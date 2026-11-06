# Fairy — Overnight Build Report

## Status
Phase A–E scaffolds complete. 15 commits. All gates green.

## Verified
- TS: typecheck clean, build clean
- Unit tests: 16/16 pass
- Integration tests: 14/14 pass
- Native (dotnet 8.0.427): PolicyTests 7/7, SandboxTests 8/8, EgressTests 9/9, RecoveryTests 3/3 — ALL PASS
- 4 native projects build (Broker, Tests, Evaluator, Recovery)

## Toolchain installed (with approval)
- .NET SDK 8.0.427 (winget)
- Rust toolchain 1.99.1 (rustup, stable-x86_64-pc-windows-msvc) — for future Tauri if needed
- Node 24.18.0 (tools/node) pinned for app build
- Electron 45.2.3, Vite 8, Vitest 5, Playwright 1.64, React 19, better-sqlite3 13

## Deferred (gates needing user/accounts)
- T07 local model: SKIPPED per user directive — cloud-only mode. ProviderRegistry.enableLocal throws.
- T08 cloud route: no account verified; scaffold only.
- T19-T29 live connectors: need real accounts/devices; interfaces in place.
- Ollama: install was started then cancelled (user said no local models). Not installed.
- T02 live Electron E2E: harness wired (Playwright) but orb spec is placeholder.

## Cloud-only mode
- .env.example documents.
- CloudProvider enforces includedCost (no paid fallback).
- Zero-additional-spend policy encoded.

## Next steps when user returns
1. Provide a cloud API key handle (Anthropic/OpenAI/etc.) for T08 live test.
2. Decide on Electron vs Tauri (currently Electron).
3. Pick a subscription connector (T19) for cloud route.
4. Begin T30 daily-use packaging after T08+T12+T13 live proofs.

## Hardening pass (follow-up)
- Journal replay: monotonic `seq` column — same-ms bursts now replay in insertion order.
- `sanitizeConfigForPersist`: secret-field matching is substring-based (topSecret/authToken/myApiKey count).
- `tsconfig.tests.json` exclude override: test files are actually type-checked now.
- `EvolutionClient` no longer returns hardcoded `passed: true` — HTTP evaluator client, fail closed.
- `EgressTests.cs` synced with fail-closed parent resolution; `UpgradeTests.cs` added (Fairy.Evaluator now referenced).
- Electron main: IPC result envelopes + payload validation on all handlers, origin-based dev-URL check, webview/permission lockdown, vault handle cleanup on key replacement.
- `ResourceGovernor`: stale heavy slot self-heals after 30 min (crashed jobs cannot block forever).
- DX/packaging: `.env.example`, LICENSE (MIT), GitHub Actions CI, `postinstall` electron-rebuild, `asarUnpack` for `*.node`, `.gitignore` entries, README rewrite.

## Files
- fairyplan.md (original spec, 483 lines)
- OVERNIGHT_REPORT.md (this)
