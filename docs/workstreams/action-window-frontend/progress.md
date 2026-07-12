# Action Window Frontend — Progress (session handoff)

> Update this document before stopping in every FE task.

- **Workstream:** UI/UX + Frontend
- **Status:** **FE-1 MERGED (PR #215). FE-2 + FE-2.5 + FE-3 MERGED into `main`
  via PR #223 (merge `6ed03f2`, 2026-07-09): FE-2 `9f656ca`, FE-2.5 `5d54dee`,
  FE-3 `39d885b`, docs sync `cce9547`. FE-3.5 (connection-status callback + DEV
  boot retry) `aa8ff3c`, FE-4 (reconnect & recovery UX) `82b50bd`, and FE-5
  (sanitized live-bridge diagnostics) `68c7b11` MERGED into `main` via PR #226
  (merge `74d0b37`, 2026-07-11). FE-6 (DOM/a11y component tests — jsdom + RTL
  adopted) MERGED into `main` via PR #228 (merge `e1d3c40`, 2026-07-11). FE-7
  (page-level DOM integration tests) `849f690` MERGED into `main` via PR #230
  (merge `9958197`, 2026-07-11; 308 tests). FE-8 (frontend CI workflow —
  typecheck/test/build on PRs) IMPLEMENTED (this slice, uncommitted on
  `chore/frontend-ci-plan`). Remaining follow-ups: live-agent verification;
  jest-axe.**

## Base

- **Worktree:** `/Users/taewookang/Downloads/workspace/sellerops-fe3`
- **Branch:** `feat/action-window-connection-status` (FE-3.5 `c4b98d5` + FE-4
  `4807600` committed; FE-5 uncommitted), branched off the merged tip `6ed03f2`.
  Earlier FE-2/2.5/3 work
  was on `feat/action-window-fe3`, rebased 2026-07-09 onto `origin/main`
  `8d61d2f` (Runtime R2 Bridge transport PR #218, FE/Runtime integration PRs
  #216–217, run persistence #219, R4 prep #220–221), then a final conflict-free
  rebase onto `f0d57f4` (PR #222, collector/runtime-docs only) before push.
- **Commits (current hashes):** FE-2 `9f656ca`, FE-2.5 `5d54dee`, FE-3 `39d885b`.
  (Earlier hashes across the two rebases: `a7a43f4`/`7dd97fb` → `d08ef4f`/`ead80ac`.)
  One rebase conflict (`pages/Operations.tsx`, both lines rewrote the FE-1 page)
  resolved in favor of our store-based version per product decision.
- **This slice (uncommitted, on `feat/action-window-connection-status` at
  `4807600`):** FE-5 sanitized live-bridge diagnostics (`frontend/**`) + workstream
  docs. FE-3.5 (`c4b98d5`) and FE-4 (`4807600`) are committed (not pushed).

## Gate check

- Integration PR #209 merged into `main`: ✅
- Shared Action Window contract merged (`contracts/action-window/v1/`, PRs #212 + #214): ✅
- FE branch based on the merged contract commit: ✅ (`6440cfb`)
- FE-1 (Review Operations mock flow) merged: ✅ (PR #215)
- FE-2 gates (FE-1 merged + contract merged) satisfied; plan entry added and
  implemented (mock-driven, R2-independent): ✅ (committed `9f656ca`)
- FE-2.5 (adapter seam + UI resilience prep) planned and implemented: ✅ (committed
  `5d54dee`; mock/simulated only, R2-independent)
- Runtime R2 (AW transport over Bridge v1) merged into `main`: ✅ (PR #218 + the
  ratified transport framing in `contracts/action-window/v1/transport.ts`)
- FE-3 (Bridge-backed source) implemented: ✅ (committed `39d885b`; merged via
  PR #223, merge `6ed03f2`)

## FE-3 readiness re-audit (2026-07-09, on `main` `8d61d2f`) — READY

All three seams now exist, verified from `frontend/**` on `main` (FE-side consumers):
**event delivery** (`aw_event`/`aw_view` frames over `/bridge/ws`, nested opaque in
Bridge v1), **command transport** (`CommandEnvelope` via `aw_command`, acked by
`aw_command_result`), **reconnect restore** (`aw_resync`/`aw_resync_result` — replay
from sequence 0, idempotent dedupe; snapshot-equivalent). NOTE: the integration
workstream (PRs #216–218) also landed FE code (`wsTransport`, `bridgeAdapter`, a
`controller.ts` hook, edits to the old FE-1 `Operations.tsx`) **without updating this
workstream's docs** — reconciled in this slice per product decisions (see below).

## Original FE-3 readiness audit (2026-07-09, on `main` `6440cfb`) — superseded

**Verdict: NOT READY — FE-3 blocked on Runtime R2 (real Bridge transport).** Runtime R1
(PR #213, `collector/src/action-window/*`) proves a synthetic loop in-process only; its own
docs state *"Real Bridge transport of these messages is R2"* and *"No … Bridge transport …
yet"* (`docs/action-window-runtime/{current-state,contract-boundary}.md`).

Per-seam (verified against code, read-only):

| Seam | Status | Evidence |
|---|---|---|
| Contract-valid `ActionWindowRunView` | ✅ available | `collector/src/action-window/view.ts` `projectRunView` → `ActionWindowRunView`; verified by `engine.test.ts` |
| Sanitized payloads | ✅ available | view projects sanitized view + blocker codes; `contract-boundary.md` §3/§4; `validateRunView` enforces |
| Revision/sequence handling (runtime-side) | ⚠️ partial | engine emits ordered `sequence`/`revision`, idempotent replay, stale-revision rejection; contract has `isStaleCommand`/`isOutOfOrderEvent` — but **no delivered stream** for FE to apply them to |
| **Bridge delivery of run updates** | ❌ missing (R2) | Bridge `ServerMessage`/`BridgeEventCategory` (`collector/src/bridge/protocol.ts`) has **no Action Window category/payload**; engine writes to an `InMemoryEventSink`; no engine→Bridge send path |
| **Command transport** | ❌ missing (R2) | Bridge `ClientMessage` = `{request_snapshot \| ping}` only — no command envelope (`START_RUN`/`REQUEST_STEP_RECHECK`/…); engine `apply()` is called in-process, not over the wire |
| **Reconnect snapshot** | ❌ missing (R2) | Bridge has a generic `snapshot`/`request_snapshot` transport, but carries `BridgeSnapshot` (pairing/status), **not** an Action Window snapshot; the engine's `EngineSnapshot` is in-process, not a wire reconnect snapshot |

**Consequence:** a real Bridge-backed FE adapter has nothing to consume — no Action Window
Bridge event category, no command message type, no AW reconnect snapshot. FE-3 is not
implemented; FE-1's mock adapter remains the only Action Window adapter.

**Unblock condition:** Runtime R2 must add the nested Action Window transport over Bridge v1
(AW event delivery, AW command message, AW snapshot-on-connect). Only then does FE-3 (real
adapter + mock/real boundary + dedupe/stale protection + reconnect snapshot handling + safe
offline/error state) become implementable.

## Completed (this session)

FE-8 frontend CI workflow (one FE slice, uncommitted):

- Product gap closed: FE-6/FE-7 test coverage only ran **locally** — the repo had **no
  CI at all** (no `.github/`), so a PR could regress typecheck, the 308-test suite, or
  the build and still merge green. FE-8 adds a minimal GitHub Actions workflow that runs
  the frontend typecheck/test/build on every PR, so the safety net is enforced
  automatically (and can be made a required status check).
- **Decisions** (product-owner, 2026-07-12): PR-only trigger (`pull_request` → `main`,
  no `push`); path-filtered to `frontend/**` + `contracts/action-window/v1/**` + the
  workflow file; frontend-only scope (collector/backend get their own future workflows);
  Node 20; no `frontend/**` source/config change, no new dependency.
- **Workflow** `.github/workflows/frontend-ci.yml`: one `ubuntu-latest` job,
  `working-directory: frontend`, `permissions: contents: read`, `concurrency`
  cancel-in-progress per PR ref; `checkout@v4` → `setup-node@v4` (Node 20, npm cache on
  `frontend/package-lock.json`) → `npm ci` → `npm run typecheck` → `npm test` →
  `npm run build`. The `contracts/action-window/v1/**` path entry is included because the
  frontend imports the contract via `src/lib/actionWindow/contract.ts`
  (`../../../../contracts/action-window/v1`) — the only cross-dir import it has.
- Verification: YAML parses; the exact CI commands pass on a clean install (`npm ci` →
  308 tests → build byte-identical); no frontend source/config/dependency/lockfile change;
  scope limited to `.github/**` + these docs; `git diff --check` clean.
- Docs: FE-8 plan entry; this handoff; the "frontend CI workflow" open question resolved.

FE-7 page-level DOM integration tests (one FE slice, MERGED via PR #230):

- Product gap closed: FE-6 proved the components in isolation, but nothing verified the
  **store → page wiring** — that when `operationsStore` reports `offline`, the pages
  actually render the offline banner, expose the reconnect action, **suppress** the
  command controls, and (in bridge mode) surface the diagnostics entry point; and show
  the checkpoint / active-run / start affordances in the connected states. FE-7 drives
  the real store through its public API and asserts what the pages render.
- **Decisions** (product-owner, 2026-07-11): implement now; page-level integration
  tests only; **zero new deps, zero config change** (jsdom/RTL from FE-6; `MemoryRouter`
  from the existing `react-router-dom`; `include` already matches `*.test.tsx`); mock
  the `devMode` boundary to a production-shaped page by default (bridge-mode flipped on
  for the diagnostics-entry tests); add a shared test-helper module. No jest-axe, no FE
  CI, no live-agent verification, no source change.
- **Helpers** `src/test/renderWithRouter.tsx` (a `MemoryRouter` wrapper — no route
  config, no navigation mocking) + `src/test/opsStoreHarness.ts` (`resetOps` / `seedRun`
  / `seedHome` / `seedBridge` / `seedBridgeRun` + `controllableSource`) — thin seams
  over the **real** store API, never a mocked store.
- **Boundary mocks** (`importOriginal` spread, per page-test file): `devMode`
  (`isFixturePreviewEnabled` / `isBridgeModeEnabled` default false → no DEV demo nav)
  and `bridgeSource` (`connectBridgeIfEnabled` / `retryBridgeBoot` /
  `isBridgeBootAttempted` → no real WebSocket from the mount boot or reconnect click).
- Tests (jsdom, +14 → 308): `pages/Operations.test.tsx` (9 — production-shaped default;
  connected checkpoint+controls+timeline; idle start; **offline** → banner + reconnect,
  commands suppressed, timeline stays; **reconnecting** → banner, no reconnect button,
  commands suppressed; reconnect click → mocked bridge boundary only; diagnostics entry
  point on/off) and `pages/OperationsHome.test.tsx` (5 — empty → start + empty recent;
  active → active-run card + detail link + populated recent; offline → banner+reconnect,
  start suppressed; diagnostics on/off).
- Verification: 294 prior tests pass unmodified; typecheck + build clean; production
  bundle **byte-identical** to the FE-6 baseline (removed a stray `.table` utility that
  Tailwind's content scan had pulled from the word "table" in a helper comment, so the
  test files leak nothing into `dist`).
- Docs: FE-7 plan entry; this handoff; the "page-level integration tests" open question
  resolved; Accessibility notes updated.

FE-6 DOM/a11y component tests — jsdom + RTL adopted (one FE slice, MERGED via PR #228):

- Product gap closed: FE-3.5 → FE-5 shipped the app's first DOM-interactive,
  aria-bearing surfaces (the reconnect button, the `role="status"` offline banner,
  the `allowedCommands` command buttons, the diagnostics `<section>`/`<dl>`), but the
  node-env suite never rendered or clicked any of them — a broken `onReconnect` or a
  lost `role="status"` would have passed every test. FE-6 resolves the long-deferred
  jsdom/RTL question with component-level DOM/a11y tests over exactly those surfaces.
- **Decisions** (product-owner, 2026-07-11): adopt now, additively; **component-only**
  (no page-through-store integration tests); **hand-rolled role/aria assertions**
  (no jest-axe); jsdom opted in **per-file** via `// @vitest-environment jsdom` so the
  default env stays node and every existing `*.test.ts` is unchanged.
- **DevDeps** (the only dependency change): `jsdom`, `@testing-library/react`,
  `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/user-event`
  — devDependencies only; runtime `dependencies` and `scripts` untouched.
- **Harness**: `vitest.config.ts` `include` → `src/**/*.test.{ts,tsx}`; new
  `src/test/setup.ts` (jest-dom matchers + explicit RTL `afterEach(cleanup)`, since
  `globals` stays `false`). No global `environment` — jsdom is per-`.test.tsx` only.
- Tests (jsdom, +23 → 294): `ConnectionBanner.test.tsx` (8 — null-when-connected,
  `role="status"`, reconnect-button presence matrix, `disabled`/`aria-busy` under
  `retryPending`, click fires/doesn't-fire `onReconnect`); `ActionWindowControlPanel`
  (4 — button-per-`allowedCommand`, accessible names, empty state, `CommandType`
  dispatch); `HumanCheckpointCard` (6 — labelled section, gated recheck/manual
  buttons, per-button dispatch, blocker `role="status"` recoverable vs not);
  `BridgeDiagnostics` (5 — DOM structure only, env helpers mocked: labelled section +
  10-row `<dl>`, the three verdict labels, channel **display label** never the raw
  code; verdict logic + leak-guard stay in node-env `diagnostics.test.ts`).
- Verification: 271 prior node-env tests pass unmodified; typecheck + build clean;
  bundle unchanged (no source touched) — diagnostics DEV labels still grep to 0, no
  test/vitest/testing-library tokens in `dist`, resilience copy (`다시 연결`) ships.
- Docs: FE-6 plan entry; this handoff; Open-question jsdom/RTL bullet resolved;
  Accessibility notes updated (jsdom now available).

FE-5 Sanitized live-bridge diagnostics for verification (one FE slice, uncommitted):

- Product gap closed: with a real paired agent later, the live-Bridge screen and the
  fixture fallback look nearly identical — there was no safe way to tell which one is
  actually driving Operations. FE-5 adds a **DEV-only, bridge-mode-only** diagnostics
  panel that answers it directly (verdict: `라이브 브리지 사용 중` / `픽스처로 폴백됨`
  / `픽스처 데모`).
- **Pure formatter** `lib/actionWindow/diagnostics.ts` (`describeBridgeDiagnostics`):
  takes explicit **sanitized primitives** — source mode, connection literal,
  booleans, a plain integer revision, and the channel **display label** — never the
  raw `ActionWindowRunView`, so it structurally cannot leak a runId, raw channelCode,
  URL, token, or wire frame. Fields: source mode, connection state, bridge mode,
  boot attempted, retry pending, last safe transition (`prev → current`, timeless),
  connection change counter, revision (int), channel label, run-bound (bool).
- **Component** `components/actionWindow/BridgeDiagnostics.tsx`: dashed DEV panel on
  both pages, rendered only inside the page-level `isFixturePreviewEnabled() &&
  isBridgeModeEnabled()` dead-branch gate (same tree-shaking pattern as
  `SimulationPreview`), so it appears in both bridge-live and bridge-fallback but is
  absent from the production build. Renders in both by living outside the two
  existing `sourceMode`-scoped DEV strips.
- **Store**: a **timestamp-free** `connectionTrail` (capped at 6; only the three
  `SourceConnection` literals) + `connectionChangeCount`, updated on an actual
  connection transition (a repeated same-state frame is not counted) and reset to a
  fresh connected session on every world switch (adopt / fixture load / simulation /
  reset). The store still imports **no** bridge transport module.
- **Getter** `bridgeSource.ts` `isBridgeBootAttempted()` — read-only boot-flag view
  so the panel distinguishes "never tried" from "tried and fell back".
- Tests (node-env, +14 → 271): `diagnostics.test.ts` (9 — verdict logic, field
  formatting, last-transition, dash-for-empty, channel label not raw code, a
  **leak-guard** proving no field exposes a raw id/url/token/wire frame, and a
  bounded-vocabulary assertion); `operationsStore.test.ts` (+5 — trail/counter
  transitions, same-state not counted, cap enforced, world-switch reset).
- Docs: FE-5 plan entry; this handoff; the stale FE-4 "uncommitted" note corrected
  (FE-4 is committed `4807600`).

FE-4 Reconnect & recovery UX for the live Bridge connection (one FE slice, committed `4807600`):

- Product gap closed: FE-3.5 made real drops *visible* but left the terminal
  `offline` state a dead end (auto-retry gives up → only a page reload recovered).
  The one manual re-attempt lived in the DEV panel, which both pages hide in
  bridge mode — unreachable exactly when a live connection can drop.
- **Reconnect action on the offline banner** (`ConnectionBanner`): on a live
  Bridge `offline`, the page passes `onReconnect` → a "다시 연결" button that runs
  `retryBridgeBoot()` (fresh bridge world / resync from 0 on success; honest
  fallback + safe note otherwise). Shown only on `offline` (not `reconnecting`)
  and only when `sourceMode === "bridge"`; allowed on mobile (read-only-safe).
- **In-flight guard**: UI-only `retryPending` flag (NOT a 4th `SourceConnection`
  literal). `beginBridgeRetry`/`endBridgeRetry(succeeded)` in the store toggle it
  and surface `CONNECTION_RETRY_FAILED_NOTE` on failure; `useBridgeReconnect()`
  hook owns `retryBridgeBoot()` so the store never imports the Bridge modules.
- Offline body copy corrected (no longer promises an automatic retry — it's the
  terminal state; recovery is the manual action).
- **DEV return-to-fixture** strip (bridge mode only; absent from prod bundle):
  "픽스처로 돌아가기 (개발용)" → `returnToFixtureForDev()`, so the full
  fixture → live → drop → offline → reconnect/return loop is drivable without a
  reload. The FE-3.5 boot-retry button is KEPT (covers the distinct
  boot-fell-back case, `sourceMode === "fixture"`; the two never co-occur).
- Tests (node-env, +5 → 257): copy action/pending/failure strings; store
  `retryPending` + `returnToFixtureForDev`; `bridgeSource` offline → fresh
  re-adopt resyncs from zero and closes the dead source.
- Docs: FE-4 plan entry; this handoff; the stale FE-3.5 "uncommitted" note fixed
  (FE-3.5 is committed `c4b98d5`).

FE-3.5 Connection-status callback + DEV boot retry (one FE slice, committed `c4b98d5`):

- Product behavior: real Bridge drops/reconnects now drive the EXISTING
  offline/reconnecting banner and command suppression — the seller can no longer
  click commands while SellerOps is not actually connected. Previously those UI
  states were reachable only via the DEV simulations ("real disconnects are
  silent" caveat — now closed at the FE level).
- `wsTransport.ts`: additive optional `onStatus` (`AwConnectionStatus`), deduped,
  fired at established/restored → connected, drop → reconnecting, exhaustion or
  different-run dormancy → offline; never after `close()`; behavior identical
  when omitted (all pre-existing transport tests run unchanged without one).
- `devMode.ts` `resolveBridgeSession(onStatus?)`; `bridgeSource.ts`
  `notifyStatus()` forwards status as existing `connection` frames — store,
  `ConnectionBanner`, and suppression react with zero changes.
- DEV boot retry: `retryBridgeBoot()` + "🔌 로컬 에이전트 다시 연결 (개발용)"
  button on both pages (visible only when bridge mode enabled but boot fell back;
  absent from the production bundle).
- Tests +7 (node-env, existing harnesses): transport transitions incl.
  silent-after-close, store forwarding, boot retry. Total **252**.
- Docs: FE-3.5 plan entry; post-merge PR #223 housekeeping bundled here.

FE-3 Bridge-backed source + reconciliation (one FE slice, committed `39d885b`):

- Rebased the branch onto `origin/main` `8d61d2f`; resolved the one conflict
  (`Operations.tsx`) in favor of our store-based IA (home + detail).
- **Kept from main (untouched):** `wsTransport.ts` (+test), `bridgeAdapter.ts`
  (+test), the expanded `devMode.ts` boundary (`AdapterMode`, `isBridgeModeEnabled`
  `VITE_AW_BRIDGE=1` DEV-only opt-in, `resolveBridgeSession` honest fallback) and its
  test, `bridgeClient.ts` tweak, contract transport re-export.
- **Retired from main:** `controller.ts` (orphaned `useActionWindowController` — its
  role is our `operationsStore`; two stale doc comments in `devMode.ts` updated).
- **New `lib/actionWindow/bridgeSource.ts`:** `createBridgeSource(client)` — thin
  translation from the R2 `BridgeClient` to the FE-2.5 `ActionWindowSource` seam
  (client owns envelopes/dedupe/highest-revision/resync; frames re-sequenced +1
  locally so the store's rules see a clean stream). `connectBridgeIfEnabled()` boots
  the live connection once per session (DEV + env opt-in + live session, else
  fixture stays — honest fallback).
- **Store:** `sourceMode: "fixture" | "bridge"`, `adoptBridgeSource` (state-first so
  synchronous loopback frames land on the fresh bridge world), bridge teardown on
  any fixture load / simulation start / reset.
- **Pages:** `useBridgeBoot()` on home + detail; DEV fixture/simulation panels hidden
  while a live Bridge source is active (fixture world only).
- **Tests:** `bridgeSource.test.ts` (10, node-env) driving the full FE stack below
  the seam over the contract's `createLoopbackChannel` — resync-on-adopt, view flow,
  real envelopes with `expectedRevision`, safe rejection notes, no view mutation,
  client-side disallow, resync hydration, no revision regression, teardown paths,
  env-off fallback. Total **245**.

FE-2.5 Adapter seam + UI resilience prep (mock-driven, committed `5d54dee`):

- FE-owned seam `lib/actionWindow/source.ts`: `ActionWindowSource` (+ `SourceCommand`
  with `commandId`/`expectedRevision`, `SourceUpdate`, `SourceConnection`,
  `SteppableSource`) — an FE-only TypeScript interface, not a wire protocol.
- `lib/actionWindow/fixtureSource.ts` — default source wrapping the FE-1 mock adapter;
  all FE-1/FE-2 behavior preserved (existing tests unchanged and green).
- `lib/actionWindow/simulatedSource.ts` — DEV-only simulated stream, 6 scenarios
  (duplicate, stale view, out-of-order, snapshot restore, stale command,
  offline/reconnect) — UI resilience simulations, not Runtime behavior.
- `operationsStore` refactor: consumes a source; resilience rules — duplicates/late
  frames dropped via the contract's `isOutOfOrderEvent`; sequence gap → drop-until-
  snapshot (requests an authoritative snapshot, no buffering); a live run's `revision`
  never regresses; snapshots replace wholesale; rejected commands surface safe FE
  copy (`COMMAND_REJECTED_COPY`) and never mutate the view. The store never imports
  the simulation module (DEV panel hands the source in) → production bundle carries
  no simulation code.
- Offline/error UI: `ConnectionBanner` (FE-owned copy `CONNECTION_VIEW`); both pages
  suppress ALL command controls while offline/reconnecting (navigation stays).
- DEV `SimulationPreview` panel on both home and detail (step-driven, deterministic).
- FE-2 polish bundled: `canStartNewRun` now used by `ActiveRunCard`; terminal-run
  "다음 작업" section on the detail page (새 작업 시작 + 홈으로); per-surface note
  scoping via `noteId` + `useOperationsNote` (no cross-page stale note); detail idle
  h1 now "진행 중 작업"; `RECENT_LIMIT` → pure, tested `appendRecentRun` helper.
- Tests: `simulatedSource.test.ts` (11), `homeFixtures.test.ts` +2, store +1 → 216.

FE-2 Operations-agent home (mock-driven, committed `9f656ca`):

- IA move: `/operations` = operations-agent home (`pages/OperationsHome.tsx`);
  FE-1 run detail moved to `/operations/current` (`App.tsx` routes); nav label stays
  "리뷰 운영"; "운영 에이전트" wording in page copy only.
- Shared mock-state module `lib/actionWindow/operationsStore.ts` (+ React binding
  `hooks/useOperationsStore.ts`) — home and detail render one state; commands still
  flow through the FE-1 `applyCommand` (recheck-never-completes inherited). UI-only
  archive rule: a terminal run stays in the active zone and moves to recent activity
  when replaced (one entry per runId; capped at 5).
- UI-only projections + home fixtures `lib/actionWindow/homeFixtures.ts`
  (`HomeView`, `RecentRunItem`, `toRecentRunItem`, 6 home scenarios; **no protocol
  types added**; embedded runs reuse FE-1 fixtures and stay `validateRunView`-valid).
- Components `components/actionWindow/{ActiveRunCard,RecentActivityList,RunStatusBadge}.tsx`
  (badge extracted from `Operations.tsx`, shared by both pages). Home renders no run
  commands — only start/navigate; controls remain on the detail page from
  `allowedCommands`.
- DEV-only home scenario selector (same `devMode.ts` gate + 🧪 pattern).
- Tests `lib/actionWindow/{homeFixtures,operationsStore}.test.ts` (7 + 12, node-env,
  FE-1 style; no jsdom/RTL per product decision).
- `frontend/README.md` routes updated.

FE-1 Review Operations mock flow (merged earlier as PR #215):

- Route `/operations` + nav entry "리뷰 운영".
- Page `frontend/src/pages/Operations.tsx`.
- Components `frontend/src/components/actionWindow/{OperationRunTimeline,HumanCheckpointCard,ActionWindowControlPanel,CompletedResult}.tsx`.
- Lib `frontend/src/lib/actionWindow/{contract,copy,fixtures,mockAdapter}.ts` + tests
  `{copy,mockAdapter}.test.ts`.
- FE workstream docs recreated (`frontend/CLAUDE.md`, this workstream folder).

## In progress

- FE-5 (sanitized live-bridge diagnostics) implemented this slice, uncommitted on
  `feat/action-window-connection-status`. FE-3.5 (`c4b98d5`) + FE-4 (`4807600`)
  committed (not pushed).

## Next single task

**Land FE-5** (and the accumulated FE-3.5/FE-4 line): on explicit approval, commit
this slice as one commit onto `feat/action-window-connection-status` (after the
FE-4 commit `4807600`). The branch then carries FE-3.5 (real connection status) +
FE-4 (reconnect/recovery UX) + FE-5 (live-bridge diagnostics). Push/PR **only on
explicit approval**. Follow-ups: live-agent verification (`VITE_AW_BRIDGE=1` +
running paired agent — now also confirms the LIVE vs FIXTURE FALLBACK verdict
directly), and the jsdom/RTL decision (still deferred, separate approval).

## Files owned by this workstream

- `frontend/**` (source + colocated tests) · `frontend/CLAUDE.md` ·
  `docs/workstreams/action-window-frontend/**`.

## Files explicitly excluded (untouched)

- `collector/**`, `backend/**`, `contracts/action-window/v1/**` (consume only),
  marketplace/Chrome/CDP/runtime code, `docs/esm/**`, `tools/`, canonical docs,
  `docs/action-window-runtime/**`, other worktrees.

## Contract consumption

- Single bridge: `frontend/src/lib/actionWindow/contract.ts` re-exports
  `contracts/action-window/v1/index`. **No protocol enum/type is redefined in `frontend/**`.**
- Controls render only from `allowedCommands`. `REQUEST_STEP_RECHECK` never completes a
  step locally (transitions to observing). FE owns all copy via `copy.ts` (unknown copy key
  → safe fallback).

## Visual/UX hardening (FE-1 session; conventions carried into FE-2)

- Unknown `channelCode` now renders a safe fallback `알 수 없는 채널` (never the raw code) —
  `copy.ts` `CHANNEL_FALLBACK`.
- The mock scenario selector is **DEV-only** (`lib/actionWindow/devMode.ts`,
  `import.meta.env.DEV`) and styled as a dashed "🧪 데모 미리보기 · 개발용" panel. Verified
  **absent from the production bundle** (grep of `dist` for the label → 0).
- Mobile is **read-only**: interactive controls (control panel, checkpoint actions,
  start button) are `hidden sm:*`; a `sm:hidden` note explains real work happens on
  desktop. Timeline + status + blocker + completed remain visible read-only.
- Overflow guards on the timeline (`min-w-0`, `break-keep`, `shrink-0`).

## Validation results (FE-8 session, 2026-07-12)

- `.github/workflows/frontend-ci.yml`: YAML parses clean (`yaml.safe_load`); structure
  is `on.pull_request` (branches `[main]`, paths `frontend/**` +
  `contracts/action-window/v1/**` + the workflow file), `concurrency` cancel-in-progress,
  `permissions: contents: read`, one `ubuntu-latest` job (`working-directory: frontend`)
  running checkout → setup-node@v4 (Node 20 + npm cache) → `npm ci` → typecheck → test →
  build.
- Local mirror of the CI commands from a clean install (`npm ci`, then the three scripts):
  typecheck passed; **308 tests passed** (27 files); build passed, bundle byte-identical
  (`index-DgRPaagd.css` 20.67 kB / `index-CDKl4_D3.js` 347.98 kB).
- No `frontend/**` source/config change; no dependency or lockfile change; `git diff
  --check` clean; scope limited to `.github/**` + these docs.
- Live CI confirmation lands on the first PR touching the filtered paths (this branch's
  own PR will exercise it). Making `frontend` a **required** status check is a repo-
  settings follow-up for the owner.

## Validation results (FE-7 session, 2026-07-11)

- `frontend typecheck`: passed.
- `frontend tests`: **308 passed** (294 prior + 14 jsdom page tests: `Operations`
  9 + `OperationsHome` 5). 27 test files. All prior tests unchanged; the two new page
  tests carry the `// @vitest-environment jsdom` pragma; no `*.test.ts` env changed.
- `frontend build`: passed; production bundle **byte-identical** to the FE-6 baseline
  (`index-DgRPaagd.css` 20.67 kB / `index-CDKl4_D3.js` 347.98 kB — same content hashes,
  verified by an isolated with/without-test-files rebuild). A stray `.table` utility
  (Tailwind's `src/**/*.{ts,tsx}` content scan extracted "table" from the word "route
  table" in a helper comment) was reworded away, so the test files contribute nothing to
  `dist`.
- Dependencies / config: **no change** — `package.json`, `package-lock.json`, and
  `vitest.config.ts` untouched (jsdom/RTL already present; `MemoryRouter` from the
  existing `react-router-dom`).
- `git diff --check`: clean.
- No component/page **source** changed; the store is driven (never mocked); only the
  `devMode` + `bridgeSource` boundaries are mocked (no real WebSocket in jsdom); no
  `collector/**` / `backend/**` / contract / canonical-doc change.
- Environment note: this slice was interrupted mid-run by an environment-level `EPERM`
  file-access fault (the whole working tree became unreadable to the toolchain); after
  access was restored the saved fix was reapplied and all checks re-run green.

## Validation results (FE-6 session, 2026-07-11)

- `frontend typecheck`: passed (jest-dom matcher types resolve via the
  `@testing-library/jest-dom/vitest` setup import).
- `frontend tests`: **294 passed** (271 prior node-env + 23 jsdom: `ConnectionBanner`
  8 + `ActionWindowControlPanel` 4 + `HumanCheckpointCard` 6 + `BridgeDiagnostics` 5).
  25 test files. All 271 prior tests still run in the node env (no `@vitest-environment`
  pragma added to any `*.test.ts`; verified grep → 0).
- `frontend build`: passed (347.98 kB / 109.39 kB gzip — **unchanged**; no component
  source touched). Production bundle re-checked: diagnostics-unique DEV labels still 0
  ("브리지 진단" / "소스 모드" / "라이브 브리지 사용 중" / "부트 시도됨" /
  "픽스처로 폴백됨" → 0); no test tooling leaked (`vitest` / `testing-library` /
  `@vitest-environment` → 0); resilience copy present ("다시 연결" → 2 hits/file).
  ("확인이 필요한 작업" appears once — the shipped `HumanCheckpointCard` `aria-label`,
  a production component, not test/DEV code.)
- Dependencies: `jsdom`, `@testing-library/{react,dom,jest-dom,user-event}` added as
  **devDependencies only**; runtime `dependencies` and `scripts` unchanged (git diff
  of `package.json` = 5 devDep lines; `package-lock.json` additive).
- `git diff --check`: clean.
- No component **source** changed; no `collector/**` / `backend/**` / contract /
  canonical-doc change; no real Bridge/Runtime/Chrome/Backend integration; the store
  still imports no bridge transport module.

## Validation results (FE-5 session, 2026-07-11)

- `frontend typecheck`: passed.
- `frontend tests`: **271 passed** (257 prior + `diagnostics` 9 + store 5).
- `frontend build`: passed (347.98 kB / 109.39 kB gzip); production bundle
  checked — DEV/diagnostics code absent (grep "브리지 진단" / "소스 모드" /
  "연결 변경 횟수" / "라이브 브리지 사용 중" / "픽스처로 폴백됨" / "픽스처 데모" /
  "부트 시도됨" / "마지막 전이" / "데모 미리보기" / "픽스처로 돌아가기" /
  "라이브 연결 중" / "개발용" → 0 each); user-facing copy present ("연결이 끊겼어요"
  → 2, "다시 연결" → 5, "다시 연결하는 중" → 2, "리뷰 운영" → 2,
  "ESM (지마켓·옥션)" → 1); `VITE_AW_BRIDGE` compiled away (grep → 0).
- Bundle note: `esm_plus` / `run_demo_esm` remain in the bundle as **pre-existing
  fixture demo data** (the default fixture source ships the demo run); `fixtures.ts`
  is untouched by this slice and the tree-shaken diagnostics module emits neither.
- `git diff --check`: clean.
- No duplicated contract enums in `frontend/**`; no `collector/**` / `backend/**` /
  contract / canonical-doc change; no real Bridge/Runtime/Chrome/Backend integration;
  the store still imports no bridge transport module.

## Validation results (FE-4 session, 2026-07-09)

- `frontend typecheck`: passed.
- `frontend tests`: **257 passed** (252 FE-3.5-era + copy 2 + store 2 +
  `bridgeSource` re-adopt 1).
- `frontend build`: passed (347.73 kB / 109.30 kB gzip); production bundle
  checked — DEV code absent (grep "데모 미리보기" / "픽스처로 돌아가기" /
  "라이브 연결 중" / "개발용" / "sim-" / "다시 연결 (개발용)" → 0 each);
  user-facing resilience copy present ("연결이 끊겼어요" → 2, "다시 연결" → 5,
  "다시 연결하는 중" → 2, failure note → 1); the `VITE_AW_BRIDGE` check compiles
  away in production (grep → 0).
- `git diff --check`: clean.
- No duplicated contract enums in `frontend/**`; no `collector/**` / `backend/**` /
  contract / canonical-doc change; no real Bridge/Runtime/Chrome/Backend integration.

## Accessibility notes

Native `<button>` controls; visible `focus-visible` rings; status conveyed by icon + label +
text (not color alone); `aria-label` / `aria-current` / `aria-live` / `role="note"` used;
`<ol>` timeline; responsive `sm:` breakpoints for desktop-primary / mobile-read-only.
FE-6 added jsdom + React Testing Library **component-level DOM/a11y tests** over the
new interactive surfaces (reconnect banner `role="status"` + `aria-busy`, command
buttons by accessible name, blocker status regions, the diagnostics `<section>`/`<dl>`)
— so role/aria structure and click→callback wiring are now regression-covered in the
node/jsdom suite. FE-7 extends this to **page-level DOM integration tests**: driving the
real store to offline / reconnecting / connected states and asserting the pages render
the banner + reconnect action, suppress the command regions, and surface the diagnostics
entry point — all queried by role + accessible name. Not covered: real-browser
layout/CSS (jsdom applies no stylesheet, so Tailwind responsive visibility is not
asserted), automated axe scanning (jest-axe not adopted); a live browser screenshot pass
and a paired-agent live verification remain separate, approval-gated follow-ups.

## Last meaningful commit

- Merge `9958197` — PR #230 merged into `main` (2026-07-11), carrying FE-7 `849f690`
  (page-level DOM integration tests).

## Current PR

- **None open. PR #230 merged** (`feat/action-window-page-dom-tests` → `main`, merge
  `9958197`). FE-8 (frontend CI workflow) is implemented on `chore/frontend-ci-plan`
  (branched from `9958197`), **uncommitted**, awaiting commit approval.

## Decisions made in this workstream

- `ready-to-start` = `run: null` (contract has no persisted `IDLE`).
- Copy ownership fully FE-side; contract copy keys mapped in `copy.ts`.
- Mock adapter deterministic transitions demonstrate the flow without Runtime.
- FE-2 IA (2026-07-09, product-owner): `/operations` = operations home;
  `/operations/current` = current run detail (FE-1 flow moves there); nav label stays
  "리뷰 운영"; "운영 에이전트" wording in page copy only, not nav. Run-scoped URLs
  deferred to FE-3.
- FE-2 multi-run/history shapes are UI-only projections in `frontend/**` — no new
  protocol types (any wire shape is a separate contract PR).
- FE-2 product decisions (2026-07-09): history included in v1; a just-completed run
  stays in the active zone until the next run starts (store archive rule, one recent
  entry per runId, capped at 5); shared mock-state module between home and detail;
  no jsdom/RTL in this slice.
- FE-2.5 decisions (2026-07-09, product-owner): source interface named
  `ActionWindowSource` (FE-only TypeScript seam, not a wire protocol); out-of-order
  policy is drop-until-snapshot (no buffering/reordering); resilience simulations
  reachable from both home and detail DEV panels; no jsdom/RTL. Implementation note:
  the store never imports the simulation module — the DEV panel constructs the
  simulated source and hands it in (`SteppableSource`), keeping simulation code out
  of the production bundle.
- FE-3 reconciliation decisions (2026-07-09, product-owner): rebase the unpushed
  branch onto the R2 `main`; keep our IA (home + detail) and single state owner
  (`operationsStore` + `ActionWindowSource`); keep main's transport stack
  (`wsTransport`/`bridgeAdapter`) untouched; retire main's duplicate `controller.ts`;
  FE-3 = a thin Bridge-backed source (`bridgeSource.ts`) only; `fixtureSource`
  stays the default/dev-safe source; DEV fixture + simulation panels preserved
  (hidden while a live Bridge source is active); env-driven switch reuses main's
  `isBridgeModeEnabled` (`VITE_AW_BRIDGE=1`, DEV-only, honest fallback).

## Open FE-only questions

- ~~Final placement/label of the Operations surface~~ — **resolved 2026-07-09** by the
  FE-2 IA decision (home at `/operations`, detail at `/operations/current`, nav label
  unchanged). See "Decisions made".
- ~~FE-2 pre-implementation choices~~ — **resolved 2026-07-09** (see "Decisions made").
- ~~FE-2.5 pre-implementation choices~~ — **resolved 2026-07-09** (product-owner):
  `ActionWindowSource` name; drop-until-snapshot (no buffering); simulations on both
  home and detail DEV panels; no jsdom/RTL.
- ~~Whether to add jsdom + React Testing Library for DOM/a11y unit tests~~ —
  **resolved 2026-07-11** (product-owner): adopted in **FE-6**, minimally and
  additively (component-only scope, hand-rolled role/aria assertions, no jest-axe,
  jsdom opted in per-`.test.tsx` so the node-env default is unchanged). The reconnect
  button was the first click-through DOM test, as anticipated.
- ~~Page-level integration tests through the store~~ — **resolved 2026-07-11**
  (product-owner): adopted in **FE-7** (page-level DOM integration tests only, real
  store driven via its public API, `devMode` mocked production-shaped by default, shared
  `src/test/` helper module, zero new deps / config).
- ~~A frontend CI workflow to run typecheck/test/build on PRs~~ — **resolved 2026-07-12**
  (product-owner): adopted in **FE-8** (`.github/workflows/frontend-ci.yml`, PR-only,
  path-filtered to `frontend/**` + `contracts/action-window/v1/**`, Node 20, npm cache,
  `npm ci` → typecheck → test → build). Still open (named, not started): jest-axe
  automated a11y scanning; making `frontend` a required status check (repo settings);
  `collector`/`backend` CI.

## Exact steps for the next session

1. On approval, commit the FE-8 slice (`.github/workflows/frontend-ci.yml` + these docs)
   as one commit onto `chore/frontend-ci-plan` (after `9958197`); push/PR only when
   explicitly approved. After merge, make `frontend` a **required** status check in the
   repo's branch-protection settings (GitHub UI — not a file change).
2. Live-agent verification (`VITE_AW_BRIDGE=1` against a running, paired local agent
   hosting a run) — environment-dependent follow-up; do not claim it from node/jsdom
   tests. Covers real drop → reconnecting → offline → manual reconnect → fresh resync,
   and confirming the FE-5 LIVE vs FIXTURE FALLBACK verdict directly.
3. Remaining candidates afterwards (named, not started): jest-axe automated a11y
   scanning; `collector`/`backend` CI workflows.
4. Do not modify the contract or canonical docs from this workstream.
