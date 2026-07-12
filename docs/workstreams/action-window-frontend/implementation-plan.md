# Action Window Frontend — Implementation Plan

> Consumes the shared Action Window contract (`contracts/action-window/v1/`). Does not
> redefine protocol types in `frontend/**`. Scope: UI/UX + Frontend only.

## Contract dependency (satisfied)

The shared contract is merged into `main` (PRs #212 + #214). FE consumes its actual
definitions via `src/lib/actionWindow/contract.ts` — do not duplicate:
`ActionWindowRunView`, `RunStatus`, `StepStatus`, `ExecutionMode`
(`AUTOMATIC_OPERATION` / `ACTION_WINDOW` / `FILE_IMPORT` / `INTEGRATION_PENDING`),
`BlockerCode`, `CommandType` (no `CONFIRM_STEP_COMPLETED`), `EventType`, envelopes, and the
`validate*` functions. FE affordances derive from `allowedCommands`.

Note: the contract has **no persisted `IDLE`** run status — "no active run yet" is a
UI-only scenario (the `ready-to-start` fixture has `run: null`).

## FE-1 — Review Operations mock flow (DONE)

Delivered:

- Route **`/operations`** (`pages/Operations.tsx`) + nav entry "리뷰 운영".
- `components/actionWindow/`: `OperationRunTimeline`, `HumanCheckpointCard`,
  `ActionWindowControlPanel`, `CompletedResult`.
- `lib/actionWindow/contract.ts` — single import bridge to the shared contract.
- `lib/actionWindow/copy.ts` — FE-owned copy-key registry with safe fallback; exhaustive
  command / blocker / status label maps; channel-code labels.
- `lib/actionWindow/fixtures.ts` — 12 UI scenario fixtures (11 contract-valid
  `ActionWindowRunView`, `ready-to-start` = `null`).
- `lib/actionWindow/mockAdapter.ts` — contract-backed mock adapter (fixtures + minimal
  deterministic transitions); no Bridge/Runtime.
- Tests: `copy.test.ts`, `mockAdapter.test.ts`.

Required UI scenarios (fixture names, not enums): `ready-to-start`, `starting`,
`human-action-required`, `waiting-for-user`, `observing`, `download-detected`,
`processing`, `completed`, `paused`, `ui-drift`, `login-required`, `failed`.

Acceptance criteria met:

- every fixture renders (scenario selector on the page); non-null fixtures pass the
  contract's `validateRunView` (asserted in tests);
- controls render **only** from `allowedCommands`; no unsupported button;
- `REQUEST_STEP_RECHECK` transitions to observation and **never** completes a step
  (asserted in tests);
- recoverable vs non-recoverable blockers are visually distinct;
- status conveyed by icon + label + text (not color alone); native buttons with visible
  focus rings; keyboard-operable;
- desktop is the primary surface; no real Bridge/Runtime/Chrome/Backend dependency;
- FE owns copy via the copy-key registry; unknown keys render a safe fallback;
- typecheck, tests, production build pass.

## FE-2 — Operations-agent home (DONE, mock-driven)

> Implemented in worktree `sellerops-fe3` per this plan; see `progress.md` for files
> and validation. The four pre-implementation decisions were resolved by the product
> owner: history included in v1; a just-completed run stays in the active zone until
> the next run starts; a small shared mock-state module between home and detail
> (`lib/actionWindow/operationsStore.ts`); no jsdom/RTL in this slice.

The agent-activity home a seller lands on before drilling into one run. Mock/fixture-driven
like FE-1 — FE-only, no Bridge/Runtime/Chrome/Backend, **independent of Runtime R2**
(FE-3 stays blocked on R2; FE-2 adds no transport code).

### IA decision (2026-07-09, product-owner)

- **`/operations` = operations home** (this slice takes over the route).
- **`/operations/current` = current run detail** — the FE-1 Review Operations flow moves
  here, behavior unchanged.
- Nav label stays **"리뷰 운영"** for now; "운영 에이전트" (operations-agent) wording
  appears **inside page copy only**, not in nav.
- Deep links are unparameterized (`/operations/current`); run-scoped URLs
  (`/operations/run/:runId`) are deferred to FE-3.

### Deliverables

- Home page at `/operations` with three zones:
  - **Active run summary card** — `runCopyKey` title, status badge, progress
    (`completedSteps/totalSteps`); when `WAITING_FOR_HUMAN`, a prominent attention CTA
    deep-linking to `/operations/current`. Summary + navigation only — command controls
    render **only** on the detail page (single `allowedCommands` surface).
  - **Start entry point** when no run is active (`run: null` UI-only idle), desktop-only
    per the mobile-read-only rule.
  - **Recent activity list** — read-only mock history of terminal runs (clearly demo
    data; no persistence implied).
- Route move: FE-1 page relocates to `/operations/current` (no behavior change).
- UI-only projections in `lib/actionWindow/` (e.g. `HomeView { activeRun, recentRuns }`,
  `RecentRunItem` derived from `ActionWindowRunView`) — documented UI-only;
  **no protocol type added or redefined**.
- Fixtures: home scenario set composed from the FE-1 run fixtures (generalize
  `mkRun`/`mkStep` to accept `runId`/`updatedAt` overrides): `home-empty`,
  `home-active-running`, `home-active-checkpoint`, `home-active-paused`,
  `home-completed-just-now`, `home-with-history`.
- Home mock source that serves the home fixtures and delegates `START_RUN` to the FE-1
  `applyCommand` (inherits the recheck-never-completes invariant instead of
  re-implementing it).
- Copy: home additions follow `copy.ts` patterns — Runtime-sent `copyKey`s resolve via
  `resolveCopy` with `COPY_FALLBACK`; home chrome labels ("최근 활동", empty-state text)
  are plain FE constants, never fake copy keys.
- DEV-only home scenario selector via the `devMode.ts` gate (same 🧪 dashed-panel
  pattern; absent from the production bundle).

### Acceptance criteria

- Every home fixture renders via the DEV selector; every embedded run passes the
  contract's `validateRunView` (asserted in tests).
- Home renders no command buttons except start/navigate; commands stay on the detail
  page, still rendered only from `allowedCommands`.
- The checkpoint/attention state is visually and semantically distinct (icon + label +
  text, not color alone); native buttons, visible focus rings, keyboard-operable.
- Mobile is read-only (interactive affordances `hidden sm:*`, explanatory note).
- History is presented as demo/mock; no persistence implied.
- DEV selector verified absent from the production bundle; typecheck, tests, and
  production build pass.
- No contract / `collector/**` / `backend/**` change; no transport code (R2 independence
  preserved).

### Explicitly out of scope

- New protocol/wire types (the multi-run list is a UI-only projection).
- Bridge/Runtime integration, dedupe/stale/reconnect handling (FE-3, blocked on R2).
- Real run history or persistence; concurrent active runs; commands on the home card.
- Channels beyond `esm_plus`; nav label change.

### Pre-implementation decisions (RESOLVED, product-owner)

- History **included** in v1 (mock data, read-only).
- Completed-run handoff: a just-finished run **stays in the active zone**; it moves to
  recent activity when the next run starts (store archive rule; `home-completed-just-now`
  demonstrates it).
- State sharing: a **small shared mock-state module** between home and detail
  (`operationsStore.ts` + `useOperationsStore` hook) — closer to the FE-3 adapter shape.
- **No jsdom/RTL in this slice**; tests stay node-env logic tests in the FE-1 style.

## FE-2.5 — Adapter seam + UI resilience prep (DONE, mock-driven)

> Implemented per this plan; see `progress.md` for files and validation. The open
> decisions were resolved: interface name **`ActionWindowSource`**; out-of-order policy
> **drop-until-snapshot** (no buffering); simulations reachable from **both** the home
> and detail DEV panels; **no jsdom/RTL** (tests stay node-env). Implementation
> refinements vs the plan text below: transport ordering uses the contract's
> `isOutOfOrderEvent`, and the simulated source uses `isStaleCommand` for the
> stale-command rejection; content staleness (a live run's `revision` regressing) is an
> FE-side check since the contract helpers cover commands/events, not views. The store
> never imports the simulation module — the DEV panel constructs the source and hands it
> in via a structural `SteppableSource` interface, so the production bundle carries no
> simulation code (verified by grep). `RECENT_LIMIT` became the pure, tested
> `appendRecentRun` helper in `homeFixtures.ts` (polish item 5).

FE-side preparation for FE-3, built entirely against mocks. Introduces an FE-owned
source seam behind the shared store and hardens the UI against duplicate / stale /
out-of-order / reconnect conditions using **simulated** scenarios. FE-3 (blocked on
Runtime R2) then shrinks to swapping the simulated source for a Bridge-backed one.

### Scope / non-scope

In scope (FE-owned, `frontend/**` + this workstream's docs only):

- An FE-owned source interface behind `operationsStore` (seam only, no transport).
- A fixture-backed default source preserving all FE-1/FE-2 behavior.
- A DEV-only simulated-stream source emitting contract-shaped envelopes with
  deliberate duplicate / stale / out-of-order / snapshot fault cases.
- Store resilience rules using the contract's existing validators
  (`validate*`, `isStaleCommand`, `isOutOfOrderEvent`) — consume-only.
- Safe offline / error / reconnecting UI states (FE-owned copy + fixtures).
- The bundled FE-2 polish items (below).
- Node-env tests in the existing style.

Explicitly NOT in scope:

- Runtime / Bridge / transport work of any kind; no real connectivity.
- New or changed protocol/wire types; no contract change (consume-only, as ever).
- Runtime behavior definitions — the simulated scenarios are **UI resilience
  simulations** (what FE must tolerate), not a specification of what Runtime emits.
- jsdom / React Testing Library (separate approval; tests stay node-env).
- FE-3 itself — it stays blocked on Runtime R2.

### Why this is R2-independent

Everything here is FE-side consumption discipline against the already-merged contract
surface (envelopes, `EventType`, the `validate*` functions, `isStaleCommand` /
`isOutOfOrderEvent`). No part requires a live transport: the simulated source is a
fixture. When R2 lands, FE-3 replaces the simulated source with a Bridge-backed
implementation of the same FE-owned interface; the store, resilience rules, UI states,
and tests carry over unchanged.

### Planned FE-owned source interface boundary

- `ActionWindowSource` (working name) in `lib/actionWindow/`: subscribe to view
  updates, dispatch command envelopes (`commandId` + `expectedRevision`), request a
  snapshot. An FE-owned TypeScript interface — **not** a wire protocol, never exported
  as one.
- `fixtureSource` — the default; wraps today's fixtures/mock adapter so FE-1/FE-2
  behavior and the DEV selectors keep working unchanged.
- `simulatedStreamSource` — DEV-only; emits contract-shaped envelopes including the
  fault cases below.
- `operationsStore` consumes a source; pages change only where new resilience states
  render.

### Planned simulated source scenarios (UI resilience simulations, not Runtime behavior)

- Duplicate event delivery (same `sequence` twice).
- Stale view update (lower `revision` arriving after a newer one).
- Out-of-order events (sequence gap, then backfill).
- Reconnect: a snapshot replaces the local view wholesale.
- Command rejected as stale (`expectedRevision` mismatch) → safe FE note.
- Transport loss → offline state → reconnecting → snapshot restored.

### Store resilience behaviors to test (node-env)

- Duplicate delivery is idempotent (view unchanged; no double archive).
- Stale updates never regress the rendered view.
- Out-of-order handling per the chosen policy (see open decisions) — never renders a
  regressed state.
- A snapshot replaces state cleanly (no merge artifacts).
- Command dispatch carries `commandId` + `expectedRevision`; a stale rejection surfaces
  a safe note and never mutates the view locally.
- `REQUEST_STEP_RECHECK` still never completes a step through the new seam.
- Offline/error states expose no command controls (nothing rendered beyond navigation).

### FE-2 polish items bundled (deferred to this slice; not yet implemented)

1. Wire `canStartNewRun` into `ActiveRunCard`/`OperationsHome` or drop it.
2. Terminal-run affordance on the detail page (start-new and/or link back to home).
3. Scope the shared transition note per surface (no cross-page bleed).
4. Distinct idle h1 on the detail page (e.g. "진행 중 작업") vs the home's "리뷰 운영".
5. Make `RECENT_LIMIT` reachable in tests via the simulated source (or document it as
   defensive-only).

### Acceptance criteria

- All FE-1/FE-2 behavior unchanged under the default fixture source (existing 202
  tests stay green).
- Every simulated fault scenario renders a safe, understandable state — never a raw
  code/key, never a regressed view, never a locally-completed step.
- Controls still render only from `allowedCommands`; offline/error states expose none.
- No new protocol types in `frontend/**`; contract consumed via the single bridge only.
- DEV-only simulation selector absent from the production bundle (grep check).
- Polish items 1–5 done; typecheck / tests / build pass; docs updated.

### Open decisions (before implementation)

- Source interface name/shape sign-off (`ActionWindowSource` vs alternative).
- Out-of-order policy: buffer (hold + reorder) vs drop-until-snapshot — recommend the
  simpler drop-until-snapshot unless review prefers buffering.
- Where the offline/error simulations surface in the DEV selectors (home, detail, or
  both).
- jsdom/RTL stays deferred (separate approval); resilience tests remain node-env.

### Next implementation steps

1. Product-owner sign-off on this plan entry (lands as a docs-only change).
2. Implement the polish items + source seam + fixture source (behavior-preserving
   refactor; existing tests must stay green before new features).
3. Add the simulated source, store resilience rules, offline/error UI states, tests.
4. Validate (typecheck / tests / build / bundle grep), update docs, and commit the
   whole slice once, on approval. PR/merge only after the full slice is complete and
   explicitly approved.

## FE-3 — Bridge-backed source + reconciliation (DONE)

Runtime R2 landed on `main` (Bridge transport PR #218, ratified framing in
`contracts/action-window/v1/transport.ts`), and the integration workstream also landed
FE-side code (PRs #216–217: `wsTransport.ts`, `bridgeAdapter.ts`, a `controller.ts`
hook, edits to the old FE-1 `Operations.tsx`) without updating this workstream's docs.
FE-3 therefore became a **reconciliation slice** (product-owner decisions, 2026-07-09):

- **Rebase** the unpushed branch onto the R2 `main` (`8d61d2f`); the one conflict
  (`Operations.tsx`) resolved in favor of our store-based IA.
- **Keep from main:** the transport stack — `wsTransport.ts` (Bridge-WS, opaque
  `{type:"aw", payload}` frames, `aw_resync` reconnect) and `bridgeAdapter.ts`
  (real `CommandEnvelope`s, event dedupe/ordering, highest-revision views) — plus the
  `devMode.ts` boundary (`VITE_AW_BRIDGE=1`, DEV-only, honest fallback).
- **Keep from our branch:** the IA (home `/operations` + detail `/operations/current`),
  the single state owner (`operationsStore` + `ActionWindowSource` seam), the
  resilience rules, offline/reconnecting UI, DEV fixture + simulation panels.
- **Retire from main:** `controller.ts` (duplicated the store's role; orphaned after
  the rebase).
- **New:** `bridgeSource.ts` — a thin `ActionWindowSource` over the R2 `BridgeClient`
  (frames re-sequenced locally; client owns all wire concerns), plus
  `connectBridgeIfEnabled()` (once-per-session opt-in boot; fixture source stays
  unless a live agent session actually resolves) and `useBridgeBoot()` on both pages.
  DEV panels hide while a live Bridge source is active (`sourceMode`).
- **Tests:** `bridgeSource.test.ts` (10, node-env) over the contract's
  `createLoopbackChannel` — the full FE stack below the seam, no real socket.

Acceptance: FE-1/FE-2/FE-2.5 mock behavior unchanged under the default fixture source
(all prior tests pass unmodified); no new protocol types; commands still render only
from `allowedCommands`; recheck never completes locally (Runtime verifies); production
bundle carries no DEV/simulation code. Live-agent verification (`VITE_AW_BRIDGE=1`
against a running local agent) is a separate environment-dependent follow-up.

## FE-3.5 — Connection-status callback + DEV boot retry (DONE)

Product goal: when the local SellerOps agent / Bridge connection drops or
reconnects, the Operations UI shows the existing offline/reconnecting banner and
temporarily suppresses action buttons, so the seller does not click commands while
SellerOps is not actually connected. Before this slice those UI states existed but
were reachable only through the DEV simulations — real disconnects were silent.

Delivered (FE-only; `frontend/**` + this workstream's docs):

- `wsTransport.ts`: **additive, optional** `onStatus` callback on `AwWsDeps`
  (`AwConnectionStatus = "connected" | "reconnecting" | "offline"` — same literals
  as the seam's `SourceConnection`). Fired, deduped, at: session established /
  restored → `connected`; socket drop starting the retry loop → `reconnecting`;
  retries exhausted or different-run dormancy → `offline`. Never fires after
  `close()`. **With no callback, behavior is byte-identical** — all pre-existing
  transport tests run unchanged without one.
- `devMode.ts`: `resolveBridgeSession(onStatus?)` threads the callback through the
  existing construction path (old zero-arg calls still compile).
- `bridgeSource.ts`: `notifyStatus()` forwards real transport status into the seam
  as existing `connection` frames — the store, `ConnectionBanner`, and command
  suppression react with **zero changes** (same path the simulations drive).
  `connectBridgeIfEnabled` wires the relay; teardown stops forwarding.
- DEV boot retry: `retryBridgeBoot()` + a DEV-only "🔌 로컬 에이전트 다시 연결"
  button in both pages' preview panels, visible only when bridge mode is enabled
  but the boot fell back to the fixture. Absent from the production bundle.
- Tests (node-env, +7 → 252): transport status transitions (established, drop →
  reconnecting, restore → connected, exhaustion → offline, different-run →
  offline, silent after close) and store forwarding + boot retry.

Acceptance: all 245 prior tests pass unmodified; no protocol types; production
bundle carries no DEV code (grep-verified); the "real disconnects are silent"
caveat is now closed at the FE level. Live-agent verification of the full path
remains the environment-dependent follow-up.

## FE-4 — Reconnect & recovery UX for the live Bridge connection (DONE)

Product goal: FE-3.5 made real drops *visible* (offline/reconnecting banner +
command suppression) but left the terminal `offline` state a dead end — the
transport auto-retries while it can (`reconnecting`), then gives up (`offline`),
and the seller's only recovery was a full page reload. The one manual re-attempt
(`retryBridgeBoot`) lived inside the DEV scenario panel, which both pages hide in
bridge mode — unreachable exactly when a live connection can drop. This slice adds
the recovery half.

Decisions (product-owner, 2026-07-09): scope = reconnect action + in-flight state
+ DEV return-to-fixture loop; the sanitized diagnostics/evidence readout is
deferred to a later live-agent-verification slice; **no jsdom/RTL** this slice
(tests stay node-env; the jsdom decision remains separate).

Delivered (FE-only; `frontend/**` + this workstream's docs):

- **Reconnect action on the offline banner** (`ConnectionBanner`): when the source
  is a live Bridge that has gone `offline`, the page passes `onReconnect` so the
  banner renders a "다시 연결" button (with a `🔌` glyph). It re-attempts the live
  session via `retryBridgeBoot()` — a fresh bridge world (resync from sequence 0)
  on success, or an honest fallback (banner stays offline + safe note) when the
  agent is still unreachable. Shown only on `offline` (not `reconnecting`, which
  is already auto-retrying) and only when `sourceMode === "bridge"` — never for the
  fixture/simulated offline preview. Allowed on mobile (read-only-safe recovery,
  not a run command).
- **In-flight guard**: a UI-only `retryPending` flag on `OperationsState` (NOT a
  fourth `SourceConnection` literal — those stay the stable three). `beginBridgeRetry`
  / `endBridgeRetry(succeeded)` in the store toggle it and, on failure, surface a
  safe note (`CONNECTION_RETRY_FAILED_NOTE`); the button disables + reads "다시
  연결하는 중…" while pending. The bridge import stays out of the store — the
  `useBridgeReconnect()` hook owns `retryBridgeBoot()` and drives the flag.
- **Offline copy correction**: the offline body no longer promises an automatic
  retry (it is the terminal state); recovery is the manual action.
- **DEV return-to-fixture**: a DEV-only strip (`isFixturePreviewEnabled() &&
  sourceMode === "bridge"`, absent from the production bundle) with a "픽스처로
  돌아가기 (개발용)" button (`returnToFixtureForDev()`), so a dev can drive the
  whole loop — fixture → live → drop → offline → reconnect / return — without a
  reload. The FE-3.5 boot-retry button is **kept** (it covers the distinct
  boot-fell-back case, `sourceMode === "fixture"`; the two never show together).
- Tests (node-env, +5 → 257): copy action/pending/failure strings; store
  `retryPending` transitions + `returnToFixtureForDev`; `bridgeSource` offline →
  fresh re-adopt resyncs from zero and closes the dead source.

Acceptance: all 252 prior tests pass unmodified; no protocol types; connection
literals unchanged; production bundle carries no DEV code (grep-verified — the new
"픽스처로 돌아가기"/"라이브 연결 중"/"개발용" strings → 0; user-facing "다시 연결"
copy present; `VITE_AW_BRIDGE` compiled away). Live-agent verification now also
covers the manual reconnect path; it remains the environment-dependent follow-up.

## FE-5 — Sanitized live-bridge diagnostics for verification (DONE)

Product goal: when we later run a real paired local agent, the Operations screen
should let us confirm at a glance whether it is **truly using the live Bridge** or
has quietly fallen back to the fixture source — today the two look nearly identical
on screen. This slice adds a **DEV-only, bridge-mode-only** sanitized diagnostics
panel that states the source mode, connection state, whether a live boot was
attempted, the last safe connection transition, and whether a reconnect is pending.

Decisions (product-owner, 2026-07-11): **gating = bridge-mode only** (rendered only
when `isFixturePreviewEnabled() && isBridgeModeEnabled()`, so it appears in both the
bridge-live and the bridge-fallback states but never in the plain fixture-demo dev
view or the production build); include revision (plain int), the channel **display
label** only, and a run-bound boolean; **no jsdom/RTL** (tests stay node-env).

Delivered (FE-only; `frontend/**` + this workstream's docs):

- **Pure formatter** `lib/actionWindow/diagnostics.ts` — `describeBridgeDiagnostics`
  takes explicit sanitized primitives (source mode, connection literal, booleans, a
  plain integer revision, an already-resolved channel label) and returns a verdict
  (`live` / `fixture-fallback` / `fixture-demo`) plus labelled rows. It **never
  receives the raw `ActionWindowRunView`**, so it structurally cannot reach a runId,
  raw channelCode, URL, token, or wire frame. Every value is drawn from a bounded
  vocabulary (the three connection literals, the two source-mode literals, 예/아니오,
  integers, "—", and the channel label).
- **Component** `components/actionWindow/BridgeDiagnostics.tsx` — dashed DEV panel
  reused on both pages, rendered only inside the page-level bridge-mode dead-branch
  gate (same tree-shaking pattern as `SimulationPreview`).
- **Store** `operationsStore.ts` — a **timestamp-free** `connectionTrail`
  (capped at 6, only the three connection literals — no timing, no ids) and a
  `connectionChangeCount`; both updated on an actual connection transition (a
  repeated same-state frame is not counted) and reset to a fresh connected session
  whenever the world is replaced (adopt / fixture load / simulation / reset). The
  store still imports **no** bridge transport module.
- **Getter** `bridgeSource.ts` `isBridgeBootAttempted()` — read-only view of the
  once-per-session boot flag, so the panel distinguishes "never tried" from "tried
  and fell back".
- **Pages** — `Operations.tsx` + `OperationsHome.tsx` render the panel in the DEV
  bridge-mode area (visible in both bridge-live and fixture-fallback).
- **Tests** (node-env, +14 → 271): `diagnostics.test.ts` (verdict logic, field
  formatting, last-transition rendering, dash for empty run fields, channel label
  not raw code, a **leak-guard** asserting no field exposes a raw id/url/token/wire
  frame, and a bounded-vocabulary assertion); `operationsStore.test.ts` (trail +
  counter transitions, same-state not counted, cap enforced, reset on world switch).

Never shown (privacy invariant, enforced by the primitives-only formatter and the
leak-guard test): raw runId, raw channelCode, tokens, tickets, URLs/host/port, raw
WS frames/payloads, account ids, selectors, CDP ids, cookies, secrets, local paths,
timestamps, or elapsed durations.

Acceptance: all 257 prior tests pass unmodified; no protocol types; connection
literals unchanged; production bundle carries no DEV/diagnostics code (grep-verified
— "브리지 진단"/"소스 모드"/"라이브 브리지 사용 중"/"부트 시도됨"/… → 0;
`VITE_AW_BRIDGE` compiled away; user-facing resilience copy still present). The
`esm_plus`/`run_demo_esm` strings that remain in the bundle are the **pre-existing
fixture demo data** (the default fixture source ships the demo run) — unchanged by
this slice and not emitted by the tree-shaken diagnostics module. Live-agent
verification (`VITE_AW_BRIDGE=1` against a running paired agent — now confirming the
LIVE vs FIXTURE FALLBACK verdict directly) remains the environment-dependent
follow-up.

## FE-6 — DOM/a11y component tests (DONE)

Product goal: FE-3.5 → FE-5 added the first genuinely **DOM-interactive,
accessibility-bearing** surfaces — the FE-4 manual **reconnect** button, the offline
banner's `role="status"` live region + `aria-busy` state, the checkpoint/control
command buttons rendered from `allowedCommands`, and the FE-5 diagnostics
`<section aria-label>`/`<dl>`. The node-env suite proves the store/formatter logic but
**never renders the button, clicks it, or asserts the aria structure** — a broken
`onReconnect`, a lost `role="status"`, or a regressed `<dl>` would pass every test.
This slice resolves the long-deferred jsdom/RTL question by adding component-level
DOM/a11y tests over exactly those surfaces.

Decisions (product-owner, 2026-07-11): **adopt now**, minimally and additively.
**Component-only** scope (the four new-surface components; **no** page-through-store
integration tests). **Hand-rolled role/aria assertions** (Testing Library queries;
**no** jest-axe). jsdom is opted into **per-file** via a `// @vitest-environment jsdom`
pragma, so the default stays node and every existing `*.test.ts` is untouched.

Delivered (FE-only; `frontend/**` + this workstream's docs):

- **DevDeps** (the sole dependency change): `jsdom`, `@testing-library/react`,
  `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/user-event`
  — devDependencies only; runtime `dependencies` and `scripts` unchanged.
- **Harness** — `vitest.config.ts` `include` broadened to `src/**/*.test.{ts,tsx}` and
  a `setupFiles: ["src/test/setup.ts"]` (jest-dom matchers + explicit RTL
  `afterEach(cleanup)`, since `globals` stays `false`). No global `environment` set;
  the jsdom env is per-`.test.tsx` only.
- **Tests** (jsdom, +23 → 294), all `*.test.tsx` under `components/actionWindow/`:
  - `ConnectionBanner.test.tsx` (8) — null render when connected; `role="status"` for
    reconnecting/offline; reconnect-button presence matrix (offline + `onReconnect`
    only; absent for reconnecting and for offline without a handler); `disabled` +
    `aria-busy` under `retryPending`; a click fires `onReconnect` once; a disabled
    button does not.
  - `ActionWindowControlPanel.test.tsx` (4) — one button per `allowedCommand` with the
    right accessible name (`commandLabel`); empty-state copy + no buttons when none;
    click dispatches the exact `CommandType`.
  - `HumanCheckpointCard.test.tsx` (6) — labelled section + heading; recheck/manual
    buttons gated by `allowedCommands`; per-button `CommandType` dispatch; conditional
    blocker `role="status"` with recoverable vs non-recoverable copy.
  - `BridgeDiagnostics.test.tsx` (5) — DOM structure only (the two env helpers are
    mocked to drive the verdict): labelled `<section>` + a 10-row `<dl>`; the three
    verdict labels (live / fixture-fallback / fixture-demo); channel **display label**
    in the DOM, never the raw code. Verdict logic + the leak-guard stay in the node-env
    `diagnostics.test.ts` (no duplication).

Acceptance: all 271 prior node-env tests pass unmodified (still node env — no pragma
added to any `*.test.ts`); typecheck + build clean; production bundle unchanged
(no component source touched) — diagnostics-unique DEV labels still grep to 0, no
test/vitest/testing-library token leaks into `dist`, user-facing resilience copy
(`다시 연결`) still ships. Deliberately deferred (named, not started): page-level
integration tests through the store; jest-axe automated a11y scanning; a frontend CI
workflow to run these on PRs; live-agent verification.

## FE-7 — page-level DOM integration tests (DONE)

Product goal: FE-6 covered the components in isolation (hand-fed props); nothing
covered the **wiring between the shared store and the rendered pages**. This is the
seam that breaks silently — a component can be correct while a page forgets to pass
`connection`, drops the `sourceMode === "bridge" ? reconnect : undefined` gate, or
renders a command control that should be hidden while offline. FE-7 adds page-level DOM
integration tests that drive the real `operationsStore` through its public API and
assert store-state → rendered-page wiring (offline banner, reconnect action, suppressed
commands, diagnostics entry point), **not** every visual detail (that stays in FE-6 /
node-env).

Decisions (product-owner, 2026-07-11): **implement now**; **page-level integration
tests only**; **zero new dependencies and zero config changes** (jsdom/RTL from FE-6;
`MemoryRouter` from the existing `react-router-dom`; the `include` glob already matches
`*.test.tsx`). **Mock the `devMode` boundary to a production-shaped page** by default
(the diagnostics-entry tests flip bridge-mode on); **add a shared test-helper module**.
No jest-axe, no FE CI, no live-agent verification, no source change.

Delivered (FE-only; `frontend/**` + this workstream's docs):

- **Shared helpers** `src/test/renderWithRouter.tsx` (a `MemoryRouter` wrapper — the
  pages need a Router only for `<Link>`; no route config, no navigation mocking) and
  `src/test/opsStoreHarness.ts` (`resetOps` / `seedRun` / `seedHome` / `seedBridge` /
  `seedBridgeRun`, plus the `controllableSource()` pattern lifted from
  `operationsStore.test.ts`) — thin seams over the **real** store API, never a mocked
  store.
- **Boundary mocks** (per page-test file, `importOriginal` spread): `devMode` overrides
  `isFixturePreviewEnabled` / `isBridgeModeEnabled` (default both `false`, so the DEV
  demo nav does not render — vitest sets `import.meta.env.DEV = true`); `bridgeSource`
  overrides `connectBridgeIfEnabled` / `retryBridgeBoot` / `isBridgeBootAttempted` so
  the `useBridgeBoot` mount effect and the reconnect click never touch a real transport
  (jsdom has no WebSocket). Nothing deeper is mocked.
- **Tests** (jsdom, +14 → 308), colocated `*.test.tsx`:
  - `pages/Operations.test.tsx` (9) — production-shaped by default (no DEV nav);
    connected `WAITING_FOR_HUMAN` → checkpoint + controls + timeline, no banner;
    connected idle → start region; **offline** (bridge + last-known run) → offline
    banner + reconnect button, commands suppressed, timeline stays; **reconnecting** →
    banner, no reconnect button, commands suppressed; reconnect click → invokes the
    (mocked) bridge boundary only, no real transport; diagnostics entry point renders in
    bridge-live and fixture-fallback, absent when bridge mode is off.
  - `pages/OperationsHome.test.tsx` (5) — empty → start region + recent-activity empty
    message; active checkpoint → active-run card + detail `<Link>` + populated recent
    list; offline → banner + reconnect, start affordance suppressed; diagnostics entry
    point on/off.
- **Assertion discipline** (avoid brittle coupling): query by `role`/accessible-name
  (`getByRole("region",{name})`) with a few stable FE copy strings for banner identity;
  `MemoryRouter` only (no navigation assertions); the store is driven, never mocked. The
  banner is matched by its FE copy (`CONNECTION_VIEW.*.title`) because `RunStatusBadge`
  also uses `role="status"`.

Acceptance: all 294 prior tests pass unmodified; **no dependency, config, or component
source change**; typecheck + build clean; production bundle **byte-identical** to the
FE-6 baseline (`index-DgRPaagd.css` 20.67 kB / `index-CDKl4_D3.js` 347.98 kB — same
hashes) — a stray `.table` utility that Tailwind's `src/**/*.{ts,tsx}` content scan had
extracted from the word "table" in a helper comment was removed, so the test files leak
nothing into `dist`. Deliberately deferred (named, not started): jest-axe automated a11y
scanning; a frontend CI workflow; live-agent verification.

## FE-8 — frontend CI workflow (DONE)

Product goal: FE-6/FE-7 added real frontend test coverage, but it only ran **locally** —
the repo had **no CI of any kind** (no `.github/`), so a PR could regress typecheck, the
308-test suite, or the build and still merge green. FE-8 adds a minimal GitHub Actions
workflow that runs the frontend `typecheck` + `test` + `build` on every PR, so the safety
net is enforced automatically and can be made a required status check.

Decisions (product-owner, 2026-07-12): **PR-only** trigger (`pull_request` → `main`; no
`push`); **path-filtered** to `frontend/**` + `contracts/action-window/v1/**` + the
workflow file; **frontend-only** scope (collector/backend are separate packages → their
own future workflows); Node **20**; no `frontend/**` source/config change, no new
dependency.

Delivered (`.github/**` + this workstream's docs):

- **Workflow** `.github/workflows/frontend-ci.yml` — one job on `ubuntu-latest`,
  `defaults.run.working-directory: frontend`, `permissions: contents: read`, and
  `concurrency` cancel-in-progress per PR ref. Steps: `actions/checkout@v4` →
  `actions/setup-node@v4` (`node-version: '20'`, `cache: 'npm'`,
  `cache-dependency-path: frontend/package-lock.json`) → `npm ci` → `npm run typecheck` →
  `npm test` → `npm run build`. Three explicit steps give an independent signal per stage.
- **Path filter includes `contracts/action-window/v1/**`** because the frontend consumes
  the contract via `frontend/src/lib/actionWindow/contract.ts`
  (`export * from "../../../../contracts/action-window/v1/index"` + `/transport`) — the
  only cross-dir import the frontend has — so a contract change re-runs this check.

Acceptance: greenfield CI (no prior workflow); the workflow YAML parses; the exact
commands it runs pass on a clean install (`npm ci && npm run typecheck && npm test &&
npm run build` — 308 tests, build byte-identical); no `frontend/**` source/config,
dependency, or lockfile change; scope limited to `.github/**` + these docs. Live
confirmation lands on the first frontend PR. Deferred (named, not started): making
`frontend` a **required** status check (repo settings); `collector`/`backend` CI;
jest-axe; live-agent verification.

## FE-9 — jest-axe a11y scanning (Operations pages) (DONE)

Product goal: FE-6/FE-7 encode a strong a11y baseline through role + accessible-name
queries (`getByRole(..., { name })`, `aria-*` asserts), but those queries only check what
the author explicitly wrote. `jest-axe` runs the axe-core rule engine over the rendered
DOM and automatically catches the structural/ARIA class the queries never assert — invalid
or duplicate ARIA, duplicate `id`s, unlabeled controls, roles missing required states,
heading/list structure — on the two highest-value surfaces.

Decisions (product-owner, 2026-07-12): **adopt now**, scoped to the **two Operations
pages** (`Operations` + `OperationsHome`) across their already-seeded rendered states;
axe assertions live in **dedicated `*.a11y.test.tsx` files** (kept separate from the FE-7
pure DOM-integration tests); FE-6 component scans **deferred**. A shared helper asserts on
`results.violations` directly rather than `expect.extend`-ing jest-axe's matcher, so
`vitest.config.ts` / `setup.ts` are untouched (`globals: false` matcher-typing friction
avoided). Three rules are disabled with rationale: `region` and `landmark-one-main`
(pages render as a body fragment — `AppShell` owns `<main>`/nav in the real app, so
landmark rules false-positive on the isolated fragment) and `color-contrast` (jsdom never
lays out or paints, so contrast can't be computed). Every other rule stays on.

Dependencies (in-scope for this slice): `jest-axe ^10.0.0` (brings `axe-core 4.10.2`
transitively) **plus** `@types/jest-axe ^3.5.9` — the planned assumption that jest-axe
ships its own types was wrong (v10 ships no `.d.ts`), so the types-only devDep was added.
Both are test-tooling, never in the shipped bundle.

Delivered (`frontend/**` tests + this workstream's docs):

- **`frontend/src/test/axe.ts`** — shared `AXE_OPTIONS` (the three disabled rules, with the
  jsdom/AppShell rationale) + `expectNoAxeViolations(container)`, which fails with a
  readable rule-by-rule summary (`id [impact] help (N nodes)`).
- **`frontend/src/pages/Operations.a11y.test.tsx`** (5 scans) — connected checkpoint;
  connected idle; offline; reconnecting; diagnostics-entry world.
- **`frontend/src/pages/OperationsHome.a11y.test.tsx`** (4 scans) — empty; active
  checkpoint; offline; diagnostics-entry world. Both reuse the existing `renderWithRouter`
  + `opsStoreHarness` harness and mirror the FE-7 boundary mocks (`devMode` production-
  shaped, `bridgeSource` off the wire) — one `axe()` per distinct rendered state, no new
  infrastructure.

Acceptance: `npm run typecheck` clean; `npm test` — **317 passed** (308 prior + 9 new
scans), 29 files; `npm run build` passes, production bundle **byte-identical**
(`index-DgRPaagd.css` 20.67 kB / `index-CDKl4_D3.js` 347.98 kB — test files add nothing to
`dist`); `git diff --check` clean. The scans run under the existing `npm test`, so the
FE-8 CI enforces them with **no CI change**. Axe was proven to actually fire via a
throwaway `image-alt` violation (detected, then reverted). Honest ceiling: this is a
structural/ARIA net, **not** a full WCAG audit — no contrast, no real focus-visibility.
Deferred (named, not started): axe scans of the FE-6 components / other pages;
full-document scans rendering pages inside `AppShell` (re-enables landmark/region rules);
contrast/visual a11y via a real browser (Playwright axe).
