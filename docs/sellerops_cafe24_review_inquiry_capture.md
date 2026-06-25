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

## Bounded persistence verification (PR D)

The shape is verified, but **`CONFIRMED` requires a persisted end-to-end run**. PR D
adds the **date-window backfill seed** and a **bounded, supervised** persistence
verification path — REVIEW/INQUIRY stay `NEEDS_VERIFICATION` until that run lands.

**Permanent foundation (committed):**

- **`Cafe24ArticleCursor` carries an optional date window** —
  `"b<board>:o<offset>:s<start>:e<end>"`. When seeded, the connector passes
  `start_date`/`end_date` to the articles endpoint and `advance()` preserves the
  window across pages; an unseeded cursor is the prior plain offset sweep. This is the
  backfill seed — no runtime contract change. Decoding is defensive (half-window or
  malformed date → no window).
- **`Cafe24ApiConnector.fetchArticles`** now reads the window from the cursor.
- The end-to-end path (windowed `fetch` → `CanonicalCommunityArticle` →
  `ingestCommunityArticles` → hash-guarded upsert) is proven offline over fakes:
  insert, idempotent no-op, in-place update, cursor advance, and the **REVIEW→4 /
  INQUIRY→6** routing (board 9 never requested).

**Temporary verifier (used once, then removed):** a doubly-flag-gated
`POST /api/diagnostics/cafe24/article-persistence/{accountId}`
(`sellerops.connector.cafe24.article-persistence-verification.enabled`) drove the
one supervised live run below. It was **bounded by construction** — boards 4 & 6
only, a date window, page limit clamped to ≤3 — and persisted **only through the
normal path** (`connector.fetch` + `ingestCommunityArticles`, **not**
`SyncRunExecutor`, so it created **no** sync_jobs or sync_cursors). An optional
`runTwice` re-ran the same bounded page in one execution to demonstrate the no-op.
Its sanitized output was structural only. The controller has been **removed** in this
PR (like the shape verifier before it) — only the permanent foundation above remains.

### Outcome — bounded persistence **live-verified** for boards 4 and 6

One supervised execution
(`POST …/article-persistence/{accountId}?limit=3&runTwice=true&startDate=2026-01-01&endDate=2026-06-25`,
HTTP 200) persisted real board articles end-to-end through the normal ingestion path.
Sanitized evidence:

- **`tokenRotated = true`** — the connector refreshed and rotated the single-use
  refresh token via the normal credential path.
- **`cafe24_community_articles` for the test seller account: before 0 → after 6
  (delta +6).** These **6 rows were intentionally persisted** in the dev DB and are
  **left in place** as live evidence (3 reviews on board 4, 3 inquiries on board 6).
- **REVIEW / board 4** — pass 1: fetched 3, inserted 3, updated 0, no-op 0, failed 0,
  rateLimited false, cursor `b4:o0:s…:e…` → `b4:o3:s…:e…`; pass 2 (same window):
  fetched 3, inserted 0, updated 0, **no-op 3**, failed 0, cursor unchanged window.
- **INQUIRY / board 6** — pass 1: fetched 3, inserted 3, updated 0, no-op 0, failed 0,
  rateLimited false, cursor `b6:o0:s…:e…` → `b6:o3:s…:e…`; pass 2 (same window):
  fetched 3, inserted 0, updated 0, **no-op 3**, failed 0, cursor unchanged window.

What this **live-verified**:

- **Insert path** end-to-end through `connector.fetch` → `CanonicalCommunityArticle`
  → `ingestCommunityArticles` → hash-guarded upsert.
- **Natural-key dedupe + `source_hash` no-op** — the identical second pass inserted and
  updated **zero**; the +6 delta equals exactly the 6 first-pass inserts (no
  duplication).
- **Date-window cursor seed** — both boards fetched with the seeded
  `s2026-01-01:e2026-06-25` window and the cursor advanced `o0 → o3` while preserving
  the window.
- **Board 9 remains excluded** — it was never requested; routing is REVIEW→4,
  INQUIRY→6 only.
- No rows were skipped for missing `article_no`; no failures and no rate-limits
  occurred.

Privacy: the run printed **no** article titles, article contents, writer/customer
names, contact/address fields, order IDs, raw response body, or secrets — only the
structural counts and cursors above.

**Not verified by this run:** `SyncRunExecutor` and its `sync_jobs` / `sync_cursors`
were **bypassed by design**, so the production scheduling/runtime path is **not**
exercised here. The **answered** `reply_status` token also remains unobserved (only
`N → PENDING` seen; unknown/unobserved tokens stay `UNKNOWN`). Accordingly,
`REVIEW`/`INQUIRY` **remain `NEEDS_VERIFICATION`** until the production
backfill/incremental runtime (through `SyncRunExecutor`) is verified.

## Production runtime backfill + incremental (PR E)

PR D proved persistence through a **bypass** verifier (no `SyncRunExecutor`, no
`sync_jobs`/`sync_cursors`). PR E moves the whole bounded backfill onto the
**normal runtime** — the same `SyncRunExecutor` that scheduled/manual collection
already uses — and designs incremental on top of it. The PR E **code change**
makes **no live Cafe24 call** and runs no scheduler/sync — it is the offline
runtime path plus tests. The **live** production-runtime verification that followed
(a separate gated step) is recorded in the *Outcome — production runtime
live-verified* subsection below. `REVIEW`/`INQUIRY` stay `NEEDS_VERIFICATION`.

**Three distinct verification layers** (do not conflate them):

1. **Shape verification (PR C)** — a read-only live `/articles` read confirming the
   endpoint shape, date-filter params, `rating` presence, and the `N` reply token.
   No persistence.
2. **Bounded persistence verifier (PR D)** — a temporary, flag-gated diagnostic that
   **bypassed** `SyncRunExecutor` (so it wrote **no** `sync_jobs`/`sync_cursors`) to
   prove only the ingestion/upsert path; it persisted 6 rows, then was removed.
3. **Production-runtime backfill (PR E, below)** — the **normal** `SyncRunExecutor`
   path via `POST /backfill`, writing real `sync_jobs` + `sync_cursors`. This is the
   layer the live REVIEW + INQUIRY runs exercised.

### The one missing piece: seeding a *bounded* window through the runtime

The runtime was already able to run Cafe24 `REVIEW`/`INQUIRY` end to end — the
connector serves both, `fetchArticles` reads the date window from the cursor, and
`SyncRunExecutor.ingestPage` routes community-article pages to
`ingestCommunityArticles`, advancing `sync_cursors` per page and recording
`sync_jobs`. What was missing: on a **first** run `loadOrCreateCursor` creates an
empty cursor → the connector decodes "no window" → an **unbounded** offset sweep of
the entire board. A bounded backfill needs the operator's `[start, end]` window
seeded **as the run's first cursor**, written by the runtime (not a side channel).

The seam (smallest safe, zero churn to other connectors):

- **`PullConnector.backfillCursor(dataType, start, end) → Optional<String>`** — a
  default method returning `empty()` ("this connector cannot serve a windowed
  backfill"). Every other connector (mock, Naver, Coupang, ESM, …) inherits the
  default unchanged — no `switch`/enum edits, no new `DataType`.
- **`Cafe24ApiConnector`** overrides it: `REVIEW` → board 4 window, `INQUIRY` →
  board 6 window (`Cafe24ArticleCursor.window(...).encode()`); `ORDER_SUMMARY`
  self-windows and product/sales aren't collected here, so all three return empty.
- **`SyncRunExecutor.execute(..., BackfillWindow)`** (an overload; the existing
  4-arg `execute` delegates with no window) asks the connector for the seed; an
  **empty** seed **fails closed** as a config error — never a fall-through to the
  unbounded sweep. The seed is written to the `SyncCursor` **inside `runPages`**,
  so the seed and every subsequent advance share the **one** `sync_cursors` path.
  `sync_jobs` and `sync_cursors` are still written **only by the runtime**.
- **`BackfillWindow.of(start, end)`** validates the window closed (both bounds
  required; `start ≤ end`); **`CollectControlService.manualBackfill`** + a
  dedicated `POST /api/seller-accounts/{id}/backfill` (`BackfillRequest`) are the
  operator trigger — a synchronous **MANUAL** run, never the scheduler.

### Backfill request shape (user-selected initial backfill)

- **`startDate` / `endDate`** — Cafe24 **KST** calendar dates (the platform's
  explicit zone), passed straight to the articles `start_date`/`end_date` filter.
  This is a collection window, not a recency signal — it carries no time-of-day and
  never feeds `eventTimeMs`.
- **Board 4 / 6 only** — expressed through `REVIEW`/`INQUIRY`; the connector maps
  each to its primary board. **Board 9 (1:1 맞춤상담) is never requested.**
- **Page size** — the runtime default (`SyncRunExecutor.PAGE_LIMIT = 50`) for this
  first verification. A *user-selected* page size is **deferred by decision**: it
  would thread an override through the shared executor and every connector's
  `request.limit()` contract, widening the blast radius beyond this slice. A long
  range simply pages internally at 50 under the `MAX_PAGES` guard.

### Incremental sync (design)

Incremental re-uses the **same mechanism**: re-seed a **trailing overlap window**
(e.g. `[lastEnd − overlapDays, today]`, KST) at offset 0 and run through
`SyncRunExecutor` again. The **hash-guarded upsert** absorbs the result — new
articles insert, edited articles / reply-status changes update in place, unchanged
rows **no-op** — exactly as `ORDER_SUMMARY` already self-heals its trailing window.
A manually-triggered overlap re-scan is covered by the backfill trigger today;
**automatic scheduled** incremental (a per-board high-water mark + clock-derived
trailing window) is a later, separately gated step and is **not** wired in PR E.

### Verified offline (through `SyncRunExecutor`, no network)

`Cafe24ArticleBackfillFlowTest` drives the **real** executor against the **real**
connector over the recording fake + H2:

- a seeded `REVIEW` backfill bounds **board 4** (window reaches the GET; cursor
  seeded and advanced through `sync_cursors`);
- a seeded `INQUIRY` backfill bounds **board 6** and **never requests board 9**;
- the cursor **advances across pages preserving the window** (offset 0 → 50, board
  4, still windowed);
- a **repeated same-window** backfill is an **idempotent no-op** — re-seed at
  offset 0, re-fetch, natural-key/`source_hash` dedupe → 0 inserted, **no duplicate
  rows**.

`SyncRunExecutorTest` adds the fail-closed guard: a backfill on a connector with no
`backfillCursor` seam is a **config failure**, not an unbounded sweep (no cursor
seeded, no health touched). `BackfillWindowTest` covers the window validation.

### Outcome — production runtime **live-verified** (REVIEW + INQUIRY)

Two supervised live runs (one each, `REVIEW` then `INQUIRY`) drove the **normal
runtime** — `POST /api/seller-accounts/{accountId}/backfill` →
`CollectControlService.manualBackfill` → `SyncRunExecutor` →
`Cafe24ApiConnector.fetch` → `IngestionService.ingestCommunityArticles` →
`cafe24_community_articles` — writing real `sync_jobs` and `sync_cursors`. No
scheduler, no `manualSync`, no verifier, no comments/urgent-inquiry fetch. Each run
was bounded to the **narrowest date window that covers the existing dev rows for its
board**, chosen from safe DB metadata (`board_no`, `source_created_at` dates) only.

**REVIEW — board 4** (window `2026-04-09 … 2026-06-25`):

| field | value |
| --- | --- |
| HTTP / job status | 200 / `SUCCESS` |
| `sync_job` id | `a1facd0f-da3c-4921-82d8-7dc99c0bdf7d` |
| `sync_cursor` before → after | none → `b4:o3:s2026-04-09:e2026-06-25` |
| fetched / inserted / updated / no-op / failed | 3 / 0 / 0 / 3 / 0 |
| account article count before → after → Δ | 6 → 6 → **+0** |
| board 4 used / board 6 used / board 9 used | yes / no / no |

Live-verifies the production-runtime **`sync_job` creation, `sync_cursor`
seed+advance, board-4-only routing, and idempotent no-op** over existing rows.
**Caveat:** the chosen window returned only the already-captured rows, so REVIEW did
**not** live-observe a *fresh insert* through the production runtime (that path is
covered offline by `Cafe24ArticleBackfillFlowTest`).

**INQUIRY — board 6** (window `2026-05-06 … 2026-05-06`, single day):

| field | value |
| --- | --- |
| HTTP / job status | 200 / `SUCCESS` |
| `sync_job` id | `830d8639-3cee-4d88-ac12-0e829b0ec801` |
| `sync_cursor` before → after | none → `b6:o905:s2026-05-06:e2026-05-06` |
| fetched / inserted / updated / no-op / failed | 905 / 902 / 0 / 3 / 0 |
| account article count before → after → Δ | 6 → 908 → **+902** |
| `reply_status` tokens (normalized) | `PENDING` = 905 |
| window bounding | all 905 rows `source_created_at` = 2026-05-06; 0 outside; 0 null |
| board 6 used / board 4 used / board 9 used | yes / no / no |

Live-verifies the production-runtime **`sync_job` creation, `sync_cursor`
seed+advance, multi-page cursor advance (~19 pages, offset 0 → 905, window
preserved), board-6-only routing, fresh inserts, and idempotent no-op** in one run.
The REVIEW `sync_cursor` and board-4 rows were untouched by the INQUIRY run.

**Data left in place (intentional):** the **6** prior dev verification rows remain,
and the **902** new real board-6 inquiry rows persisted by the INQUIRY run are
**intentionally retained as production-runtime verification data** — not deleted.

**Reply-status normalization is unchanged:** `N → PENDING` only. Every token observed
across both boards is `PENDING`. The **answered** token is still **unobserved** —
unknown/unobserved tokens stay `UNKNOWN` and are **not guessed or mapped**.

**Board 9 (1:1 맞춤상담)** was never requested and remains **excluded and unverified
for persistence**.

**Privacy:** the runs printed only structural counts, cursors, job ids, and the
`reply_status` enum token — **no** article titles, article contents, raw Cafe24
response bodies, writer/customer identifiers, contact/address fields, order ids,
`mall_id`, or secrets.

### Route to `CONFIRMED`

The runtime path is real, tested offline, **and now live-verified** for both
`REVIEW` and `INQUIRY` (`sync_jobs`/`sync_cursors` written by the normal runtime,
cursor seed+advance, board-4/6-only routing, insert + idempotent no-op). Remaining
gates before `REVIEW`/`INQUIRY` can move from `NEEDS_VERIFICATION` to `CONFIRMED`
(**each its own gated step, requires explicit approval**):

1. **The answered `reply_status` token** — still unobserved (only `N → PENDING`
   seen; all live rows `PENDING`); unknown tokens stay `UNKNOWN` and must not be
   guessed.
2. **Date-filter exclusion not yet proven** — both live windows happened to contain
   only in-window rows (REVIEW returned the existing 3; INQUIRY's board 6 is entirely
   dated 2026-05-06, 0 outside). A window that **excludes** known rows is needed to
   prove the `start_date`/`end_date` filter actively *rejects* out-of-window
   articles (vs. the board simply having no out-of-window rows).
3. **REVIEW fresh insert through the production runtime** — observed offline only;
   not yet live (REVIEW's live window returned no new rows).

## Forward plan (later, separately gated PRs)

- **Initial backfill** — the date-range trigger and runtime seed now exist (PR E:
  `BackfillWindow` + `manualBackfill` + `POST /backfill`, seeded through
  `SyncRunExecutor`). Still future: a user-facing preset UI (recent-30/90/180 +
  custom) and a configurable page size / long-range chunking.
- **Incremental sync** — the overlap-window mechanism is designed and reachable via
  the backfill trigger (PR E). Still future: **automatic scheduled** incremental (a
  per-board high-water mark + clock-derived trailing window), separately gated.
- **Live-shape verification** — **done** (PR C): the articles endpoint, date-filter
  params, and `rating` presence are confirmed for boards 4 and 6, and the `N` reply
  token is mapped.
- **Bounded persistence verification** — **done** (PR D): one supervised bypass run
  persisted 6 rows and live-verified insert, natural-key/`source_hash` no-op, and the
  date-window cursor seed.
- **Production runtime path** — **done offline + live-verified** (PR E): bounded
  backfill through `SyncRunExecutor` (writing `sync_jobs`/`sync_cursors`), proven by
  tests and by one supervised live run each for `REVIEW` (board-4 no-op) and
  `INQUIRY` (board-6 multi-page insert + no-op). See *Outcome — production runtime
  live-verified* above. Still open before `CONFIRMED`: the **answered**
  `reply_status` token (unobserved), a **window that excludes known rows** (to prove
  the date filter rejects out-of-window articles), and a **live REVIEW fresh insert**
  (observed offline only).

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
