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
| 1 | Contract readiness (R0) | `MERGED` | `contracts/action-window/v1/index.ts`, `schema.json` | `collector/test/contracts/action-window/contract.test.ts` — 55/55 | 25 valid + 10 negative fixtures | PR #212, merge `026eb77` | Protocol v1; nested-in-Bridge-v1 transport; schema↔TS consistency green. |
| 2 | State engine (R1) | `VERIFIED` | `collector/src/action-window/engine.ts`, `stages.ts` | `test/action-window/engine.test.ts` — 20 (incl. canonical-contract regression) | headed QA `normal` → 13-event loop → COMPLETED (canonical contract) | `feat/action-window-runtime-r1` → reconciled on `fix/action-window-runtime-contract` | Channel-neutral pure engine; contract-valid events/view; aligned to post-#214 canonical shape. |
| 3 | Target detection | `VERIFIED` | `collector/src/action-window/locator.ts`, `signature.ts` | `fixture-browser.test.ts` (RUN_INTEGRATION) | 0/1/many synthetic + headed QA | `feat/action-window-runtime-r1` | In-page 16-hex signature; no selector/text leaves page; fails closed on 0/many. |
| 4 | Overlay | `VERIFIED` | `collector/src/action-window/overlay.ts` | `fixture-browser.test.ts` — mount + no-intercept + reposition + guidance-off | synthetic + headed QA | `feat/action-window-runtime-r1` | `pointer-events:none` (never intercepts click); repositions on layout move. |
| 5 | Actual user-click observation | `VERIFIED` | `collector/src/action-window/observer.ts` | `fixture-browser.test.ts` | headed QA: real human click → `USER_ACTION_OBSERVED` | `feat/action-window-runtime-r1` | Records sanitized boolean only; Runtime never clicks; click ≠ completion. |
| 6 | Transition verification | `VERIFIED` | `collector/src/action-window/verifier.ts` | `engine.test.ts` + `fixture-browser.test.ts` | headed QA: verified → COMPLETED | `feat/action-window-runtime-r1` | Verified transition is the sole completion authority; unchanged → no false completion. |
| 7 | Fail-closed cases | `VERIFIED` | `engine.ts` (`fail()`), `verifier.ts`, `locator.ts` | `engine.test.ts` + `fixture-browser.test.ts` | headed QA `multi-candidate` → TARGET_AMBIGUOUS, no click | `feat/action-window-runtime-r1` | TARGET_NOT_FOUND / AMBIGUOUS / UI_DRIFT / UNSUPPORTED_STATE; stale-rev + proto-version rejected; cancel cleans up. |
| 8 | Dummy downstream | `VERIFIED` | `collector/src/action-window/engine.ts` (`runDownstream`) | `engine.test.ts` | headed QA: `downstream.processed=1` | `feat/action-window-runtime-r1` | One deterministic in-memory step; no backend/upload/download. |
| 9 | Contract events (in-memory sink) | `VERIFIED` | `collector/src/action-window/events.ts`, `engine.ts` | `engine.test.ts` — validate + sequence/revision | headed QA: 13-event ordered loop | `feat/action-window-runtime-r1` | Sanitized + ordered to in-memory sink; **real Bridge transport handlers = R2**. |
| 10 | Cleanup | `VERIFIED` | `harness.ts` (`finish`), `overlay.ts`, `observer.ts` | `fixture-browser.test.ts` — overlay removed + flag cleared | headed QA: clean process exit | `feat/action-window-runtime-r1` | Overlay/listeners torn down on complete/cancel/fail; browser owned by harness only. |
| 11 | Privacy / sanitization | `VERIFIED` | `view.ts`, `signature.ts`, engine payloads | `engine.test.ts` + `fixture-browser.test.ts` — `findProhibitedFields` == [] | headed QA: opaque 16-hex `targetRef` only | `feat/action-window-runtime-r1` | Only enums/counts/opaque-16-hex; no selector/text/URL/path in any event or view. |
| 12 | FE integration (R2) | `NOT_STARTED` | — | — | — | — | Prereq: **FE Action Window mock-flow does not exist yet** (nothing for R2 to replace); Runtime side green after R1.1. |

> **R1.1 (contract reconciliation).** PR #214 rewrote the contract shape (modes,
> `channelCode`, `copyKey`/`copyParams`, prose→prohibited) **without bumping
> `ACTION_WINDOW_PROTOCOL_VERSION`**; R1 (#213) merged on top unreconciled and broke
> `main`'s collector typecheck. `fix/action-window-runtime-contract` realigns R1 to
> the canonical contract (verified: 20 unit + 8 browser + headed QA). **Governance
> rule:** future breaking contract changes require a version bump or explicit
> migration, and Runtime must be typechecked against the contract on `main`.
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
