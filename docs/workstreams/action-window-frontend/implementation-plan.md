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

## FE-2 — Operations-agent home (future)

Not implemented. Multi-run overview / agent activity home. Own plan entry later.

## FE-3 — Real Bridge adapter (future)

Not implemented. Replace the FE-1 mock adapter with a Bridge-backed source once Runtime
emits the contract View Model over the Local Agent Bridge; FE contract consumption stays
identical, only the adapter source changes.
