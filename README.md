# Fairy

Proactive Windows desktop assistant (Electron + TS + React + SQLite + .NET 8 broker).

> **Status: early scaffold.** The desktop shell, settings management, provider
> vaulting, and the native policy/sandbox/egress/credential/recovery components
> are real and tested. The assistant runtime (chat loop, job workers, live
> connectors, observation) is scaffolded but not yet wired into the running app —
> see [Roadmap](#roadmap) and `fairyplan.md` for the full spec.

## Architecture

```
┌─ Electron main (Node) ──────────────────────────────────────────────┐
│ src/desktop/main.ts      shell, single-instance lock, settings IPC  │
│   ├─ src/storage/settings.ts       fairy-config.json (0600)         │
│   ├─ src/providers/config.ts       validate + normalize + strip     │
│   └─ src/providers/secret-vault.ts in-memory handle → key map      │
│   └─ preload.cts → preload.cjs  contextBridge: typed settings only │
├─ Renderer (sandboxed, no Node) ─────────────────────────────────────┤
│ src/desktop/ui/  App.tsx (Orb + Panel) · settings-ui.tsx            │
├─ Library layers (tested, wiring pending) ───────────────────────────┤
│ src/providers/gateway.ts   model routing by cost/scope/vision       │
│ src/storage/{database,journal,memory,jobs}.ts  SQLite + FTS5        │
│ src/runtime/coordinator.ts job state machine + crash recovery       │
│ src/skills/* · src/connectors/* · src/observation/* · src/evolution/* │
├─ Native (.NET 8) ───────────────────────────────────────────────────┤
│ Fairy.Broker     policy (one-use approvals), path sandbox, egress   │
│                  provenance, DPAPI credential host                  │
│ Fairy.Evaluator  fail-closed upgrade gate                          │
│ Fairy.Recovery   state rollback                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Security invariants enforced today: sandboxed renderer (no Node), strict CSP,
navigation/`window.open`/webview lockdown, raw API keys never touch disk
(vaulted in memory for the session; persisted config stores opaque `cred_`
handles), secret-shaped fields stripped again before every persist, and the
native evaluator/upgrader fails closed.

## Run (dev, Windows)

```powershell
npm install          # also rebuilds better-sqlite3 against Electron (postinstall)
npm run build
npm run dev          # or: node_modules/electron/dist/electron.exe .
```

To develop the UI against the Vite dev server with hot reload:

```powershell
copy .env.example .env      # then set FAIRY_DEV_URL=http://localhost:5173
npm run dev:ui              # terminal 1
npm run dev                 # terminal 2
```

## Test

```powershell
npm test              # typecheck + unit + integration + security
npm run test:e2e      # drives the built app via Playwright + Electron
npm run test:native   # dotnet run --project native/Fairy.Tests/Fairy.Tests.csproj
```

The native suite covers policy approvals, path-jail escapes, egress provenance
(including fail-closed parents and cycles), recovery, and the fail-closed
upgrade gate. CI runs both tracks (`.github/workflows/ci.yml`).

## Configuration

Copy `.env.example` to `.env` for optional first-run seeding and the dev URL.
Providers are added in the app's **Providers** panel; the API key is vaulted in
the main process for the session and never persisted — the on-disk config keeps
opaque handles only.

**Cloud-only mode (user directive):** local models are disabled at the registry
level; enabling one throws. `includedCost` providers only — zero additional
spend is encoded in the cloud route.

## Packaging

```powershell
npm run build
npx electron-builder --win nsis
```

`electron-builder.yml` unpacks native `.node` modules from the asar so
better-sqlite3 loads correctly in the packaged app.

## Roadmap

The `OVERNIGHT_REPORT.md` tracks the last build sprint; `fairyplan.md` is the
authoritative spec. Next milestones:

1. Live cloud route proof (T08) with a real provider key
2. Wire the gateway + coordinator into the shell (chat surface, job workers)
3. First live connector (T19+), native broker host loop, DPAPI-backed key persistence
4. Daily-use packaging (T30) after live proofs

## Notes

- Windows-first; the TS track runs anywhere Node 24 runs, the native broker
  targets .NET 8 (DPAPI paths are Windows-specific by design).
- Full spec: `fairyplan.md`.
