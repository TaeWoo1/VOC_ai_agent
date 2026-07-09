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

## FE-3 — Real Bridge adapter (future)

Not implemented. Replace the FE-1 mock adapter with a Bridge-backed source once Runtime
emits the contract View Model over the Local Agent Bridge; FE contract consumption stays
identical, only the adapter source changes.
