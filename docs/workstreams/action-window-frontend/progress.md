# Action Window Frontend — Progress (session handoff)

> Update this document before stopping in every FE task.

- **Workstream:** UI/UX + Frontend
- **Status:** **FE-1 MERGED (PR #215). FE-2 + FE-2.5 + FE-3 COMMITTED
  (`9f656ca` / `5d54dee` / `39d885b`), PUSHED, and open for review as PR #223.**

## Base

- **Worktree:** `/Users/taewookang/Downloads/workspace/sellerops-fe3`
- **Branch:** `feat/action-window-fe3`, rebased 2026-07-09 onto `origin/main`
  `8d61d2f` (Runtime R2 Bridge transport PR #218, FE/Runtime integration PRs
  #216–217, run persistence #219, R4 prep #220–221), then a final conflict-free
  rebase onto `f0d57f4` (PR #222, collector/runtime-docs only) before push.
- **Commits (current hashes):** FE-2 `9f656ca`, FE-2.5 `5d54dee`, FE-3 `39d885b`.
  (Earlier hashes across the two rebases: `a7a43f4`/`7dd97fb` → `d08ef4f`/`ead80ac`.)
  One rebase conflict (`pages/Operations.tsx`, both lines rewrote the FE-1 page)
  resolved in favor of our store-based version per product decision.

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
- FE-3 (Bridge-backed source) implemented: ✅ (committed `39d885b`; in PR #223)

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

- None. FE-3 implemented (this slice); FE-2/FE-2.5 committed and rebased.

## Next single task

**Land FE-3**: review and commit this slice as one commit. The branch then carries the
complete FE line (FE-2 home IA + FE-2.5 seam/resilience + FE-3 Bridge source) rebased on
the R2 `main` — ready for a PR **only on explicit approval**. Follow-ups after landing:
verify against a live local agent (`VITE_AW_BRIDGE=1` + running agent — a real
environment, out of node-env test reach), and revisit jsdom/RTL.

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

## Validation results (FE-3 session, 2026-07-09)

- `frontend typecheck`: passed (post-rebase, incl. main's transport/adapter code).
- `frontend tests`: **245 passed** (216 FE-2.5-era + 19 from main's integration tests
  [`wsTransport`, `bridgeAdapter`, expanded `devMode`] + `bridgeSource.test.ts` 10).
- `frontend build`: passed; production bundle checked — dev/simulation code absent
  (grep "데모 미리보기" / "시뮬레이션" / "sim-duplicate" / "수신 안정성" → 0 each);
  resilience + home copy present ("연결이 끊겼어요", "운영 에이전트" → 1 each);
  transport code present as production-intended (`aw_resync` → 1, same as `main`);
  the `VITE_AW_BRIDGE` check compiles away in production (grep → 0).
- `git diff --check`: clean.
- No duplicated contract enums in `frontend/**`; no `collector/**` / `backend/**` /
  contract / canonical-doc change; no real Bridge/Runtime/Chrome/Backend integration.

## Accessibility notes

Native `<button>` controls; visible `focus-visible` rings; status conveyed by icon + label +
text (not color alone); `aria-label` / `aria-current` / `aria-live` / `role="note"` used;
`<ol>` timeline; responsive `sm:` breakpoints for desktop-primary / mobile-read-only.
Visual review was done at the markup + responsive-class + production-bundle level (the FE test
harness is node-env with no jsdom, and live browser automation is out of scope here); a live
browser screenshot pass can be run separately with approval.

## Last meaningful commit

- FE-3 `39d885b` "feat: reconcile FE line with R2 and add Bridge-backed source",
  on top of FE-2.5 `5d54dee` and FE-2 `9f656ca` — all pushed to
  `origin/feat/action-window-fe3` (PR #223).

## Current PR

- **PR #223 open** (`feat/action-window-fe3` → `main`, 3 commits:
  `9f656ca` + `5d54dee` + `39d885b`). Merge waits for explicit approval.

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
- Whether to add jsdom + React Testing Library for DOM/a11y unit tests (new dependency —
  deferred by product decision; revisit before FE-3).

## Exact steps for the next session

1. Address PR #223 review feedback (iterate on this branch; keep consuming the
   shared contract only). Merge only on explicit approval.
2. Live verification (`VITE_AW_BRIDGE=1` against a running local agent) is a separate,
   environment-dependent follow-up; do not claim it from node-env tests.
3. Candidate next FE slices after merge: connection-status callback from
   `wsTransport` into the resilience UI; DEV boot-retry ergonomics; jsdom/RTL
   decision.
4. Do not modify the contract or canonical docs from this workstream.
