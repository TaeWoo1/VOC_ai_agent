# Action Window Frontend — Progress (session handoff)

> Update this document before stopping in every FE task.

- **Workstream:** UI/UX + Frontend
- **Status:** **FE-1 implemented (uncommitted), pending product-owner review.**

## Base

- **Worktree:** `/Users/taewookang/Downloads/workspace/sellerops-fe`
- **Branch:** `feat/action-window-frontend`
- **Base / HEAD SHA:** `597cec5ef16a6f5436ef011a6ab626268a640b83` (`origin/main`,
  after PR #214 merged the reconciled + execution-mode-aligned contract).
- **Working tree:** FE-1 changes uncommitted (this task does not commit).

## Gate check

- Integration PR #209 merged into `main`: ✅
- Shared Action Window contract merged (`contracts/action-window/v1/`, PRs #212 + #214): ✅
- FE branch based on the merged contract commit: ✅ (`597cec5`)

## Completed (this session)

FE-1 Review Operations mock flow:

- Route `/operations` + nav entry "리뷰 운영".
- Page `frontend/src/pages/Operations.tsx`.
- Components `frontend/src/components/actionWindow/{OperationRunTimeline,HumanCheckpointCard,ActionWindowControlPanel,CompletedResult}.tsx`.
- Lib `frontend/src/lib/actionWindow/{contract,copy,fixtures,mockAdapter}.ts` + tests
  `{copy,mockAdapter}.test.ts`.
- FE workstream docs recreated (`frontend/CLAUDE.md`, this workstream folder).

## In progress

- None. Awaiting review.

## Next single task

Product-owner review of FE-1; on approval, commit the FE-1 slice. Then FE-2
(operations-agent home) or FE-3 (real Bridge adapter) per priority — not started.

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

## Visual/UX hardening (this session)

- Unknown `channelCode` now renders a safe fallback `알 수 없는 채널` (never the raw code) —
  `copy.ts` `CHANNEL_FALLBACK`.
- The mock scenario selector is **DEV-only** (`lib/actionWindow/devMode.ts`,
  `import.meta.env.DEV`) and styled as a dashed "🧪 데모 미리보기 · 개발용" panel. Verified
  **absent from the production bundle** (grep of `dist` for the label → 0).
- Mobile is **read-only**: interactive controls (control panel, checkpoint actions,
  start button) are `hidden sm:*`; a `sm:hidden` note explains real work happens on
  desktop. Timeline + status + blocker + completed remain visible read-only.
- Overflow guards on the timeline (`min-w-0`, `break-keep`, `shrink-0`).

## Validation results

- `frontend typecheck`: passed (contract compiles under FE's stricter flags too).
- `frontend tests`: **183 passed** (incl. `copy.test.ts` 5, `mockAdapter.test.ts` 10,
  `devMode.test.ts` 1).
- `frontend build`: passed; production bundle checked (dev selector tree-shaken out;
  fallback + mobile guidance present).
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

- None in this workstream (FE-1 uncommitted per task instruction).

## Current PR

- None.

## Decisions made in this workstream

- `ready-to-start` = `run: null` (contract has no persisted `IDLE`).
- Copy ownership fully FE-side; contract copy keys mapped in `copy.ts`.
- Mock adapter deterministic transitions demonstrate the flow without Runtime.

## Open FE-only questions

- Final placement/label of the Operations surface within the frontstage IA (currently
  `/operations`, nav "리뷰 운영") — confirm against `sellerops_frontend_spec.md` §18.
- Whether to add jsdom + React Testing Library for DOM/a11y unit tests (new dependency —
  needs approval).

## Exact steps for the next session

1. On approval, stage the FE-1 files explicitly and commit one FE slice.
2. Otherwise iterate on FE-1 per review; keep consuming the shared contract only.
3. Do not modify the contract or canonical docs from this workstream.
