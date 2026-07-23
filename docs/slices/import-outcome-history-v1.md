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
Ordering is `coalesce(finishedAt, createdAt) desc, id desc`: **the same instant the surface
displays**, because sorting on one timestamp while labelling rows with another is how a list shows an
older date above a newer one.

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
bounds the result, not the scan, and `sync_jobs` grows once per import forever.

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

Backend **1433** (was 1425) · frontend **691** (was 668) · collector **4843/95** unchanged · all
typechecks clean.

## 7. Open

- Per-row **channel attribution** when a second channel reaches this history — as a readable label,
  not the raw id that was deliberately dropped.
- **No refetch**: the rail reads once on mount. A run completing elsewhere in the same session is
  reflected on the next visit, not live.
- Finding #1's product decision, and finding #2's defects in the shared run-history read.
