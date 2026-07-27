# NAVER Repeated Review-Operations Loop (design + proof record)

> **Scope:** turn the already-live NAVER review-import vertical (Acquisition Supervisor wiring +
> account-scoped session + export HumanCheckpoint) into a **repeatable, incremental operating loop** —
> pull only what has arrived since the last covered range, reuse the account session, gate on readiness,
> export through **one** human checkpoint, ingest/dedupe/reconcile coverage, refresh the repeated-issue
> memory, and project the completion result + change summary — with restart / session-expiry /
> duplicate-run recovery.
> **Authorization:** `product-scope-v1.md` §1.7 **carve-out extension** (owner-approved 2026-07-27,
> "NAVER 리뷰 운영 루프"). Lock-minimal: no new `OperationRun`/`CapabilityPolicy` body, no `ResumeState`
> table, no full auto-dispatch — the loop reuses existing durable truth and derives its summary at read.
> **Date:** 2026-07-27 · **Mode:** offline (no browser, no NAVER) until the final live step.

## What was already true (so this slice did NOT rebuild it)

The NAVER review vertical was already live-proven before this loop:

- **Acquisition Supervisor is wired into the live import boot** (PR #365): readiness is probed at the four
  moments (`AGENT_START`/`BEFORE_WORK`/`SESSION_FAILURE`/`MANUAL_RECHECK`), the adapter binds the concrete
  `NaverLiveImportDriver`, a BEFORE_WORK admission gate is consulted, and readiness persists to the backend.
- **Account-scoped persistent session** (PR #366): the same account resolves to the same Chrome profile,
  so a login survives an agent restart; `POST …/session-readiness` stores readiness per opaque slot.
- **Export HumanCheckpoint** (observe-only): the seller clicks export/consent/download; SellerOps only
  detects, validates, and ingests. The engine never clicks, and the scope gate is unbypassable.
- **Idempotent, overlap-safe ingest**: dedupe on `external_id` (리뷰글번호) + a content-hash fallback, so
  re-pulling an overlapping window double-counts nothing.

The loop is the thin layer *above* that: sequence iterations incrementally, refresh analysis, and report.

## The four net-new pieces (lock-minimal)

1. **Forward plan-extension** (`ReviewImportPlanService.extendPlanForward`). A plan is fixed at creation
   over `[start, then]`; nothing advanced it as time passed, and a second plan is refused while one is
   live. Extension materializes new PENDING calendar-month segments **after the plan's latest live
   segment, up to today, on the SAME plan** — idempotent, and a COMPLETED plan reopens to ACTIVE (that
   reopening *is* the loop). Endpoint `POST /api/imports/reviews/plans/{planId}/extend`. Overlap-safe
   dedup means the forward edge never has to be pixel-perfect.

2. **After-ingest issue-memory refresh** (event, not a call chain). A COVERED ingest publishes
   `ReviewSegmentIngestedEvent`; `ReviewIssueImportRefreshListener` consumes it with
   `@TransactionalEventListener(AFTER_COMMIT)` in `REQUIRES_NEW`, running a **bounded, idempotent**
   extract + lifecycle-pass (`ReviewIssueRefreshService`). Because it runs after the import commits, in
   its own transaction, best-effort, a slow or failing refresh can never roll back or fail the collection
   that produced the reviews. This is the §1.7 "리뷰 정규화·분석 → automatic" direction, over already-
   collected data — never a marketplace action.

3. **Completion + change-summary read projection** (`reviewops` package). `GET /api/review-ops/loop-summary`
   composes, at read time, the account's import-health projection (`newCount`/`duplicateCount`/
   `failedCount`, coverage, `nextRecommendedImport`, `upToDate`) with counts of issue-memory change
   judgements. It owns **no durable state** — always consistent with its two sources, and no
   `OperationRun` body. The change counts are **unvalidated candidate signals** (thresholds DRAFT,
   extractor UNMEASURED), surfaced as "확인이 필요한 변화 / 이슈 후보", never as a validated finding.

4. **Recovery over existing durable truth only.** No new checkpoint table. Restart ABANDONS the in-flight
   run (the single-use launch ref is never persisted — a credential at rest); the server re-mints the same
   remaining segment on the next run. Session expiry parks recoverably (`SESSION_BLOCKED` →
   `WAITING_FOR_HUMAN`) and a re-check re-runs PREPARE on the same segment/ticket. Duplicate runs are
   dropped by the host (`IGNORE_ALREADY_HOSTED` / `IGNORE_BUSY`) and the DB's partial-unique open-ticket
   index. The seller-facing loop is operator-gated end to end: the runtime never mints a ticket, never
   auto-continues, and never clicks.

## The loop, one iteration (owner-visible)

```
loop-summary (read)  ── upToDate? ──no──▶  extend plan forward (operator presses "새로 들어온 기간")
        ▲                                            │  reopens plan with a PENDING segment
        │                                            ▼
   completion + change summary        계속 가져오기 → mint next-segment ticket (server)
        ▲                                            │
        │                                            ▼
  issue-memory refresh (AFTER_COMMIT)   guided run: readiness gate → seller exports (ONE checkpoint)
        ▲                                            │  → detect → validate → ingest (dedupe, coverage)
        └──────────────── COVERED ingest ◀───────────┘
```

## Acceptance criteria — how each is met (offline)

| criterion | evidence |
|---|---|
| Incremental plan after the last covered range | `extendPlanForward` materializes months after the latest live segment to today, idempotent (`ReviewImportPlanServiceTest`). |
| Account-scoped session reuse | unchanged from PR #366 (same slot → same profile); the loop rides it. |
| Readiness ↔ Acquisition Supervisor | unchanged from PR #365 (four probe moments, admission gate); the loop rides it. |
| Export via one HumanCheckpoint | unchanged engine/driver invariants — the seller performs every marketplace action; the loop adds no click. |
| Download·ingest·dedupe·coverage reconciliation | unchanged overlap-safe ingest; a COVERED ingest now also fires the refresh event (`ReviewImportRunServiceTest`). |
| Review Issue Memory refresh | `ReviewIssueRefreshService` (bounded, idempotent) + `ReviewIssueImportRefreshListener` (AFTER_COMMIT, best-effort) (`ReviewIssueRefreshServiceTest`, `ReviewIssueImportRefreshListenerTest`). |
| Completion + change-summary projection | `ReviewOpsLoopSummaryService` derives it at read; no durable state (`ReviewOpsLoopSummaryServiceTest`); rendered on `GuidedImportCard` (`GuidedImportCard.test.tsx`), no new screen. |
| Restart / session-expiry / duplicate-run recovery | consolidated offline E2E (`review-ops-loop-recovery.e2e.test.ts`) — abandon + server re-mint (no ref at rest), recoverable park + re-check, duplicate guards, repeated loop in one sitting. |

**Whole-stack offline gate green (2026-07-27):** backend `./gradlew test`; frontend `tsc --noEmit` +
`vitest` (1080); collector `npm run typecheck` + `vitest` (5349); contracts typecheck + `vitest` (163).

## Live verification — PENDING (fresh single-use in-turn approval required)

This record grants **no** live authorization. The live NAVER proof runs only under a fresh, single-use,
in-turn approval naming channel / account / date / operator, and will record — sanitized (sameness /
enums / counts only, never a raw slot, path, cookie, token, or personal data):

| step | to observe | proves |
|---|---|---|
| migration | (none new) V30/V31 already applied | loop adds no schema |
| iteration 1 | run a segment; COVERED ingest | the existing guided path still works end to end |
| refresh | issue-memory changed after ingest without a manual `/extract` | AFTER_COMMIT refresh fired |
| summary | `GET …/loop-summary` returns collection totals + candidate-signal change counts | derived projection |
| forward-extend | `POST …/plans/{id}/extend` adds a segment for the new period; plan reopens to ACTIVE | incremental loop |
| iteration 2 | run the newly-added segment from the SAME account session (no re-login) | session reuse across the loop |
| recovery | kill mid-run → restart → same segment re-mints (no re-login, no double-count) | recovery over existing truth |

## Boundaries (still locked)

- **`OperationRun`/`OperationTask`/`CapabilityPolicy` bodies, a `ResumeState` durable table, and fully
  automatic dispatch remain locked.** The loop reuses existing durable truth and derives its summary.
- **No** auto-login/2FA/CAPTCHA, **no** hidden/chained or automatic marketplace clicks, **no** new FE
  screen (the completion result rides `GuidedImportCard`; the change detail rides `ReviewIssueSection`),
  **no** second-channel adapter, **no** profile upload/sync.
- Issue judgements are **unvalidated candidate signals** (THRESHOLDS DRAFT, extractor UNMEASURED) — never
  presented as validated findings or as a cause.
