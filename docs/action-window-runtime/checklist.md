# Checklist — Action Window Runtime

Durable progress ledger. Update **only at meaningful implementation /
verification milestones**, not per tiny edit. Every `VERIFIED` or `MERGED`
requires linked evidence.

Status vocabulary (only these):
`NOT_STARTED` · `IN_PROGRESS` · `BLOCKED` · `IMPLEMENTED` · `VERIFIED` · `MERGED`
· `DEFERRED`

> **Rule:** do not mark an existing primitive as *Action-Window-complete* merely
> because related code exists. Reuse ≠ delivered Action Window capability.

| # | Item | Status | Code evidence | Test evidence | Fixture/live evidence | Commit/PR | Notes / blocker |
|---|---|---|---|---|---|---|---|
| 1 | Contract readiness (R0) | `IMPLEMENTED` | `contracts/action-window/v1/index.ts`, `schema.json` | `collector/test/contracts/action-window/contract.test.ts` — 55/55 vitest | 25 valid + 10 negative fixtures under `contracts/action-window/v1/fixtures/` | branch `feat/action-window-contract`; R0 PR open (not merged) | Protocol v1 defined; nested-in-Bridge-v1 transport; schema↔TS consistency test green. `MERGED` pending PR review. |
| 2 | State engine (R1) | `NOT_STARTED` | — | — | — | — | Channel-neutral synthetic flow; re-author reducer patterns from `esm-capture-gate.ts`. |
| 3 | Target detection | `NOT_STARTED` | primitive: `collector/src/esm/esm-candidate-signature.ts`, `esm-frame-scan.ts` | — | — | — | Primitives exist; Action Window locator not built. |
| 4 | Overlay | `NOT_STARTED` | — | — | — | — | Real-window overlay = default renderer. |
| 5 | Actual user-click observation | `NOT_STARTED` | primitive: `esm-review-live-scan.ts`; parked `esm-marketplace-observe.ts` | — | — | — | Re-author observer; no auto-click. |
| 6 | Transition verification | `NOT_STARTED` | primitive: `collector/src/work/types.ts` (`VerificationResult`) | — | — | — | Execution ≠ completion. |
| 7 | Fail-closed cases | `NOT_STARTED` | primitive: `esm-capture-gate.ts`, `esm-sentinel.ts` | — | — | — | Cover TARGET_NOT_FOUND / AMBIGUOUS / CHANGED / UNEXPECTED_STATE / NO_USER_ACTION / SESSION_INVALID. |
| 8 | Dummy downstream | `NOT_STARTED` | — | — | — | — | One dummy task only; no real volume. |
| 9 | Bridge events | `NOT_STARTED` | base: `collector/src/bridge/protocol.ts` | — | — | — | Sanitized + ordered; extend contract in R0. |
| 10 | Cleanup (window/profile/session) | `NOT_STARTED` | primitive: `connectionProfileDirFor` (`collector/src/agent/progressive-reconnect.ts:126`) | — | — | — | Deterministic teardown; no leaked CDP session. |
| 11 | Privacy / sanitization | `NOT_STARTED` | contract: `collector/src/bridge/protocol.ts` | — | — | — | No prohibited payload (see contract-boundary §3). |
| 12 | FE integration (R2) | `NOT_STARTED` | — | — | — | — | Depends on #1 (R0). |
| 13 | Persistence (R3) | `NOT_STARTED` | seam: `collector/src/work/*`, backend `CollectionRunService`/`SyncJob` | — | — | — | Currently caller-less; wire for refresh/resume. |
| 14 | First pilot adapter (R4) | `NOT_STARTED` | seams: `export-target-readiness*.ts`, `collector/src/upload.ts` | — | — | — | Channel not final; ESM+ strongest candidate; live requires PO approval + policy clarification. |

## Reused-foundation register (NOT Action Window capability)

These exist and are reusable, but are **not** Action Window deliverables until a
row above is `VERIFIED`:

- connection profile resolver — `connectionProfileDirFor`,
  `resolveCaptureConnectionProfile`
- candidate signature / frame scan — `esm-candidate-signature.ts`,
  `esm-frame-scan.ts`
- fail-closed gate / sentinel — `esm-capture-gate.ts`, `esm-sentinel.ts`
- download readiness (read-only) — `export-target-readiness.ts`,
  `export-target-readiness-stable.ts`
- upload / ingestion handoff — `collector/src/upload.ts`
- work/run/audit domain — `collector/src/work/*`
- Bridge protocol — `collector/src/bridge/protocol.ts`
- Browser Projection (optional renderer, State B) — `collector/src/bridge/projection-*`
