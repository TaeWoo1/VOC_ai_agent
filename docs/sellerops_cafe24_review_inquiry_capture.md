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

## Forward plan (later, separately gated PRs)

- **Initial backfill** will be **date-range based** (user-selected start/end with
  recent-30/90/180 + custom presets), split into ~30-day chunks, paginated with
  limit/offset, the plan seeded into the connector's opaque cursor — no runtime
  contract change.
- **Incremental sync** will use a per-board high-water mark plus a small **overlap
  window**, relying on the **hash-guarded upsert** to absorb edited articles and
  reply-status changes cheaply (unchanged rows no-op).
- **Live-shape verification** (one supervised, sanitized call) will confirm the
  articles endpoint, date-filter semantics, rating presence, and the concrete reply
  tokens before the connector maps them onto the canonical reply states.

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
