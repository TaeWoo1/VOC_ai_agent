# Cafe24 Board Backfill Exact-Window Fix v1

**Status: fix committed offline; NOT a full INQUIRY_READ proof success.**
This records a live run that **disproved** the exact-window contract, and the fix that
restores it. Sanitized throughout: counts / booleans / dates / schema facts only — no
inquiry title/body, writer, member/email/IP/order identifiers, mall/account/org IDs,
tokens, or credential material.

## What the live run showed (HALT, not success)

A single live `POST /backfill {INQUIRY}` for the window **`2025-03-24 … 2025-03-24` KST**
(board 6, 전선몰딩, disposable env) returned SyncRun SUCCESS but ingested **2** board-6
inquiries, not the expected 1:

| row | source created date | reply token → canonical | secret |
|-----|---------------------|-------------------------|--------|
| A   | 2025-03-24 (in-window)   | `C` → ANSWERED        | secret |
| B   | **2025-03-27 (after end_date)** | none → UNANSWERED | secret |

Row B is a **distinct board-6 article** (different article number, different body; not a
reply or comment of row A) whose `created_date` is **after the requested `end_date`**. It
should never have been ingested for a single-day window, and it opened one OPEN work item.

**Observed correctly (but these do NOT amount to a passed proof):** the secret(비밀글)
classification (`is_secret=true` on both), the in-window `C → ANSWERED` mapping, board
isolation (board 4/9 untouched), and credential refresh-token rotation. The run is recorded
as a **HALT** because the exact-window contract failed; the approval was consumed.

We do **not** infer any meaning for row B's null reply token, and we do **not** retroactively
redefine the pre-run expectation from 1 to 2 — the expectation was correct; the runtime was
not clamping the window.

## Root cause

`Cafe24BoardArticlesClient` sends `start_date`/`end_date` to the Admin board-articles
endpoint, but the connector applied **no local window filter** — it emitted every fetched
row (minus the REVIEW-path secret exclusion). The platform's `start_date`/`end_date`
article filter is **doc-asserted, not contract-guaranteed** (a live-verification item), and
the live run proves it does not clamp by `created_date` as assumed: it returned an article
created after `end_date`.

The canonical `receivedAt` was **correctly** mapped from the article's `created_date` (not
`updated_date`) — so this is not a date-mapping defect. It is purely a **missing local
exact-window guard**.

## The fix — exact-window contract (shared REVIEW + INQUIRY boundary)

In `Cafe24ApiConnector.fetchArticlePage(...)` (the one boundary both REVIEW/board-4 and
INQUIRY/board-6 flow through), a row is emitted only when its own `created_date`, read as a
Cafe24 **KST** calendar date, satisfies `startDate <= createdDate <= endDate` (both ends
inclusive). Out-of-window rows are dropped **before** the mapper, ingestion, and any
work-item creation — their fields never reach storage or a log.

- **Fail-closed:** a missing or non-offset-bearing `created_date` is treated as
  out-of-window (dropped), never assumed in-window. (`Cafe24BoardArticleMapper.parseKstDate`
  returns `null`, and the guard drops on `null`.)
- **Scope:** enforced only on a windowed backfill cursor (`Cafe24ArticleCursor.hasWindow()`);
  a plain non-windowed offset sweep is unaffected. `ORDER_SUMMARY` self-windows on a
  different path and is untouched.
- **Pagination:** the cursor still advances by rows **fetched** (not emitted) and preserves
  the window, so a multi-page windowed sweep neither skips nor re-fetches — identical to the
  existing secret-exclusion handling.

## Observability (no new success enum, no telemetry system)

Out-of-window drops are surfaced as a **sanitized count** in the log
(`카페24 창 밖 게시글 제외: board=.. 제외건수=..`), mirroring the existing 비밀글 exclusion
count. No article id, date, title, content, or writer is ever logged. `FetchPage` carries no
per-drop field, so this stays inside the existing SyncRun contract.

## Tests

Connector unit (`Cafe24ApiConnectorTest`): single-day window drops a later-dated row (the
live repro); both boundaries inclusive; before-start and after-end excluded; null /
timezone-less `created_date` fail-closed; window preserved across the advancing cursor;
REVIEW path parity. Ingestion flow (`Cafe24InquiryIngestionFlowTest`): the out-of-window row
creates **no inquiry and no work item**, while the in-window `C` row stores ANSWERED,
`is_secret=true`, and opens no OPEN work item. Existing windowed fixtures were given a
realistic in-window `created_date`; the source-aware upsert and N→C tests are unchanged and
still assert their behavior.

Backend gate: full suite green. Independent correctness/privacy review: HIGH=0, MEDIUM=0.

## Disposable DB restore

The failed run's artifacts were removed from `cafe24_phaseb` precisely — the 2 board-6
inquiry rows, their one OPEN work item, and its audit — leaving board-6 baseline = 0, total
inquiries = 0, OPEN work items = 0. No other org/account/data touched; the connector
credential (row/payload/rotation timestamp), the 4 pre-existing daily order summaries, and
the historical FAILED/SUCCESS SyncRun records were left unchanged.

## Next INQUIRY_READ live attempt

Requires a **fresh single-use approval** (channel / account / date / operator). A valid
single-day proof now depends on the exact-window guard; the expectation for a given window
is whatever board-6 articles were genuinely **created** inside it (which may be 0, 1, or
more) — not a fixed count. No `/backfill`, OAuth reconnect, or channel call was performed to
produce this record.
