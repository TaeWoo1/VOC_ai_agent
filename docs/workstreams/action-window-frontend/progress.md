# Action Window Frontend — Progress (session handoff)

> Update this document before stopping in every FE task.

- **Workstream:** UI/UX + Frontend
- **Status:** **FE-1 MERGED (PR #215, merge `6440cfb`). FE-2 (operations-agent home)
  IMPLEMENTED (this slice). FE-3 audited on `main` →
  BLOCKED on Runtime R2 (real Bridge transport). FE-3 NOT started.**

## Base

- **Worktree:** `/Users/taewookang/Downloads/workspace/sellerops-fe3`
- **Branch:** `feat/action-window-fe3` (FE-3 readiness audit + FE-2 implementation).
- **Base / HEAD SHA:** `6440cfb9d88442bfa9f71ab5cf480198d009a4c2` (`origin/main`; carries
  FE-1 PR #215, Runtime R1 PR #213, and the merged contract).
- **This slice:** FE-2 implementation (`frontend/**`) + workstream docs
  (`progress.md`, `implementation-plan.md`). No FE-3 code (gated).

## Gate check

- Integration PR #209 merged into `main`: ✅
- Shared Action Window contract merged (`contracts/action-window/v1/`, PRs #212 + #214): ✅
- FE branch based on the merged contract commit: ✅ (`6440cfb`)
- FE-1 (Review Operations mock flow) merged: ✅ (PR #215)
- FE-2 gates (FE-1 merged + contract merged) satisfied; plan entry added and
  implemented (mock-driven, R2-independent): ✅ (this slice)

## FE-3 readiness audit (2026-07-09, on `main` `6440cfb`)

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

FE-2 Operations-agent home (mock-driven, one FE slice):

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

- None. FE-2 implemented (this slice).

## Next single task

**Land FE-2**: review and commit this slice as one commit (FE-2 `frontend/**` changes +
the workstream docs, which also carry the FE-3 audit). Then FE-3 stays gated as below.

**FE-3 stays blocked on Runtime R2.** Do not start FE-3 until R2 lands the nested Action
Window transport over Bridge v1 (AW event delivery + AW command message + AW reconnect
snapshot). When R2 is merged, re-run the readiness audit; if the three transport seams are
present, implement FE-3 (real Bridge-backed adapter, mock/real boundary, duplicate +
stale-update protection, `commandId` + `expectedRevision` dispatch, reconnect snapshot
handling, safe offline/error state) while preserving the dev fixture mode.

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

## Validation results (FE-2 session, 2026-07-09)

- `frontend typecheck`: passed.
- `frontend tests`: **202 passed** (183 FE-1-era + `homeFixtures.test.ts` 7 +
  `operationsStore.test.ts` 12).
- `frontend build`: passed; production bundle checked — dev selector label absent
  (grep "데모 미리보기" → 0); home copy present ("운영 에이전트", "최근 활동",
  "확인하러 가기", mobile guidance → 1 each).
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

- FE-1 `5ccf4ae` "feat: add Action Window review operations flow" — merged into `main` via
  PR #215 (merge `6440cfb`).

## Current PR

- None open. FE-1 (PR #215) merged. FE-3 not started (blocked on R2). This slice
  carries the FE-2 implementation + workstream docs (incl. the FE-3 audit).

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

## Open FE-only questions

- ~~Final placement/label of the Operations surface~~ — **resolved 2026-07-09** by the
  FE-2 IA decision (home at `/operations`, detail at `/operations/current`, nav label
  unchanged). See "Decisions made".
- ~~FE-2 pre-implementation choices~~ — **resolved 2026-07-09** (see "Decisions made").
- Whether to add jsdom + React Testing Library for DOM/a11y unit tests (new dependency —
  deferred out of the FE-2 slice by product decision; revisit before FE-3).

## Exact steps for the next session

1. On approval, stage and commit the FE-2 slice (`frontend/**` changes + the two
   workstream docs, which also carry the FE-3 audit) as one meaningful commit.
2. Otherwise iterate on FE-2 per review; keep consuming the shared contract only.
3. Do not modify the contract or canonical docs from this workstream; FE-3 stays blocked
   on Runtime R2 (re-run the readiness audit when R2 merges).
