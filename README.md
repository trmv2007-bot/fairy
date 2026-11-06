# Fairy

Proactive Windows desktop assistant (Electron + TS + React + SQLite + .NET 8 broker).

## What works today

- **Chat** — streaming conversations with your configured cloud provider through the
  zero-additional-spend gateway; conversation lives in the main process, deltas stream
  over the typed sandboxed bridge, and the orb reflects live state.
- **Provider management** — add/select/delete providers in the panel; API keys are
  encrypted by the OS (DPAPI on Windows) in `fairy-keys.json` and survive restarts.
  Raw keys never touch disk in plain text, in any file.
- **Native broker** (optional) — a .NET named-pipe host exposing policy approvals,
  path-jail resolution, egress checks and the fail-closed upgrade gate over JSON lines.
  The app degrades gracefully when it is not running (Status tab shows offline).
- **Git connector** — real local repo read operations (status/log/diff) via a
  fixed-arg-vector `execFile` (no shell), with an injectable runner for tests.

Scaffolded but not yet wired into the running app: job workers, observation loops,
remaining connectors, skills runtime. See `fairyplan.md` for the full spec.

## Architecture

```
┌─ Electron main (Node) ──────────────────────────────────────────────┐
│ src/desktop/main.ts      shell, settings IPC, chat IPC, broker probe│
│   ├─ src/desktop/chat.ts       conversation + streaming + journal   │
│   ├─ src/providers/gateway.ts  routing by cost/scope/vision         │
│   ├─ src/providers/cloud.ts    OpenAI-compatible client (SSE + JSON)│
│   ├─ src/providers/persisted-key-store.ts  OS-encrypted key file    │
│   ├─ src/storage/*             fairy.db journal + config store      │
│   └─ preload.cts → preload.cjs  contextBridge: typed settings+chat  │
├─ Renderer (sandboxed, no Node) ─────────────────────────────────────┤
│ src/desktop/ui/  App.tsx · Chat.tsx · Orb.tsx · Panel · settings    │
├─ Native client ─────────────────────────────────────────────────────┤
│ src/native/broker-client.ts    JSON-line protocol over named pipe   │
│ native/Fairy.Broker            BrokerHost + pipe server (see below) │
│ native/Fairy.Evaluator         fail-closed upgrade gate             │
│ native/Fairy.Recovery          state rollback                       │
└─────────────────────────────────────────────────────────────────────┘
```

Security invariants: sandboxed renderer (no Node), strict CSP, navigation/
`window.open`/webview/permission lockdown, keys only ever cross the bridge as
opaque `cred_` handles, secret-shaped fields stripped before every persist, and
the native evaluator/upgrader fails closed.

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

## Run the native broker (optional)

```powershell
dotnet build native/Fairy.Broker/Fairy.Broker.csproj -c Release
dotnet run --project native/Fairy.Broker/Fairy.Broker.csproj
```

Leave it running; the desktop app detects it on the `fairy-broker` pipe
(`\\.\pipe\fairy-broker` on Windows) and flips the Status-tab indicator to
**online**. Protocol: newline-delimited JSON — `{id, op, payload}` in,
`{id, ok, result | error}` out; ops: `ping`, `sandbox.resolve`, `egress.check`,
`policy.issue`, `policy.consume`.

## Test

```powershell
npm test              # typecheck + unit + integration + security
npm run test:e2e      # drives the built app via Playwright + Electron
                      # (Linux CI: xvfb-run -a npm run test:e2e)
npm run test:native   # dotnet run --project native/Fairy.Tests/Fairy.Tests.csproj
```

The e2e suite spins up a local mock LLM (OpenAI-compatible SSE) and drives a full
streaming chat round trip through the real UI — no network, no real key. The
native suite covers policy approvals, path-jail escapes, egress provenance
(fail-closed parents and cycles), recovery, the upgrade gate and the broker host
protocol. CI runs both tracks (`.github/workflows/ci.yml`).

## Configuration

Copy `.env.example` to `.env` for optional first-run seeding and the dev URL.
Providers are added in the app's **Providers** panel; the API key is encrypted by
the OS and persisted so it survives restarts — the on-disk config keeps opaque
handles only. Without OS key storage (Linux without a keyring), keys stay
session-only by design: no plain-text fallback exists.

**New-user tip:** chat only routes to providers marked **Included cost**
(zero-additional-spend policy). The add-provider form defaults the data scopes
to `public, internal` — exactly what chat requests — so ticking "Included cost"
is all it takes for the first message to work. If a route is blocked, the error
names the exact provider and the knob to turn.

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

`OVERNIGHT_REPORT.md` tracks the build sprints; `fairyplan.md` is the
authoritative spec. Next milestones:

1. Wire the coordinator + scheduler into the shell (proactive jobs, approvals UI)
2. First live connector surface (git connector is implemented and tested)
3. Broker-enforced approvals on mutating skills, DPAPI via broker CredentialHost
4. Daily-use packaging (T30) hardening after live proofs

## Notes

- Windows-first; the TS track runs anywhere Node 24 runs, the native broker
  targets .NET 8 (DPAPI paths are Windows-specific by design).
- Full spec: `fairyplan.md`.
