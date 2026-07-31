# Cafe24 REVIEW Acquisition Completion v1 — live proof (sanitized)

> **Sanitized record.** Counts, canonical statuses, and sanitized hashes only — **no** review
> title/content, writer/member id, email, IP, order id, `article_no`, mall/account/org id, OAuth
> code/state, token, or credential material appears here.

## Scope (as approved — single-use, in-turn)

- channel **Cafe24**, the already-bound **disposable 전선몰딩** account only
- disposable DB **`cafe24_phaseb` (127.0.0.1:55432)** — real `sellerops:5432` untouched
- data type **REVIEW**, **board 4 only** (board 6/9 never called; no order/product/inquiry/reply API; no write API)
- acquisition window **2026-06-29 … 2026-06-29 KST** (both ends inclusive)
- operations: **one read-only `/backfill` first run**, then **exactly one replay** (conditional on a clean first run)
- read-only toward Cafe24 (reads articles, writes only the local disposable DB); **no OAuth reconnect**

**Window basis (no pre-run data guessing).** Chosen strictly from existing sanitized DB evidence: a
read-only inspection of `cafe24_community_articles` (board 4, REVIEW, the bound account) found exactly
**1** existing board-4 review, whose `source_created_at` KST date is **2026-06-29** (the #375 row).
That is the only board-4-review-bearing KST date in the disposable DB, so it is the smallest (and only)
single-day window with nonzero rows.

## Environment

NORMAL-mode boot via `tools/cafe24-local/run-backend-local.sh` (vault master key + app client id/secret
from macOS Keychain; pre-boot decryptability gate passed → `decryptable=true`). Flyway validated 33
migrations, schema **V34, no migration necessary** (this branch adds none). Cafe24 Admin-API version
pinned `2025-12-01`; scheduler off; diagnostic boards off. Session JWT for the approved `/backfill` was
minted by resetting the **disposable-DB app-login** password to an ephemeral value (local dev app
password only — the Cafe24 marketplace OAuth credential was **not** touched); the ephemeral secret files
were shredded after the run.

## First run — `POST /backfill {REVIEW, 2026-06-29 … 2026-06-29}`

| check | observed |
|---|---|
| HTTP | 200 |
| SyncRun status | **SUCCESS** |
| totalRows / success / skipped / failed | **1 / 0 / 1 / 0** |
| stored board-4 REVIEW rows (after) | **1** (unchanged) |

The single in-window board-4 review **already existed** (stored by #375), so the live re-fetch matched
the stored `source_hash` and was an **idempotent skip** (0 insert, 0 duplicate, 0 failure). A fresh
board-4 insert was proven in #375 and is **not** re-exercised by this window.

### Sanitized connector accounting (new instrumentation, this unit)

```
board=4 수신=1 저장=1 비밀글제외=0 창밖제외=0 식별번호없음제외=0 reply_status[PENDING=0 IN_PROGRESS=0 ANSWERED=0 UNKNOWN=1]
```

- **raw_received (수신) = 1**, reconciles exactly as `저장(1) + 비밀글제외(0) + 창밖제외(0) + 식별번호없음제외(0)`.
  Note `저장`(stored) here = rows mapped/emitted to ingestion on the page, **not** net DB inserts — an
  idempotent skip still counts (this run: 저장=1 but net insert=0, skipped=1). Net persisted = SyncRun `success`.
- **reply_status distribution over stored rows: `UNKNOWN=1`** — the raw token was not `N`/`P`/`C` and
  normalized fail-closed to `UNKNOWN` (never inferred). This is the closed-vocabulary count the unit
  set out to record.
- No secret 비밀글, no out-of-window row, no missing-`article_no` row in this window.

## Replay — identical window, exactly once

| check | observed |
|---|---|
| HTTP / status | 200 / **SUCCESS** |
| totalRows / success / skipped / failed | **1 / 0 / 1 / 0** (identical) |
| stored rows | **1** (no new insert, no duplicate) |
| row fingerprint (article/status/hash/timestamps) | **unchanged** (`534b2bcf663c` before == after) |
| cursor | **stable** — `b4:o1:s2026-06-29:e2026-06-29` |
| accounting line | **identical** to the first run |

Idempotent replay confirmed on the real mall.

## Credential rotation (allowed)

The marketplace refresh credential rotated on each live call — the stored encrypted payload hash changed
across the two runs (`8df07e74` → `620bbfe6`), `updated_at` within minutes. The credential stayed
decryptable throughout; no OAuth reconnect occurred.

## Downstream (Operator Attention/VOC only — descoped by product-owner decision)

Cafe24 REVIEW community-articles surface **only** in the Operator Attention/VOC path; they are not fed
into `item_analyses` or the Issue-Memory / agent-runtime graphs, and **no such bridge was built** (that
would be a new path, out of scope).

- `GET /attention?from=2026-06-29&to=2026-06-29` → signal **`NEW_REVIEW` count = 1**: the stored public
  review is exposed in the operator queue.
- `item_analyses` total = **0** — a community article gets no analysis row (structural).
- INQUIRY untouched (`inquiries` = 1, the pre-existing #382 row); board 6/9 never called.

## Proof-level ledger for this unit

- **Live-proven (completion):** exact-window acquisition on the shared guard for REVIEW board-4;
  KST both-ends-inclusive filtering on the article's own `created_date`; idempotent replay (row
  immutable, cursor stable, zero duplicate); the new sanitized full-accounting instrumentation
  (raw_received / stored / secret-excluded / out-of-window / missing-`article_no` + reply_status
  distribution); credential rotation; Operator Attention/VOC exposure; zero analysis on community
  articles; no PII/id/token egress.
- **Live-observed, single value:** `reply_status = UNKNOWN` (the only value this window carried).
- **Still tests-only (NOT advanced by this window):** `reply_status` `N`/`P`/`C` tokens; 비밀글(secret)
  exclusion count (no secret in window); the secret exposure boundary; the divergence branches of the
  accounting (secret / out-of-window / missing-`article_no` were all 0 live). A **fresh** board-4 insert
  in this window was not exercised (the row pre-existed from #375).

## Post-run

Backend stopped; ephemeral app-login secret files shredded; disposable `cafe24_phaseb` left in its proof
state (board-4 REVIEW rows = 1); real `sellerops:5432` untouched. No push/PR/merge performed by the run
itself.
