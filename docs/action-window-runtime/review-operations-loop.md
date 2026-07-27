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

## Live verification — 2026-07-27 (seated operator, single-use approval)

Real product path: disposable-DB backend `:8080` → SellerOps frontend `:5174` (bridge) → paired collector
`:47620` → a REAL NAVER SmartStore account. Recorded **sanitized** — counts, enums, and sameness only,
never a raw slot, profile leaf, cookie, token, account id, or personal data. The stale prior agent on
`:47615` was left untouched throughout. The disposable DB started **empty** (0 reviews, 0 issue rows).

| step | observed | proves |
|---|---|---|
| migration | Flyway applied V1..**V31** on real Postgres (`V28 → V30 → V31`, no V29); **0 new migrations** from this slice | loop adds no schema |
| ingest | the operator exported **May 2026** reviews **on NAVER themselves**, and the file ingested through the product file-import path: **310 new, 0 duplicate, 0 failed**; the May segment → COMPLETED/COVERED/310 | real download·ingest·coverage on real data |
| dedupe | re-ingesting the **same** file → **0 new / 310 duplicate**; `reviews` stayed 310 | overlap-safe dedup on 리뷰글번호 |
| **refresh** | with **no** manual `POST /extract` or `/lifecycle-pass`, the issue memory went 0 → **2 issues, 3 evidence, 474 UNKNOWN units, 2 lifecycle state-events** immediately after the ingest committed | the AFTER_COMMIT `ReviewSegmentIngestedEvent` fired the bounded, idempotent refresh |
| summary | `GET /api/review-ops/loop-summary` returned `lastCoveredDate`, `newCount`, `nextRecommendedImport`, `upToDate=false`, and `issueChange.workingTotal=2` — all derived at read | completion + change-summary projection, no durable state |
| **forward-extend** | from a plan simulated to last reach 2026-06-30, `POST …/plans/{id}/extend` materialized a new **2026-07-01…07-27 PENDING** segment, advanced `requestedEnd` to today, and reopened the plan to **ACTIVE**; a second extend added nothing | incremental loop, idempotent |
| account profile | exactly **one** account-scoped profile dir (`naver-agent-<hash>`) was created for the account, holding the operator's NAVER session | account-scoped session binding (#366) |
| recovery | an agent restart mid-run ABANDONED the in-flight run, wrote **no launch ref to disk**, and the server kept the same ISSUED ticket with all segments still PENDING (no double-count) — the same segment was re-hostable on relaunch | recovery over existing durable truth |

**Honest limitation (recorded, not hidden).** The guided **in-page highlight/overlay** export leg did not
render in this session's headed browser — the run opened the account-scoped NAVER window but
`prepareSurface` did not drive the overlay, so no highlight appeared. That path is **unchanged collector
runtime** (this slice touches none of it) and was live-proven in #365/#366; rather than debug an unrelated
runtime issue blind, the live ingest above used the **sanctioned human-driven alternative** — the operator
exports on NAVER, SellerOps processes the resulting file (`collector/CLAUDE.md` §4.7). Every new piece this
slice adds (forward-extension, after-ingest refresh, loop-summary, recovery) fires on **any** COVERED
ingest, so all were verified on the real data above. Re-proving the guided overlay is a separate,
already-covered concern.

## Boundaries (still locked)

- **`OperationRun`/`OperationTask`/`CapabilityPolicy` bodies, a `ResumeState` durable table, and fully
  automatic dispatch remain locked.** The loop reuses existing durable truth and derives its summary.
- **No** auto-login/2FA/CAPTCHA, **no** hidden/chained or automatic marketplace clicks, **no** new FE
  screen (the completion result rides `GuidedImportCard`; the change detail rides `ReviewIssueSection`),
  **no** second-channel adapter, **no** profile upload/sync.
- Issue judgements are **unvalidated candidate signals** (THRESHOLDS DRAFT, extractor UNMEASURED) — never
  presented as validated findings or as a cause.
