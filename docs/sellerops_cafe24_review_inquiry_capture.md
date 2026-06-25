# Cafe24 Review/Inquiry Article Capture — storage foundation (PR A)

The capability that turns the confirmed Cafe24 community boards into a durable VOC
data asset. **PR A is the offline storage foundation only**: the canonical table,
its hash-guarded upsert, field normalization, and the dormant ingestion route. No
Cafe24 client, no live call, no scheduling change yet — those are later, separately
gated PRs.

Confirmed VOC-bearing boards on the target mall (from Board Discovery):
`board_no=4 구매후기` (review), `board_no=6 문의사항` and `board_no=9 1:1 맞춤상담`
(inquiry).

## Why a dedicated table (not the shared `reviews`/`inquiries`)

The shared `reviews`/`inquiries` tables are **insert-only and intentionally thin**
(org, channel, product, body, rating/status, dedup hash). Cafe24 community articles
need more and behave differently:

- **board/article identity** (`board_no`, `article_no`) as the natural key;
- a finer **`source_kind`** (`REVIEW` / `PRODUCT_INQUIRY` / `ONE_TO_ONE_INQUIRY` /
  `OTHER`) that the single REVIEW/INQUIRY split cannot express;
- a **`reply_status`** that *changes over time* (a 문의 gets answered) — requiring
  **in-place update**, which the insert-only tables do not do;
- **title**, **rating**, **product_no**, and **source timestamps**;
- **`seller_account_id` scoping** in the key (the same article number recurs across
  malls).

Forcing these into the shared tables would mean either dropping fields or an invasive
schema + semantics change to tables shared by NAVER, file-upload, and item-analysis.
So article capture gets its own table: **`cafe24_community_articles`** (migration V7).

## Why `DataType.REVIEW` / `DataType.INQUIRY` are reused — at runtime only

Article capture is recurring operational collection, so it fits the existing
per-(seller account × data type) **runtime/scheduling** model: `DataType.REVIEW`
(board 4) and `DataType.INQUIRY` (boards 6 + 9) drive capabilities, sync jobs, and
cursors — **no new enum, no exhaustive-switch churn**. The data types are reused for
*orchestration*; the *storage* target is the dedicated table. The bridge is a small
**source-aware route** in `SyncRunExecutor.ingestPage`: a page whose records are
`CanonicalCommunityArticle` lands via `IngestionService.ingestCommunityArticles`
instead of the shared review/inquiry path. This route is **dormant** in PR A —
existing connectors never emit that record type; it activates when the Cafe24
community article connector lands (a later PR).

## Storage model (`cafe24_community_articles`, V7)

Columns: `id, org_id, seller_account_id, channel_id, board_no, article_no,
source_kind, product_no?, title?, content?, rating?, reply_status, source_created_at?,
source_updated_at?, source_hash, collected_at, created_at, updated_at`.

- **Natural key (unique):** `(channel_id, seller_account_id, board_no, article_no)`.
- **`content` is nullable on purpose** — the live article shape and the
  private/1:1 (board 9) body behavior are not yet verified; the schema must not force
  a body we may choose to redact or omit.
- **`source_hash`** is a stable fingerprint over the *mutable* fields
  (title, content, rating, reply_status). It drives the upsert decision; `source_kind`
  and the identity columns are not part of it.

### Hash-guarded upsert

`ingestCommunityArticles(org, channel, sellerAccount, rows)`:

1. dedupe the batch by `(board_no, article_no)`;
2. normalize `source_kind` → `CommunitySourceKind`, `reply_status` →
   `CommunityReplyStatus` (closed sets; unknown/blank → `OTHER` / `UNKNOWN`);
3. compute `source_hash`;
4. **insert** if the natural key is absent; **update mutable fields** if it exists and
   the hash changed; **no-op** if the hash is unchanged. Inserts contribute an id to
   `insertedIds`; updates count as success but contribute no id.

## Article capture wiring (PR B)

The Cafe24 client + parser + connector `fetch` path that produces
`CanonicalCommunityArticle` records — **offline, doc-asserted, `NEEDS_VERIFICATION`**.
No Cafe24 call, no OAuth; the connector stays flag-gated.

- **`Cafe24BoardArticlesClient`** reads one page of
  `GET /api/v2/admin/boards/{board_no}/articles` (Bearer, `mall_id` host guard,
  `board_no` guard, optional `start_date`/`end_date`, `limit`/`offset`). 429 →
  `Cafe24RateLimitedException`; non-200 → HTTP-coded throw with **no response body
  in the message** (articles carry writer/customer data). Read-only
  (`mall.read_community`) — never writes a post.
- **`Cafe24BoardArticleRow`** projects `article_no, title, content, product_no,
  rating, created_date, updated_date, reply_status` — every field nullable so an
  unexpected/missing value is tolerated.
- **`Cafe24BoardArticleMapper`** maps a row → `CanonicalCommunityArticle`, deciding
  `source_kind` from the board (4 구매후기 → `REVIEW`, 6 문의사항 →
  `PRODUCT_INQUIRY`, 9 1:1 맞춤상담 → `ONE_TO_ONE_INQUIRY`). Raw `reply_status` is
  passed through (ingestion normalizes it); timestamps parse **only when offset-
  bearing** — timezone-less/unknown stays `null`, never an assumed zone.
- **`Cafe24ApiConnector.fetch`** now serves `REVIEW` (board 4) and `INQUIRY`
  (board 6) by paging articles via an opaque board+offset cursor
  (`Cafe24ArticleCursor`, `"b<board>:o<offset>"`); the executor pages while
  `hasMore`. A row missing `article_no` is dropped. The shared fail-closed
  credential chain (vault → shape check → refresh → single-use rotation) is reused.
- **Capability:** `REVIEW`/`INQUIRY` are now exposed as **`NEEDS_VERIFICATION`**
  (not `CONFIRMED`); `ORDER_SUMMARY` stays `CONFIRMED`. The endpoint shape,
  `reply_status` tokens, `rating` presence, and the date-filter parameter names are
  doc-asserted and confirmed only at the gated **live-shape verification (PR C)**.

**Board 9 (1:1 맞춤상담) is a deliberate follow-up, not wired in PR B:** it is the
highest-PII surface (its body-handling policy is still open), and whether it is read
via board articles or a dedicated endpoint is unverified. The mapper knows its
`source_kind`, but `INQUIRY` fetch currently fans out to board 6 only.

## Live shape verification (PR C)

The **endpoint shape** was confirmed by **one supervised, sanitized** call against
the real target mall (a temporary, doubly-flag-gated verifier, since removed —
exactly like the Board Discovery verifier). Evidence is **structural only**: HTTP
status, JSON key names, per-field presence, and enum-like `reply_status` tokens —
**never** an article title/content value, writer/customer field, raw body, `mall_id`,
or token. One refresh-token rotation was persisted; no articles/`sync_jobs`/
`sync_cursors`/`cafe24_community_articles` rows were created.

### Outcome — board article endpoint shape **live-verified** for boards 4 and 6

| field | board 4 (구매후기 / REVIEW) | board 6 (문의사항 / PRODUCT_INQUIRY) |
|---|---|---|
| HTTP status | 200 | 200 |
| envelope keys | `articles`, `links` | `articles`, `links` |
| rows sampled | 3 | 3 |
| `article_no` present | yes | yes |
| `title` present | yes | yes |
| `content` present | yes | yes |
| `product_no` present | yes | yes |
| `rating` present | yes | yes |
| `created_date` present | yes | yes |
| `updated_date` present | **no** | **no** |
| `reply_status` enum-like token | *(none in sample)* | **`N`** |
| date filter (`start_date`/`end_date`) | tested → HTTP 200 | tested → HTTP 200 |

The capture projection (`article_no, title, content, product_no, rating,
created_date, reply_status`) matches the live field names. The response also carries
**PII-bearing keys** (`writer, writer_email, member_id, client_ip, order_id`, plus a
`secret`/비밀글 flag) which the connector **intentionally does not project**.

**Confirmed:**
- the `{"articles":[…]}` envelope and the capture field names exist on the real mall;
- `rating` is present on the review board (4) and `product_no` on both;
- the `start_date`/`end_date` date-filter params are accepted (HTTP 200) — validates
  the backfill window.

**`reply_status`:** `N` (no-reply / 미답변) is now mapped to `PENDING`
(`CommunityReplyStatus`). The **answered** token was **not observed** (the sampled
rows were unanswered) and is deliberately **not guessed** — it stays `UNKNOWN` until a
later sample pins it down.

**`updated_date` is absent** in the live response (no source-side modified field), so
`source_updated_at` remains nullable and **change detection relies on `source_hash` +
the incremental overlap re-scan**, not a source timestamp.

### Status — precise

- **Endpoint shape: live-verified** for board 4 and board 6.
- **REVIEW/INQUIRY persistence + backfill: not yet `CONFIRMED`.** The connector
  capability for `REVIEW`/`INQUIRY` therefore **stays `NEEDS_VERIFICATION`** (no
  intermediate status exists in the capability model, and none is invented);
  `ORDER_SUMMARY` stays `CONFIRMED`. Promotion to `CONFIRMED` awaits a persisted
  end-to-end run and the answered-token mapping.
- **Board 9 (1:1 맞춤상담)** remains a follow-up: high-PII, **not included** in this
  verification, and **not wired** into `INQUIRY` fetch.

## Forward plan (later, separately gated PRs)

- **Initial backfill** will be **date-range based** (user-selected start/end with
  recent-30/90/180 + custom presets), split into ~30-day chunks, paginated with
  limit/offset, the plan seeded into the connector's opaque cursor — no runtime
  contract change.
- **Incremental sync** will use a per-board high-water mark plus a small **overlap
  window**, relying on the **hash-guarded upsert** to absorb edited articles and
  reply-status changes cheaply (unchanged rows no-op).
- **Live-shape verification** — **done** (see above): the articles endpoint,
  date-filter params, and `rating` presence are confirmed for boards 4 and 6, and the
  `N` reply token is mapped. Still open before `CONFIRMED`: a persisted end-to-end run
  and the **answered** reply token (unobserved so far).

## AI moat — source stays separate from AI outputs

`cafe24_community_articles` is the **source asset**. AI-derived data (summaries,
alerts, reply drafts, issue clusters, brand-response learning, and later
draft-accepted/edited/copied feedback) will live in **separate tables** keyed back to
the article — never written onto the source row. `source_hash` is the re-analysis
trigger: when it changes, downstream AI artifacts for that article are stale.

## Out of scope / guardrails

- **No Cafe24 community write** and **no automatic reply posting** — AI replies are
  internal drafts; intended later scope stays read-only (`mall.read_community`).
- **Never log** article bodies, titles, writer/customer identifiers, or `mall_id`;
  board 9 (1:1) is the highest-PII surface and its body-handling policy is an open
  decision before any live capture.
- PR A adds **no** Cafe24 client, makes **no** live call, and does **not** touch
  `DataType`, the scheduler, or Board Discovery's connector-internal status.
