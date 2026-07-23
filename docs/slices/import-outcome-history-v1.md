# Slice — Import Outcome & History v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` are untouched — this changes what a seller *sees*, not what a
> channel supports.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACQUIRE → the operator's record of it
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why

After a seller clicks export, they have exactly two questions: *did it work*, and *what came in*.
Neither had an answer that survived a page reload.

`frontend/src/lib/actionWindow/operationsStore.ts` kept `recentRuns` **in memory only** — it started
empty and accumulated within one browser session. Reload, and yesterday's import left no trace
anywhere the seller looks. Meanwhile `sync_jobs` had persisted every ingest all along: counts,
status, timing, and `method` (`SELLER_CENTER_EXPORT` vs `MANUAL_UPLOAD`).

The seller's record of their own operational work existed and simply was not shown.

## 2. What was built

**A read that filters before it limits.** `SyncJobRepository.findReviewImports` puts the predicate
(`jobType='FILE_UPLOAD' AND uploadType='REVIEW'` — exact, since `FileUploadConnector` is the only
writer of `uploadType`) **in the query**, with `Pageable` bounding the result after it. The sibling
reads fetch a fixed window and filter afterwards, so a busy org can push its review imports out of
the window before the filter runs — the seller then sees an empty history for imports that exist.
Ordering is `coalesce(finishedAt, createdAt) desc, id desc` — the import's own end instant, because
sorting on one timestamp while labelling rows with another is how a list shows an older date above a
newer one. (The fallback is `createdAt` while the surface falls back to `startedAt`; `open()` stamps
both together, and `createdAt` is NOT NULL where `startedAt` is not — so the sort key cannot degrade
into a null.)

**A minimal DTO.** `ReviewImportView` carries counts, provenance, outcome and timing. It deliberately
carries **no `errorMessage`** (the column holds raw row-errors and exception text that can embed
parser or filename detail) and **no `channelId`** (nothing renders it; shipping an id the surface
never shows is exposure without purpose). `GET /api/imports/reviews?limit=` is org-scoped from the
JWT, default 20, clamped to 50 — clamped rather than rejected, since a display parameter should not
500 a page, and `PageRequest` throws on a size below 1.

**A rail that persists.** `ImportHistoryList` reads it fail-closed and renders the honest state table
(§3). `OperationsHome`'s rail is now this; the session list survives **only** under the existing
fixture-preview gate, which is what it always was.

**V22** indexes `(org_id, job_type, upload_type, coalesce(finished_at, created_at) desc)` — the limit
bounds the result, not the scan, and `sync_jobs` grows once per import forever. Verified on PostgreSQL
15: the plan is `Limit → Sort → Index Scan using idx_sync_jobs_review_imports`. The index serves the
**predicate**; a Sort remains because the `id desc` tiebreaker is not in the index, so the win is that
the sort runs over one org's review imports rather than its whole history.

## 3. The state table — every case, said correctly

| State | Reads |
|---|---|
| loading | 불러오는 중… — never an empty list |
| **read error** | 가져오기 기록을 불러오지 못했어요 (`role="alert"`) — **fail closed** |
| never imported | 아직 가져온 리뷰가 없어요 — distinct from the error |
| **empty export** (`SUCCESS` 0/0/0) | 새 리뷰 없음 — a quiet range is a working export |
| **all-duplicate** (`SUCCESS`, 0 new, N skipped) | 새로 추가된 리뷰 없음 · 중복 N건 |
| success | 새 리뷰 N건 (+ duplicates/failures when non-zero) |
| `PARTIAL` | 일부만 저장됐어요 · 새 리뷰 N건 — hiding the successes would misreport a half-landed import as a total loss |
| `FAILED` | 가져오지 못했어요 + FE-owned guidance — never the server's raw message |
| `RUNNING` | **완료되지 않았어요** — see below |
| `method = null` | 방식 미상 — never guessed |

**Why `RUNNING` does not say "진행 중".** Uploads are synchronous, so a persisted `RUNNING` row is in
practice an import that died mid-flight — and nothing polls, so "in progress" would keep asserting
progress about a run that ended days ago. "완료되지 않았어요" is true whether it is still in flight or
crashed.

**Scope stated in the copy.** The sub-heading names the two paths this covers (file upload,
seller-center export) rather than claiming to be every review ever collected — see finding #1.

## 4. Findings recorded, not absorbed

**#1 — API-collected reviews are invisible to this history, by construction.** An API sync run
(`SyncRunExecutor.startJob`) sets `dataType='REVIEW'` and leaves `uploadType` null, and
`Cafe24ApiConnector` declares `REVIEW` supported. A seller whose reviews arrive that way sees "아직
가져온 리뷰가 없어요" — which is why the sub-heading now names the paths it covers. Widening the
predicate to `OR dataType='REVIEW'` is a real option, but an API pull and a file import are different
acquisition events whose counts mean different things, and merging them is a product decision.

**#2 — the existing unified run history cannot see uploads at all.**
`CollectControlService.listRuns` fetches top-200 and filters **in memory** before limiting (the same
truncation hazard), and both of its usable filters miss uploads: `dataType` is null for every upload,
and `sellerAccountId` is too — which is why `ChannelDetail`'s run list silently excludes every file
and export import today. Reported; not fixed inside a UI slice.

## 5. Independent review — what it caught

An adversarial pass ran before commit and found real defects, all fixed: the heading over-claimed
(finding #1 above); `ActiveRunCard` still promised a "최근 활동" section that production no longer
renders; `CompletedResult` pointed at a rail that is not on that page; the query sorted by
`createdAt` while the UI displayed `finishedAt`; the ordering test asserted only that two calls agree
(passing for ascending order, or for no `ORDER BY` at all); the controller had **no test**; `RUNNING`
claimed progress forever; there was no index; the demo-mode branch was missing, so `/operations`
would show a permanent red alert under `VITE_USE_MOCKS`; the "bounded page" assertion checked only
`typeof number`; and the DTO shipped a `channelId` nothing renders.

**Falsified before trusting:** removing the predicate from the query fails two backend tests;
letting a failed read fall back to the empty state fails the fail-closed test.

## 6. Tests

Backend `ReviewImportHistoryTest` (10) — selects only review imports; org-scoped; **filters before
limiting** (one import buried under 30 newer unrelated jobs); newest-first **by the displayed
instant** (a long import that started first and finished last sorts above a short later one); a
running row sorts by its start; ties are stable across reads; provenance including null;
every outcome; and the raw `errorMessage` absent by reflection. `ReviewImportControllerTest` (5) —
org from the principal, and limit clamping in both directions.

Frontend `importHistory.test.ts` (13) + `ImportHistoryList.test.tsx` (8) — one per state, the
error-is-not-empty rule both directions, a bounded request, and **survival across a remount**, the
property the in-memory rail failed.

Backend **1433** (was **1418**, the branch head before this slice: +10 `ReviewImportHistoryTest`
+ 5 `ReviewImportControllerTest`) · frontend **691** (was 668: +13 `importHistory` + 8
`ImportHistoryList` + 1 `OperationsHome`, +1 rewritten) · collector **4843/95** unchanged · all
typechecks clean.

⚠ An earlier draft of this line said "was 1425". That number was a mid-slice measurement taken
before the ordering test was split and the controller test existed — it corresponds to no commit.
In a doc that advertises attributed deltas, an unattributable baseline is the drift.

## 7. Final pre-merge review (PR #326)

A third independent pass reviewed the whole branch against `origin/main` for security/privacy,
migration safety, API/query correctness, reply-state semantics, frontend honesty and documentation
claims. **No blockers.** It verified: no cross-org leakage; `errorMessage`/`channelId` genuinely
absent; both committed workbooks synthetic (unzipped and inspected) with matching SHA-256s; V21/V22
additive, idempotent and valid on PostgreSQL 15; the monotonic rule unbypassable; the 409 enforced in
the service rather than only in `capabilities`; and every stated test count accurate.

Fixed in response:

- **The PII-sentinel assertion was vacuous.** It asserted over `Review.toString()`, but these entities
  carry only `@Getter/@Setter` — no `@ToString` — so it compared against an identity hash and could
  never fail, while the slice doc cited it as proof. It now asserts over the stored fields by name,
  and was falsified (a probe against a string the body *does* contain fails it).
- **An unattributable test baseline** ("was 1425" — a mid-slice number matching no commit).
- **Two overstated claims about the ordering/index**, corrected above.

Recorded as follow-ups, not fixed here (no new scope in a pre-merge pass):

- `IngestionService` runs `findReview` and then `existsReview` with the same predicate on the insert
  path for any row carrying a reply statement — the second query is redundant.
- `ReviewImportHistoryTest`'s running-row ordering case sets `createdAt == startedAt`, so it cannot
  falsify the fallback-column difference it is named for.
- `ReviewImport.startedAt` is typed non-nullable on the wire while `SyncJob.startedAt` is nullable;
  a row with both timestamps null would render a fabricated date.
- V22 uses plain `CREATE INDEX`, not `CONCURRENTLY` (Flyway would need it outside a transaction) — a
  stated trade-off on a table that grows once per import.
- `AttentionSignalList`'s "**현재** 확인이 필요한 리뷰 N건" is window-scoped by the selector above it,
  so "현재" claims a present-tense total the data does not support.
- The two attention cards (1–2★, 3★) still drill into one shared 1–3★ list — pre-existing, and the
  new comment about count/list agreement reads as if it were resolved.

## 8. Open

- Per-row **channel attribution** when a second channel reaches this history — as a readable label,
  not the raw id that was deliberately dropped.
- **No refetch**: the rail reads once on mount. A run completing elsewhere in the same session is
  reflected on the next visit, not live.
- Finding #1's product decision, and finding #2's defects in the shared run-history read.
