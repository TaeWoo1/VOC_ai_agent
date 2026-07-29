# Cafe24 REVIEW_READ live verification + 비밀글(secret) fail-closed exclusion

Records the gated live `REVIEW` (board 4 구매후기) read proof on real Cafe24
(전선몰딩, disposable env), and the pre-live 비밀글 exclusion patch it exercised.
Sanitized: per-run counts, booleans, coarse categories, natural-key/hash lengths
only — **no** `mall_id`, tokens, credential, review title/content/writer, member id,
email, IP, or order id.

## Environment

Normal (non-diagnostic) backend, `sellerops.connector.cafe24.enabled=true`,
scheduler **off**, disposable Postgres `cafe24_phaseb`, the same reused Cafe24 app +
vault key + credential from the C1/C2 proof, Admin-API version pinned `2025-12-01`
(fail-closed). Read-only scopes incl. `mall.read_community`. Two supervised runs of
the wired operator path `POST /api/seller-accounts/{id}/backfill {dataType:REVIEW,
startDate,endDate}` → `CollectControlService.manualBackfill` → `SyncRunExecutor` →
`Cafe24ApiConnector.fetch(REVIEW)` → `IngestionService.ingestCommunityArticles` →
`cafe24_community_articles`. Board 4 only.

Window: **`2026-06-28 … 2026-06-29` (KST)** — deliberately two days, because the one
target review carries two timestamps (원 구매평 등록일 `2026-06-28 10:42` and Cafe24
게시판 반영일 `2026-06-29 02:42`); the window spans both rather than guessing one.

## 비밀글 fail-closed exclusion (the patch under proof)

The board-article response carries a `secret`(비밀글) flag the connector previously
ignored. Now the **review (board 4) path stores a post only when it positively reads
public**: `Cafe24BoardArticleRow.isPublicPost()` is true only for the documented
`"F"` token (or a `"false"` boolean coercion), trimmed/case-insensitive; `"T"`, null,
blank, or any unrecognized/changed value reads not-public and the row is **excluded
before mapping** — its title/content never reach the mapper, storage, or any log. The
cursor still advances by rows **fetched** (not stored), so a mixed public/private page
pages correctly. Only a sanitized exclusion **count** is logged (board no + count).
The gate is scoped to board 4; the INQUIRY (board 6) path is unchanged. Policy basis:
Cafe24 Admin `secret` is a `"T"`/`"F"` string flag (Admin-API convention; observed
present at the PR-C shape step). Official contract also fixes `reply_status ∈ {N,P,C}`.

## Counter model (observed vs unobserved — no overstatement)

`sync totalRows = success + skipped + failed` (`SyncRunExecutor.finishJob`) — i.e. the
**post-exclusion ingested** row count, **not** the raw API response count.

| counter | observability | this proof |
|---|---|---|
| `raw_received_count` | **미관측** — connector never records `rows.size()` | not asserted |
| `public_emitted_count` | `sync totalRows` | 1 |
| `secret_excluded_count` | connector INFO log only (fires only when > 0; operator console) | 0 (no log line; consistent with public==DB delta==1) |
| `missing_article_no_dropped_count` | **미관측** — silent drop, uncounted | not asserted |
| `fresh_insert_count` | board-4 DB row-count delta | run 1: +1; replay: +0 |

`raw_received = public_emitted + secret_excluded + missing_dropped` is therefore
**not fully verifiable** (two terms unobserved) and is **not** claimed. No
instrumentation was added for this proof.

## Run 1 — fresh insert — PASS (job `c0285d92`)

`status=SUCCESS`, `totalRows=1 success=1 skipped=0 failed=0`, `rateLimited=false`.

- **public_emitted = 1**, **fresh DB insert = 1** (board-4 rows 0 → 1).
- Stored row: `board_no=4`, `source_kind=REVIEW`, `article_no=3670` (natural key),
  `product_no=24`, `rating=5`, `title_present=true`, `content_present=true`,
  `source_hash` present (64-hex), `source_created_at=2026-06-29 02:42:54 KST`
  (the 반영일, inside the window).
- **`reply_status = UNKNOWN`** — see correction below.
- **secret_excluded = 0** (no exclusion log; consistent with the single windowed
  article being stored public).
- refresh grant + **single-use rotation write-back succeeded** (credential
  `updated_at` advanced); credential row stayed **1**.
- REVIEW `sync_cursor` seeded + advanced: none → `b4:o1:s2026-06-28:e2026-06-29`
  (window preserved, board 4 only).
- **Board 4 only** — no INQUIRY (board 6/9) job/cursor, no order/product API call.

### Correction: expected `PENDING` → actual `UNKNOWN` (live-observed)

The pre-run expectation was `reply_status = PENDING` (assuming a raw `N`). The live
result is **`UNKNOWN`**: the connector normalized the raw token to `UNKNOWN`, meaning
the raw `reply_status` was **not** `N`/`P`/`C` (null, blank, or unrecognized) — most
likely because this review is a **네이버페이 구매평**, which does not carry the native
board `reply_status="N"` a 문의 does. This is the connector's designed **fail-closed**
behavior (`CommunityReplyStatus`: unrecognized/blank stays `UNKNOWN`, never guessed).

- The `PENDING` expectation is **withdrawn**; `UNKNOWN` is adopted as the live result.
- The connector was **not** changed to infer `unanswered`/`PENDING`; no mapper edit.
- The **raw token is recorded as 미관측** (only the normalized value is persisted) and
  was **not** guessed.
- **`C → ANSWERED` live verification remains a known limitation** — no answered review
  was in scope, so the answered token is still unobserved.

## Run 2 — idempotent replay (same window) — PASS (job `9bf2537d`)

`status=SUCCESS`, `totalRows=1 success=0 skipped=1 failed=0`, `rateLimited=false`.

- **fresh insert = 0**, **no-op skip = 1**; board-4 DB row count **1 → 1** (no
  duplicate).
- Article **immutable**: `article_no=3670` unchanged, `source_hash` identical,
  `reply_status=UNKNOWN` unchanged, `updated_at`/`collected_at` unchanged (a hash-equal
  no-op never rewrites the row), `title`/`content` presence unchanged.
- refresh + **rotation re-succeeded** (credential `updated_at` advanced again);
  credential row stayed **1**.
- REVIEW `sync_cursor` re-seeded at offset 0 and re-advanced to
  `b4:o1:s2026-06-28:e2026-06-29` (window preserved).
- **Board 4 only** — no INQUIRY/board-9/order/product call.

Idempotency holds by construction (natural-key + `source_hash` upsert; unchanged hash
→ no-op), now live-proven for the REVIEW path on the hardened connector.

## PII non-storage (verified)

`cafe24_community_articles` schema carries **no** `writer`, `writer_email`,
`member_id`, `client_ip`, `order_id`, or `secret` column — those response keys are
never projected (`Cafe24BoardArticleRow` reads 9 fields only) and cannot be stored.
The 비밀글 flag is used only to gate storage and is itself never persisted. The runs
printed only counts, booleans, natural keys, and hash lengths — never a review
title/content value, writer/customer identifier, `mall_id`, or secret.

## Boundary / honesty

- Two supervised gated runs on a disposable env; no committed test hits live Cafe24 —
  CI evidence stays synthetic. The single windowed review did not exercise a multi-page
  sweep or an actual secret exclusion (`secret_excluded=0`); those are covered offline
  by tests (mixed/all-secret pages, cursor-advance-by-fetched, DB no-leak, replay).
- **Known limitations (open, not blockers):** answered `reply_status` (`C → ANSWERED`)
  still unobserved; `raw_received_count` and `missing_article_no_dropped_count` are
  unobserved by current code (a small sanitized-count instrumentation is a possible
  follow-up, not done); date-filter *rejection* of out-of-window rows not separately
  exercised here (single in-window article).
