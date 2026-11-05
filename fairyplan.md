# Fairy Implementation Plan

**Date:** 2026-11-05  
**Status:** Requirements interview complete; proposed design and build roadmap, not an implemented app.  
**Location:** `C:/Users/rishi/Agent/Fairy`  
**Goal:** Build a standalone, proactive Windows assistant inspired by Fairy from Zenless Zone Zero that controls the user's PC, codes, researches, and safely expands its own capabilities using local and cloud AI.

**Architecture:** A local desktop app with a small, protected permission-and-recovery foundation, replaceable assistant components, and isolated workers. Models and external services connect through explicit adapters rather than determining Fairy's identity or owning its memory.

**Proposed stack:** Electron, TypeScript, React, SQLite, and a narrow Windows-native helper. Prefer existing supported AI runtimes over rebuilding their authentication or inference engines. Exact stable dependency versions and the helper's build prerequisites must pass the first feasibility gate.

**Spec:** The confirmed requirements and design in this document are the specification; no separate spec file is required. This is a subsystem-level implementation roadmap, not a claim that every future command, provider integration, or sandbox is already available. Expand the next subsystem into small test-first coding tasks when implementation is authorized.

**Execution boundary:** This request authorizes this plan only. Do not scaffold, install dependencies, connect accounts, enable monitoring, change Windows settings, or build the app until asked. Do not commit or publish without authorization.

## 1. Confirmed product decisions

| Area | User's answer |
|---|---|
| Product | Its own app, not a Qoder extension or a skin over another assistant. |
| Platform | Windows-first desktop app on this PC; other devices are a later connection family. |
| Main jobs | PC control, coding, and research, in that priority group. |
| Behavior | Proactive, not only reactive chat. |
| Self-expansion | Create new skills, tools, connections, and improvements to Fairy's own replaceable code. |
| Upgrade activation | Tested upgrades activate automatically within existing permissions, when idle, with rollback. |
| Sensitive actions | Confirm before sending/posting, purchases, deleting user files, third-party installs, or system/security changes. |
| Awareness | Whole desktop while explicitly enabled, with private-app exclusions, a visible indicator, and pause control. |
| Memory | Automatic local memory, inspectable, editable, and deletable; credentials excluded. |
| Cloud privacy | Private data may leave the PC only within explicitly approved scopes. |
| AI connections | Cloud API keys, local model runners, supported existing-subscription integrations, other agents, and self-hosted endpoints. |
| Ongoing budget | No additional spending beyond subscriptions already owned. |
| Other connections | Email/calendar/tasks, Git/developer tools, messaging/community services, and other devices/home services. |
| Proactive triggers | Schedules, approved app/file events, unfinished goals, and opportunities to improve itself. |
| Personality | Strong Fairy-inspired identity: confident, dry, witty, and competent. |
| Interface | Floating orb and a side panel. |
| Voice | Continuous conversation during an explicitly enabled session; not an always-on recorder. |
| Planning deliverable | This single `fairyplan.md`, written after the questions were answered. |

These are product requirements, not present-day permissions for the planning agent to access accounts or control the desktop. None of the requested connection families or self-evolution capabilities is being silently removed; their delivery order and gates are listed below.

## 2. Meaning of “all capabilities”

Fairy should be broadly extensible, not advertised as omnipotent. It can gain a capability when a supported interface, sufficient local resources, and the user's permission exist. It cannot guarantee access to every app, free unlimited cloud inference, perfect unattended PC control, or an increase in a model's intelligence simply by rewriting prompts.

Self-evolution means measurable improvement to workflows, tools, adapters, retrieval, and replaceable app code. Training new foundation models is not a baseline requirement. A new ability that needs extra privileges, a new account, a paid service, or a third-party executable still stops at that boundary.

The target is one persistent Fairy identity across changing models. A provider outage must not erase conversations, goals, personality settings, or local memory.

## 3. Ground truth on this PC

Read-only checks performed on 2026-11-05:

| Check | Observed result | Planning consequence |
|---|---|---|
| Workspace | Directory exists and was empty before this document; no repository or application present. | Every proposed source path below is new, not an existing module. |
| OS | Windows 11 Pro, build `10.0.26300`. | Windows-native integration is appropriate; sandbox support still requires a direct implementation-time test. |
| CPU | Intel Core i7-12700F, 20 logical processors. | Background CPU jobs are possible but must yield to interactive work. |
| RAM | Approximately 15.8 GiB usable. | Avoid multiple heavy resident model processes. |
| GPU | NVIDIA GeForce RTX 3050, 8192 MiB VRAM verified with `nvidia-smi`. | Start with one modest quantized model and measure actual memory headroom. |
| Disk | Approximately 87.9 GiB free on C: at check time. | Model downloads, build caches, snapshots, and retained releases need explicit size limits. |
| Shell Node | PATH resolves to Node `v26.13.0`; npm `11.20.0`. | Do not assume the host session's Node version equals the build shell's version. |
| Alternate Node | `C:/Users/rishi/tools/node/node.exe` reports `v24.18.0`. | It is available, but select a supported stable build/runtime version during bootstrap rather than assuming this is the right pin. |
| Git / Python | Git `2.55.0.windows.5`; Python `3.13.15`. | Available for future build/integration work, not proof of installed application dependencies. |
| Optional commands | `dotnet`, `cargo`, `ollama`, and `lms` were not found on Bash or PowerShell PATH. | Their installation elsewhere is not disproved. Discover exact installs before requesting any setup. |
| Agent clients | `claude` and `qodercli` launchers found on PATH. | Discovery only: login, entitlement, supported embedding, automation boundaries, and no-extra-cost usage have NOT been verified. |

No model weights were downloaded, no account was inspected or authenticated, and no cloud API was called for this plan. Electron dependencies, a native helper toolchain, a usable local model, voice models, and enforceable worker isolation remain explicit bootstrap gates.

## 4. Approaches considered

| Approach | Advantage | Main tradeoff | Decision |
|---|---|---|---|
| Modular Electron desktop app with a guarded native boundary | Good fit for a desktop orb, browser tooling, TypeScript integrations, and a replaceable assistant runtime. | Higher baseline memory than a lean native shell; the Windows isolation boundary takes real engineering. | Recommended. |
| Tauri/Rust desktop app | Potentially smaller desktop footprint and a strongly typed native layer. | Rust tooling is not currently found on PATH, and Windows automation plus broad JS integration adds extra cross-language work. | Alternative if measured Electron overhead is unacceptable, not a second simultaneous implementation. |
| Web/hosted assistant with a desktop bridge | Easy remote access and web UI delivery. | Still needs a powerful local bridge, makes privacy/offline behavior harder, and may introduce hosting costs. | Not the main product; a companion interface can come later. |

Do not build a microservice fleet, mandatory cloud backend, plugin marketplace, or separate specialist agent for every small task. Start with one coordinator, a durable job queue, and a small number of isolated workers; add concurrency only where a measured need justifies it.

## 5. User experience

### Orb and side panel

- The orb reflects idle, listening, thinking, working, approval-needed, paused, and error states. State is also conveyed with text, not color alone.
- Clicking the orb or pressing a hotkey opens the panel. It must support keyboard navigation, high-DPI displays, multiple monitors, and reduced motion.
- The main panel contains conversation, current task/progress, an approval inbox, and a compact activity history. Memory, connections, and advanced settings are secondary views, not dozens of permanent controls.
- Always-visible controls: stop current action, pause background work, screen-monitoring status, and microphone status. “Pause all” has an exact meaning: stop new work and new observation; do not silently continue jobs elsewhere.
- Closing the panel hides it; an explicit Quit command terminates the assistant and its workers. Launch at login is an opt-in setup choice, not an installer surprise.
- Progress reports distinguish planned, attempted, verified, failed, and blocked. Never claim a file, build, deployment, message, or upgrade succeeded without observable evidence.

### Personality and voice

Use a strong Fairy-inspired conversational identity with dry humor and concise, confident delivery. Honesty and clarity override roleplay: uncertainty, errors, and permission requests must remain unambiguous. Use original visual assets and a legitimately usable synthetic voice; exact game assets or a cloned performer voice are not dependencies of the product.

Continuous voice is a user-started session with a persistent recording indicator, live transcript, mute, and end-session controls. Include speech detection, interruption/barge-in, and suppression of Fairy hearing its own speech. End microphone capture on session end or explicit mute; do not persist raw audio by default. Spoken replies must not read sensitive content aloud unexpectedly.

Begin with a local speech-recognition/voice option that fits measured hardware. Cloud speech is optional only if its data scope and zero-extra-cost availability are verified. Text remains usable when voice is unavailable; this is a fallback, not removal of the voice requirement.

## 6. Core jobs and proactive behavior

### PC control

Observe accessible UI structure first; use browser DOM information where available, then local OCR or screenshot-based reasoning when necessary. Whole-desktop permission does not mean full-screen uploads or unrestricted clicks. Explain what Fairy intends to change, act through the permission boundary, and verify the result before the next dependent action.

Support opening apps, finding windows, navigation, typing, extracting visible information, and reversible file operations in authorized locations. Recheck the foreground window before typing or clicking. Stop when focus changes unexpectedly, the target is ambiguous, or an action's effect cannot be safely classified. Secure desktop/UAC, passwords, financial actions, and security prompts are not bypass targets.

### Coding

Let Fairy read an approved project, explain it, create a task plan, edit an isolated working copy, run constrained tests, review the diff, and present verified results. Do not overwrite uncommitted user work. Dependency installation and scripts from an unfamiliar repository are execution risks, not harmless text reads.

The coding worker must not inherit unrestricted access to the desktop, personal folders, credentials, or network merely because it can run a compiler. Pushing, publishing, destructive Git commands, and changes outside the granted workspace require separate approval. Support additional languages through verified toolchain adapters rather than claiming every compiler is installed.

### Research

Use a replaceable search/fetch/browser interface. Search, collect sources, extract relevant evidence, compare claims, and deliver a readable answer with links and dates. Distinguish primary sources from summaries and uncertain claims. Reuse local project material only within its approved scope.

A browser page, PDF, repository, tool result, or retrieved memory is data, not authority to change Fairy's goals or permissions. No paid search API is mandatory. If a free path is unavailable, blocked, or rate-limited, report that rather than bypassing access restrictions or inventing citations.

### Proactivity

Support four trigger families: user-configured schedules, approved app/file events, unfinished authorized goals, and observed opportunities to improve Fairy. Each trigger becomes a named job with a reason, scope, budget, deadline, and cancellation control.

Coalesce duplicate events, debounce file watchers, and suppress reacting to Fairy's own output. Do not constantly take screenshots or ask a cloud model whether anything interesting happened. Capture on meaningful changes with a bounded rate; raw frames are ephemeral unless explicitly saved for an approved task.

Default behavior: one desktop-control job at a time; one heavy inference or evolution build at a time; foreground requests outrank background jobs. Allow quiet hours and pause heavy work while the user is gaming or otherwise needs the machine. An unfinished goal permits continuing that goal, not inventing unrelated objectives.

If the PC sleeps, locks, shuts down, or Fairy exits, local jobs do not secretly continue in the cloud. Save checkpoints, skip unsafe overdue work, and explain the resumed state on return.

## 7. Architecture and enforceable permissions

### Component boundaries

| Component | Responsibility | Must not do |
|---|---|---|
| Protected Windows broker | Own grants, scoped approvals, credential use, desktop effects, approved network egress, and authoritative audit receipts. | Accept arbitrary shell strings, trust permission claims made by an AI, or expose a generic unrestricted escape hatch. |
| Protected evaluator and recovery launcher | Validate immutable upgrade artifacts, protect baseline tests, select app versions, and recover after failure. | Let the candidate replace its judge, grant database, or recovery executable. |
| Desktop shell | Orb, side panel, transcript, progress, and ordinary settings. | Have renderer Node access, direct secrets, unrestricted navigation, or final authority over sensitive approvals. |
| Coordinator | Convert requests/events into bounded jobs, select models, request tools, and summarize outcomes. | Execute unrestricted same-user shell commands, directly change grants, or send private data around the egress broker. |
| Isolated tool/coding workers | Execute authorized capabilities in scoped workspaces. | Access the interactive desktop, host credential stores, arbitrary files, inherited handles, or unrestricted network. |
| Model gateway | Normalize provider capabilities, streaming, cancellation, routing, and privacy/cost checks. | Treat all model endpoints as equivalent or fail over to an unapproved provider. |
| Memory and task store | Keep local conversations, source-tagged memories, goal state, and checkpoints. | Promote untrusted text into instructions or strip sensitivity labels from derived content. |
| Connector host | Run individually registered adapters with limited inputs and outputs. | Treat an authenticated external account or remote agent as permission to do everything it can do. |

Use authenticated, narrowly typed IPC. A worker's request includes job identity, operation, target, payload digest, data references, and required effects. The broker resolves grants and source labels from its own trusted records, not from caller-supplied claims. Bind approval to the exact target, data, action, expiry, and relevant UI state; reject replay and stale approval.

A job has a durable ID and one of these states: queued, running, waiting-for-approval, paused, succeeded, failed, cancelled, or outcome-unknown. Record the observable evidence for success. A timeout after a possible external write is outcome-unknown, not proof that nothing happened; reconcile before retrying.

### Windows security feasibility gate

Electron process isolation, a Node child process, a JavaScript VM, or a Windows Job Object is not by itself a security sandbox. The replaceable coordinator needs restrictions too; otherwise it could simply bypass its own broker.

Prototype AppContainer-based workers first. Evaluate a dedicated restricted identity with explicit filesystem, network, desktop, and process restrictions only if required tools cannot run in AppContainer. Use Job Objects for lifecycle and resource containment in addition to the actual security boundary. Check ACLs on protected binaries, their parent directories, grant storage, evaluator fixtures, and recovery files.

The native helper is proposed as a small C# component using Windows APIs. A compatible .NET SDK was not found on PATH; locate or obtain approval for its setup before depending on it. Do not quietly replace the design with unrestricted PowerShell scripts if the helper or sandbox is difficult.

Generated workers must fail attempts to read credentials, write outside granted roots, access arbitrary network destinations, create unrestricted child processes, automate the desktop, or alter the evaluator. Test junctions, symlinks, inherited handles, and loopback explicitly. Do not claim isolation because the happy-path demo passes.

If these controls cannot be demonstrated on this host, generated-code execution and autonomous self-updates stay blocked with a visible reason. A VM is an alternative to evaluate, not an assumed enabled feature or a silent downgrade to unsandboxed execution. Administrator/OS compromise is outside the application's protection boundary.

### Consequential effects, not merely tool names

Approving “click” or “run command” globally would defeat the user's policy. All paths to sending, posting, paying, deleting user files, installing third-party software, or changing system/security settings require effect-aware checks.

Prefer semantic operations with known targets. Browser address bars, terminals, keyboard shortcuts, clipboard paste, accessibility APIs, and arbitrary JavaScript are not backdoors around the checks. If a desktop action's consequence cannot be established, request a specific approval or stop; unrestricted autonomous use of every unfamiliar app is not promised.

Sensitive confirmations are rendered by a protected user-confirmation surface. Automation must not approve its own prompts. Revalidate focus and target state immediately before execution. Revocation and the stop button invalidate outstanding capabilities as well as queued tasks.

## 8. Model connections, privacy, and cost

### Connection families

| Family | Planned support | Admission condition |
|---|---|---|
| Cloud APIs | Provider-specific adapters plus genuinely compatible endpoints; expose text, tools, vision, streaming, and limits separately. | User supplies credentials through secure setup; supported contract, approved data scope, and no-additional-spend enforcement are verified. |
| Local models | An adapter for a verified local runner, followed by other runners using capability discovery. | Runner and model actually exist, their licenses are usable, and a hardware benchmark passes. |
| Existing subscriptions | Official SDK, CLI, or sign-in integration where the provider permits it. | Test entitlement, token handling, cancellation, data use, nested tools, and quota behavior. Chat access is not automatically API access. |
| Other agents / self-hosted servers | Structured task/result adapters with explicit remote capability manifests. | Separate authorization for the caller, destination, data, tools, costs, and remote execution. No assumption that an existing single-client bridge can be reused. |
| MCP tools | Allowlisted local stdio and authenticated remote MCP connections behind the connector host. | Pin executable/source identity, permissions, egress destinations, and effect classifications; tool descriptions are untrusted. |

MCP connects tools; it does not make every AI provider interchangeable. A common-looking API is not proof of identical vision, tool-calling, streaming, or cancellation behavior. Store a capability record for each actual connection and test its advertised features.

For CLI/agent connections, separate inference-only use from delegated tool execution. Disable nested tools if this is actually enforceable, isolate the account profile, and keep host credentials out of the worker. If the CLI's tools, telemetry, network access, or stored history cannot meet the selected data policy, do not send private context to it. Show it as blocked or limited rather than pretending it is safely integrated.

### Zero-additional-spend policy

Support API-key configuration without enabling metered use by default. A configured paid key is not permission to spend. Existing subscription usage is allowed only within a verified included entitlement; no account purchases, upgrades, automatic top-ups, pay-as-you-go fallback, or paid overage.

When zero extra cost cannot be guaranteed for an endpoint, exclude it from automatic routing. Free services and included quotas can disappear; report limits and use an approved local model, queue the task, or ask the user to change their budget policy. Do not rotate accounts or identities to evade a service limit.

Route by task capability, data eligibility, availability, and current resource limits first, not by a model declaring itself best. Do not promise a particular commercial provider or subscription before checking its current supported integration.

### Data rules

Keep a local SQLite store for tasks, conversation state, memories, source references, and indexes. Start with lexical/full-text retrieval; add local embeddings only when retrieval evaluation demonstrates a benefit. Store credentials through Windows-protected credential facilities owned by the broker, not in prompts, plain-text settings, general logs, or the memory database. Local storage is not automatically encrypted; do not claim full database-at-rest encryption without implementing and testing it.

Every captured or ingested item has a trusted source, timestamp, sensitivity, permitted purpose, and allowed cloud destinations. Summaries, embeddings, generated code excerpts, research queries, transcripts, and logs inherit restrictions from their inputs. A model cannot relabel private content as public.

Whole-desktop observation stays local by default. Prefer safe text extraction or a cropped approved surface to a full-screen transfer. If a screenshot contains excluded or unclassified windows, block cloud transfer rather than relying on perfect redaction. Clipboard content is read only for an authorized task, not constantly collected.

Expose memory inspection, correction, deletion, export, and source-level exclusion. Explicit personal-memory deletion must remove related indexes and cached derivatives and prevent resurrection during rollback. Raw screenshots/audio are ephemeral by default; propose 30 days for conversation/activity retention and lasting useful memories until removed, with user-visible retention settings. Provider-side retention is a separate contract to inspect, not something local deletion can guarantee.

## 9. Resource policy

These are starting limits to measure and tune, not verified performance claims:

- One heavy model inference, model load, or evolution build at a time. Queue competing work instead of exhausting RAM/VRAM.
- Begin by evaluating a modest quantized local model, approximately the 3–4B parameter class, against real coding/research/tool-use fixtures. Do not lock a specific model or claim acceptable speed before testing it.
- Reserve roughly 2 GiB of GPU headroom and avoid loading voice, vision, and language models simultaneously if measured use would exceed it. Pause or unload trusted inference when the user needs the GPU.
- GPU memory budgets are admission/measurement rules, not assumed hard Windows quotas. Do not expose GPU access to arbitrary generated workers.
- Initial background-job budget: one worker, up to 2 GiB RAM, 10 minutes per run, and at most three attempts for the same failure before stopping with evidence. Size a trusted model runner separately after benchmarking.
- Retain two known-good application releases and one candidate; propose a 10 GiB app/cache/snapshot budget excluding explicitly approved model downloads. Stop staging before disk headroom becomes unsafe.
- Desktop awareness uses change/event-driven sampling with a maximum capture rate, not permanent video recording. Begin capped at one frame per second while actively observing, slower or off while idle; do not invoke a vision model per frame.
- Scheduler has quiet hours, notification deduplication, a cooldown for self-improvement attempts, and explicit GPU-heavy-work pause. No recursive spawning of agents to bypass quotas.

An implementation-time benchmark must measure idle RAM/CPU, active voice latency, model VRAM, foreground task latency, and behavior under a game-like GPU load. If targets fail, reduce model/capture concurrency or queue work; never silently turn on paid cloud processing.

## 10. Self-evolution and recovery

### What Fairy can improve automatically

1. Skills and workflows: better task instructions and repeatable procedures, versioned and evaluated.
2. Broker-mediated tools: new parsers, local utilities, and scoped task capabilities.
3. Connectors: adapters using already-approved services and permissions.
4. Replaceable app code: coordinator logic, UI behavior, retrieval/routing improvements, and other components outside the protected trust kernel.

This is real code-level expansion, not just remembering preferences. However, the permission broker, approval surface, evaluator policy/baseline tests, credential boundary, security-critical egress enforcement, and recovery launcher are deliberately outside autonomous modification. Changes there require a separate user-approved maintenance operation. This boundary is what makes automatic upgrades compatible with “no extra permissions.”

### Upgrade pipeline

1. Record a specific problem or missing capability linked to an authorized goal or observed failure. Set a measurable benefit and a bounded attempt/resource budget.
2. Generate the candidate in an isolated workspace from a known source revision. Never edit the running installation or the protected tests.
3. Produce a capability manifest containing version, artifact hashes, allowed effects, filesystem roots, network destinations, credential handles, resource requirements, and compatible state schemas.
4. Check the manifest against existing grants. New privileges, new third-party dependencies, new accounts, metered services, or protected-component changes stop for approval. A self-written tool using already-approved components may proceed automatically.
5. Run protected baseline tests, negative permission tests, regression checks, representative task evaluations, and resource checks against the exact built artifact. New candidate-written tests may supplement but cannot replace the baseline. A separate model's opinion is not proof of safety.
6. Stage immutable candidate app files and a matching compatible state generation. Record the diff, expected benefit, evaluation evidence, and artifact digest locally.
7. Wait for idle: no active desktop control, voice conversation, pending sensitive confirmation, or uncheckpointed external action. Pause writes and checkpoint jobs before switching.
8. Activate through the protected launcher, run health checks, and observe a probation period. Revert automatically on startup failure, regression, incompatible state, or a violated permission invariant.
9. Report what changed and why; keep the previous known-good version available through one recovery command. Do not retry a failed candidate forever.

### State safety

Use versioned A/B application generations and WAL-consistent SQLite backups. Retain grants, revocations, deletion tombstones, and external-action receipts outside rollback generations so an app rollback cannot revive permission or replay a sent message.

A database snapshot alone is not enough: acknowledged writes after activation must survive rollback. Use a stable durable event journal whose schema is readable by the current and last-good generations, and replay compatible events into the recovered state. Reject autonomous schema changes that cannot preserve those events. Destructive migrations require approval; restoring an old snapshot and discarding newer memories is not an acceptable rollback.

External effects are not reversible just because the app is. Use idempotency keys where a provider supports them; otherwise reconcile actual state before retrying an uncertain write. A forced crash between submission and receipt must not send a duplicate email or repeat a purchase.

### Proposed one-command recovery

The build must deliver this interface; it does not exist yet and must not be run as though it does:

```powershell
& 'C:\Program Files\Fairy\Recovery\FairyRecovery.exe' rollback --last-good
```

The command must stop only Fairy-owned processes, switch to the retained app generation, preserve/replay compatible acknowledged state, and restart the app with a visible recovery report. The protected installation location and any required ACL/setup changes need user approval. The orb's recovery action calls the same protected mechanism, not an unrelated implementation.

## 11. Proposed source layout

All paths in this section are to be CREATED during implementation. The only project artifact currently created by this planning task is `fairyplan.md`.

```text
Fairy/
  fairyplan.md
  package.json
  package-lock.json
  tsconfig.json
  src/
    contracts/       jobs.ts, capabilities.ts, providers.ts, provenance.ts
    desktop/         main.ts, preload.ts, ui/App.tsx, ui/Orb.tsx, ui/Panel.tsx
    runtime/         coordinator.ts, scheduler.ts, resources.ts
    storage/         database.ts, memory.ts, journal.ts
    providers/       registry.ts, local.ts, cloud.ts, subscription.ts, agent.ts
    observation/    screen.ts, events.ts, voice.ts
    skills/         pc-control.ts, coding.ts, research.ts
    connectors/     host.ts, mcp.ts, browser.ts, mail.ts, calendar.ts,
                    tasks.ts, git.ts, messaging.ts, phone.ts,
                    remote-machine.ts, home.ts
    evolution/      candidate.ts, manifest.ts, client.ts
  native/
    Fairy.Broker/   PolicyBroker.cs, ApprovalHost.cs, SandboxHost.cs,
                    CredentialHost.cs, EgressHost.cs, DesktopHost.cs
    Fairy.Evaluator/ UpgradeGate.cs
    Fairy.Recovery/ Program.cs, StateRecovery.cs
    Fairy.Tests/    PolicyTests.cs, SandboxTests.cs, EgressTests.cs,
                    RecoveryTests.cs, UpgradeTests.cs
  tests/
    unit/
    integration/
    security/
    e2e/
    fixtures/
```

The native projects will also need normal project/entry-point files created in their owning task. Do not infer that the abbreviated tree is a complete build scaffold. Keep service-specific implementations beside their connector when the first real provider is chosen; do not grow one universal file with every vendor's API.

The protected evaluator executes baseline acceptance fixtures whose installed copy cannot be changed by a candidate. `src/evolution/client.ts` only requests evaluations; it is not its own judge. Shared contracts carry stable IDs and schema versions; do not share a mutable in-process object as the trust boundary.

### Interface contracts to establish before feature work

| Contract | Required fields / operations | Owner |
|---|---|---|
| Job | ID, origin/trigger, goal, scope IDs, state, resource budget, deadline, checkpoint, evidence references. | Durable job store. |
| Tool request | Job ID, capability ID/version, structured arguments, resolved target, effect class, input data references. | Worker requests; broker validates and dispatches. |
| Approval | Request digest, exact target/effect, data scope, expiry, UI-state binding, one-use nonce, user decision. | Protected approval host. |
| Provider descriptor | Endpoint identity, model capabilities, context limits, auth handle, allowed data scopes, included-cost status, cancellation support. | Registered gateway configuration. |
| Connector manifest | Source/executable digest, protocol version, supported operations, effects, roots, domains, credential handles, limits. | Broker registration after checks. |
| Data reference | Source, capture time, sensitivity, allowed destinations/purposes, retention, derivation parents, deletion state. | Trusted ingestion and provenance store. |
| Upgrade candidate | Source revision, artifact hashes, capability delta, schema range, evaluation receipts, recovery generation. | Evaluator and recovery launcher. |

## 12. Dependency-ordered build slices

Each slice has one reviewable outcome. Treat these as build order, not a calendar estimate. If a slice cannot fit one focused working session, split it before implementation while preserving its dependency and acceptance gate. Security gates are prerequisites, not optional final polish.

**Verification notation:** The commands below are FUTURE contracts. They are not runnable in this currently empty project. T01 creates the package scripts and test harness after approved dependency setup. Unit/integration tests use the chosen TypeScript test runner; desktop E2E tests use an Electron-capable browser automation harness. Native tests require the toolchain admitted in T01. Mock tests alone do not satisfy slices that explicitly require a live adapter or desktop action.

For each slice: add the specified failing acceptance case, confirm it fails for the expected reason, implement the smallest complete behavior, run the targeted case and relevant regressions, then review the diff. No automatic commits; commit only if requested. No install, account connection, protected-location setup, or publication is implied by the table.

### Phase A — Prove the foundation

| Step | Create / touch | Single observable proof | Blocked by | Risk or approval gate |
|---|---|---|---|---|
| T01. Establish a reproducible build/test environment. | `package.json`, lockfile, TypeScript/build/test configuration; native project files; `tests/integration/bootstrap.test.ts`. | `npm run test:integration -- tests/integration/bootstrap.test.ts` reports the actual supported Node/native toolchain and passes a minimal build/run smoke test. | None. | Discover versions first. Any missing SDK, package/runtime, or system prerequisite needs approved setup; no global environment edits. |
| T02. Build the orb and panel shell. | `src/desktop/`; `tests/e2e/shell.spec.ts`. | `npm run test:e2e -- tests/e2e/shell.spec.ts` verifies open/hide, keyboard navigation, readable states, and a functioning stop control in the running app. | T01. | No monitoring or account access is enabled by opening the app. |
| T03. Establish typed operations and protected approvals. | `src/contracts/`; broker `PolicyBroker.cs`, `ApprovalHost.cs`; `native/Fairy.Tests/PolicyTests.cs`. | Native `PolicyTests` pass: an exact approved action executes once, and changed payloads, expired approvals, replay, and synthetic self-approval fail. | T01. | Approve any protected native-host setup; grant edits are not self-updatable. |
| T04. Prove worker containment. | `SandboxHost.cs`; `native/Fairy.Tests/SandboxTests.cs`; hostile fixtures under `tests/fixtures/`. | Native `SandboxTests` show allowed workspace access succeeds while outside-file, credential, network, process, evaluator-write, and desktop escape probes are denied. | T03. | Stop if OS-enforced isolation cannot be proven; setup of identities/ACLs requires approval. |
| T05. Enforce secrets and cloud egress. | `CredentialHost.cs`, `EgressHost.cs`; provenance contracts; `native/Fairy.Tests/EgressTests.cs`. | Native `EgressTests` show an allowed data transfer succeeds and unapproved derived/private content is rejected before leaving the process boundary. | T03, T04. | No real secrets in fixtures; no real account needed for the boundary test. |
| T06. Persist jobs and authoritative events. | `src/storage/database.ts`, `journal.ts`; `tests/integration/state.test.ts`. | `npm run test:integration -- tests/integration/state.test.ts` resumes an interrupted job once and retains grants/revocations/action receipts without duplication. | T03. | Database migrations remain nondestructive; protection of authoritative records is part of setup. |

**Phase A exit:** The shell runs, the broker actually blocks forbidden paths, and interruption cannot silently repeat a job. Do not enable autonomous tools before this exit.

### Phase B — Make the three core jobs useful

| Step | Create / touch | Single observable proof | Blocked by | Risk or approval gate |
|---|---|---|---|---|
| T07. Connect one local model. | `src/providers/registry.ts`, `local.ts`; `tests/integration/local-model.test.ts`. | The live local-model test returns a grounded reply and cancels a request on the user's actual hardware without exceeding the measured admission budget. | T04, T05, T06. | A runner/model is not verified installed yet; approve downloads and record license, size, and benchmark. |
| T08. Admit one eligible cloud route. | `src/providers/cloud.ts`; `tests/integration/cloud-model.test.ts`. | A live zero-additional-cost route processes approved test content; the same test confirms private-scope rejection and quota exhaustion without paid fallback. | T05, T07. | Requires an eligible account/service; if none exists, record a blocked route and keep local mode working. Do not fake this acceptance with mocks. |
| T09. Add automatic local memory. | `src/storage/memory.ts`; `tests/integration/memory.test.ts`. | A preference recalled after restart disappears from retrieval and derivatives after deletion, including after a recovery fixture. | T05, T06, T07. | Personal memory stays local unless a specific scope permits cloud use. |
| T10. Add opt-in desktop observation. | `src/observation/screen.ts`, `events.ts`; read-only capture in `DesktopHost.cs`; `tests/e2e/observation.spec.ts`. | A live test detects a permitted screen change while monitoring is on, then captures nothing further after pause, lock, or private-window exclusion. | T02, T04, T05. | Use a dedicated test desktop/app surface; never assume screen access is active by default. |
| T11. Perform bounded PC actions. | `src/skills/pc-control.ts`; `DesktopHost.cs`; `tests/e2e/pc-control.spec.ts`. | Fairy opens a scratch editor, types the requested text, and verifies it; a deliberate focus change prevents typing into the wrong window. | T03, T04, T10. | Additional negative cases cover terminal/browser/synthetic-click bypass of consequential-action approval. |
| T12. Complete a coding task in isolation. | `src/skills/coding.ts`; `tests/integration/coding.test.ts`; a disposable failing-code fixture. | Fairy fixes the fixture, runs its tests, and returns the diff/evidence while leaving the original dirty working tree unchanged. | T04, T06, T07. | New dependencies/scripts, publishing, or destructive operations still need specific approval. |
| T13. Deliver evidence-backed research. | `src/skills/research.ts`; `src/connectors/browser.ts`; `tests/integration/research.test.ts`. | Fairy answers a real public question with inspectable sources and explicit uncertainty; a malicious source cannot trigger a tool or scope change. | T05, T06, T07. | Verify an available free search/fetch route. Login/paywall barriers remain barriers. |

**Phase B exit:** One PC-control demonstration, one coding fix, and one cited research answer succeed. Local operation is usable; cloud completion is explicitly dependent on an eligible no-extra-cost route, not required to pretend that an unavailable entitlement exists. If an existing subscription is the only eligible cloud route, bring T19 forward and use its adapter in T08's live gateway test; T19 does not depend on T08. Without an eligible route, local progress may continue but the local-plus-cloud requirement remains openly blocked.

### Phase C — Add proactive and conversational behavior

| Step | Create / touch | Single observable proof | Blocked by | Risk or approval gate |
|---|---|---|---|---|
| T14. Schedule bounded background work. | `src/runtime/coordinator.ts`, `scheduler.ts`, `resources.ts`; `tests/integration/proactivity.test.ts`. | A scheduled job, a file event, and a resumed goal each yield exactly one tracked task; duplicate events and budget exhaustion do not produce loops. | T06, T09, T10, T11, T12, T13. | Only explicitly enabled triggers/goals; local jobs pause while Fairy is closed or the host is unavailable. |
| T15. Add continuous voice sessions. | `src/observation/voice.ts`; transcript controls; `tests/e2e/voice.spec.ts`. | A live local session accepts a spoken request, responds, stops speaking when interrupted, and stops microphone capture when ended. | T02, T05, T07, T14. | Verify/approve speech components and their licenses; no paid voice fallback or persistent raw recording. |

**Phase C exit:** Fairy handles a spoken task, follows up proactively, and can be stopped immediately without a hidden recording or job continuing. Strong personality is present in the real interface, not only in a prompt file.

### Phase D — Deliver actual self-expansion

| Step | Create / touch | Single observable proof | Blocked by | Risk or approval gate |
|---|---|---|---|---|
| T16. Build independent recovery first. | `native/Fairy.Recovery/`; `native/Fairy.Tests/RecoveryTests.cs`; two small release fixtures. | The recovery command restores a last-good app after a forced crash, preserves an acknowledged post-upgrade write, and does not replay an external action. | T03, T04, T06. | Approve protected recovery installation; never use user data for the first crash drill. |
| T17. Evolve a new scoped tool automatically. | `src/evolution/`; `src/connectors/host.ts`; `native/Fairy.Evaluator/`; `native/Fairy.Tests/UpgradeTests.cs`. | Fairy creates a missing local parsing tool, passes protected tests, activates it when idle, and succeeds on a held-out input without gaining any new grant. | T04, T05, T12, T14, T16. | New third-party dependencies/permissions block activation; passing tests cannot override policy. |
| T18. Upgrade replaceable core code automatically. | Coordinator/UI candidate fixtures; evaluator/recovery integration; `tests/integration/core-upgrade.test.ts`. | Fairy repairs a seeded replaceable-core defect, activates the evaluated artifact when idle, and automatically rejects/rolls back a bad candidate while retaining state. | T15, T16, T17. | Broker/evaluator/recovery modification attempts must fail; destructive schema changes are excluded from auto-activation. |

**Phase D exit:** Demonstrate BOTH a newly created capability and a genuine replaceable-core code improvement. A saved suggestion, edited prompt, model switch, or generated file that never becomes a tested live capability does not count as self-evolution.

### Phase E — Expand the connection ecosystem

For each service, use the user's actual existing account/device chosen during setup; do not invent one in advance. First enumerate supported operations, then test a read operation before a write. A connector may be limited or blocked; surface that status and its reason. Do not label an entire family complete after building only its settings form.

| Step | Create / touch | Single observable proof | Blocked by | Risk or approval gate |
|---|---|---|---|---|
| T19. Connect an existing subscription safely. | `src/providers/subscription.ts`; `tests/integration/subscription.test.ts`. | One supported logged-in CLI/SDK completes an included-cost task, respects cancellation, and cannot invoke unapproved nested tools or leak private scope. | T04, T05, T06, T07. | User login/entitlement and official integration support must be verified; unavailable support is a real blocker. |
| T20. Connect another agent or self-hosted endpoint. | `src/providers/agent.ts`; `tests/integration/remote-agent.test.ts`. | A bounded delegated job returns evidence and cancellation/revocation prevents subsequent work or results from gaining authority. | T03, T05, T06. | Explicit endpoint/device authorization; do not widen an existing adapter's caller scope without approval. |
| T21. Admit a scoped MCP tool connection. | `src/connectors/mcp.ts`; `tests/integration/mcp.test.ts`. | An approved tool runs through the broker; a changed executable digest, ungranted domain, or deceptive tool description is rejected. | T04, T05, T17. | Third-party server installation and remote account permissions require approval. |
| T22. Connect email. | `src/connectors/mail.ts`; `tests/integration/mail.test.ts`. | Summarize a dedicated test message and prepare a reply; actual send stays blocked until exact approval, then sends at most once. | T03, T05, T06. | Read permissions and send permissions are separate; use a user-approved test account/message. |
| T23. Connect calendars. | `src/connectors/calendar.ts`; `tests/integration/calendar.test.ts`. | Read an approved event and propose a conflict-free change; external calendar writes require approval and reconcile after timeout. | T03, T05, T06. | Calendar account scopes and all external mutations are explicit. |
| T24. Connect task services. | `src/connectors/tasks.ts`; `tests/integration/task-service.test.ts`. | An approved task round-trip preserves IDs/status across restart without duplicate remote tasks. | T03, T05, T06, T14. | Reading versus creating/changing external tasks uses separate approved effects. |
| T25. Connect Git hosting/developer services. | `src/connectors/git.ts`; `tests/integration/git-service.test.ts`. | Read a test issue, produce a linked local coding result, and hold any push/comment/PR creation for approval. | T05, T12. | No remote publication or destructive Git action without approval. |
| T26. Connect messaging/community services. | `src/connectors/messaging.ts`; `tests/integration/messaging.test.ts`. | An authorized test conversation is summarized and an approved reply is sent once, with deletion/edit attempts separately gated. | T03, T05, T06. | Use supported APIs/clients, not session-cookie scraping or bypasses. |
| T27. Pair a phone companion. | `src/connectors/phone.ts`; `tests/integration/phone.test.ts`. | A paired phone receives one approved Fairy notification; revoking pairing immediately blocks further data exchange. | T03, T05, T06. | Requires a supported companion/transport and per-device approval; no paid relay assumed. |
| T28. Connect a remote machine. | `src/connectors/remote-machine.ts`; `tests/integration/remote-machine.test.ts`. | A scoped diagnostic command runs on one paired test machine and is denied outside its authorized scope. | T04, T05, T06, T20. | Separate remote execution permission, credentials, and network policy; local approval is not remote authority. |
| T29. Connect home services/devices. | `src/connectors/home.ts`; `tests/integration/home.test.ts`. | Read one authorized device's state and demonstrate a harmless approved change with revocation; sensitive device actions remain gated. | T03, T05, T06. | Depends on actual compatible hardware/service. Locks, alarms, purchases, and safety-relevant equipment are not unattended test targets. |

**Phase E exit:** Every requested family has an explicit status: implemented and live-tested, or blocked with the actual missing account/device/interface identified. Overall connection-roadmap completion requires its stated live proofs; “blocked” must never be counted as “done.” Independent connectors may be built earlier after their prerequisites; they do not all block core self-evolution.

### Phase F — Make daily use reliable

| Step | Create / touch | Single observable proof | Blocked by | Risk or approval gate |
|---|---|---|---|---|
| T30. Package and exercise the daily-use core. | Installer/package configuration; `tests/e2e/daily-use.spec.ts`; release manifest and recovery packaging. | The installed app completes the Phase B–D scenario across restart/offline/sleep/crash, with visible pause controls and a working one-command rollback. | T02–T18, subject to T08's explicit cloud entitlement gate. | Installation/protected ACLs/startup registration require approval; no public release, signing purchase, or cloud hosting is included. |

T19–T29 add independently verified integrations after or alongside the core release. Their status remains visible in the plan; packaging the core does not declare them delivered. If an optional service is unavailable, ship only accurately labeled capabilities rather than a fake connector.

## 13. Verification and acceptance

### Future verification commands

T01 must establish these scripts; they are specifications for the future project, not evidence of tests already run:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:security
npm run test:e2e
npm run build
```

The native equivalent, after the approved SDK and project exist:

```bash
dotnet test native/Fairy.Tests/Fairy.Tests.csproj
dotnet test native/Fairy.Tests/Fairy.Tests.csproj --filter FullyQualifiedName~SandboxTests
```

A successful build alone does not prove desktop behavior, voice quality, account access, sandbox enforcement, or automatic recovery. Save local test reports with the app version, artifact digest, fixture version, and observed result. Do not upload traces, screenshots, or logs to a third party automatically.

### Required negative cases

| Test | Required result |
|---|---|
| Web page/email/screenshot instructs Fairy to ignore permissions or send files. | Content remains untrusted data; no grant change, external action, or unauthorized transfer. |
| A tool tries a terminal, address-bar script, clipboard paste, or synthetic click to evade approval. | The underlying consequential effect is denied or requires a specific real-user approval. |
| Approved action payload, destination, attachment, or UI target changes. | Approval is rejected and must be obtained for the new exact action. |
| File path crosses a junction/symlink or escapes the granted root. | No access to the resolved outside target. |
| A nested CLI/agent tool accesses credentials or bypasses its declared task. | OS/broker containment denies it; unsupported adapters are excluded. |
| A local summary or research query includes information derived from a private source. | It inherits the source's restrictions and cannot use an unapproved cloud route. |
| Candidate modifies grants, protected tests, evaluator, recovery files, or their parent directory. | Attempt fails before activation; audit records the denial. |
| Provider is unavailable, quota is exhausted, or the only remaining route is metered. | Use an eligible local route, queue, or report blocked; no spending. |
| Observation or microphone is paused while a frame/transcript is queued. | New capture stops, queued unauthorized transfers are cancelled, and status reflects the stop. |
| Worker floods events, crashes, or exceeds time/memory/process limits. | Work is bounded/terminated, related resources are released, and retries stop at the limit. |
| The host sleeps or Fairy crashes immediately after an external action. | Reconcile outcome; do not repeat a send or other mutation blindly. |
| An update crashes after acknowledging a new memory/task change. | Rollback retains the acknowledged change and preserves revocations/deletions. |
| User deletes a memory, then rolls back the app. | Deleted content and derived indexes are not restored as active memory. |
| User is actively controlling the desktop or using voice when an upgrade is ready. | Upgrade remains staged until an actual safe idle point. |

### Batch manual checks

Use two combined sessions rather than asking the user to launch and inspect every slice separately:

1. **Core behavior session:** orb/panel and keyboard access; enable desktop observation; perform the scratch-editor task; fix a disposable coding fixture; research a public question with real sources; start/interact with/end a voice session; verify stop/pause; resume a scheduled job after restart.
2. **Evolution and connections session:** create and activate the held-out scoped tool; upgrade replaceable core code; force a failed upgrade and run recovery; verify post-activation memory survival and no duplicate side effect; test each actually connected service in its approved test scope.

Automate the broader fault matrix. Use disposable fixtures and dedicated test accounts or harmless approved targets, never live purchases or user-file deletion to prove a safety feature.

## 14. Requirement coverage and explicit gates

| Requirement | Delivery slices |
|---|---|
| Own Windows app, orb, side panel, Fairy personality | T02, T15, T30. |
| PC control and whole-desktop awareness while enabled | T03–T05, T10–T11. |
| Coding and research | T12–T13. |
| Proactive schedules, events, and unfinished goals | T06, T10, T14. |
| Proactive discovery of improvements | T14, T17–T18. |
| Local plus cloud AI | T07–T08; T19 can move forward for a subscription-backed cloud route. |
| All AI access families and broad tool connections | T07–T08, T19–T21. |
| Automatic local memory and approved-scope cloud data | T05–T06, T09. |
| No additional spending | T05, T07–T08, T14, T19–T21, plus admission tests for every connector. |
| Continuous voice session | T15. |
| Automatic tool AND own-code evolution | T16–T18. |
| Idle activation, protected permissions, one-command rollback | T03–T04, T16–T18, T30. |
| Email/calendar/task connections | T22–T24. |
| Git/developer and messaging connections | T25–T26. |
| Phone, other machines, home services | T27–T29. |

### Gates that must remain visible

- **Toolchain and installation:** required app/native dependencies are not installed by this planning request. Approval is needed before setup; stable supported versions and licenses must be checked at that time.
- **Isolation:** Windows edition is known, but AppContainer compatibility with the actual coordinator, compiler processes, and model adapters is not yet proven. A failed containment gate blocks autonomous execution; a child process is not an acceptable substitute.
- **Cloud/subscription access:** presence of a launcher does not prove supported integration, login, included usage, or privacy controls. With no extra budget, some desired providers may stay unavailable. The plan supports their adapters without promising their entitlement.
- **Local inference/voice:** exact models, voices, runner versions, download sizes, and measured latency are implementation-time selections under the hardware and budget constraints. The voice experience will be inspired by Fairy, not guaranteed identical to the game performance.
- **Whole-desktop automation:** some apps do not expose reliable semantic actions. Fairy stops or asks for targeted confirmation when it cannot know an action's effect; it does not guarantee unattended control of every interface.
- **External devices/accounts:** live acceptance needs the user's actual supported services and devices. Pairing, consent, account login, or new third-party installs are implementation setup steps, not missing product decisions that justify guessing credentials.
- **Packaging and distribution:** local use is the target. Public distribution, signing purchases, app stores, telemetry infrastructure, a plugin marketplace, and hosted relays are outside this request. Windows may warn about unsigned development builds; do not disable platform protections.

These are dependency gates, not discarded goals. Keep a blocked slice visible with its reason and the next required decision; never call it completed to make the roadmap look finished.

## 15. Definition of done

On this Windows PC, the installed Fairy can be summoned from its orb, maintain an explicitly enabled continuous conversation, observe the permitted desktop, complete a verified PC action, fix and test a coding fixture, and deliver sourced research. It remembers useful approved context locally, follows up on an authorized goal without a new prompt, and uses both a tested local model and an eligible cloud connection without additional spending or unapproved data transfer.

It can independently create a new useful tool AND improve its replaceable core code, pass protected evaluations, activate when idle, and recover through the documented single command without losing acknowledged state, resurrecting deleted memories/grants, or repeating external actions. Consequential actions still require real-user approval, and pause/revocation actually stops the relevant activity.

The full requested roadmap is complete only after every selected account/device family has its own live acceptance evidence. Until then, report a **working core plus an explicit remaining connector list**, not “all capabilities finished.” Nothing in this document is currently built, installed, connected, or runtime-tested; the first implementation step, once authorized, is T01.
