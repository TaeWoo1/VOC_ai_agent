# Cafe24 Community Board Discovery — design + verification plan

The first slice toward collecting Cafe24 **reviews and inquiries**. On Cafe24 those
live inside community **boards** (게시판), so before any capture we need a
`board_no → REVIEW / INQUIRY / OTHER` mapping. This slice ships that **Board
Discovery** read capability: the connector stays flag-off by default
(`sellerops.connector.cafe24.enabled`), and the capability is **`CONFIRMED`** by one
supervised live `/boards` read against the real target mall (see
[Live verification](#capability-status--confirmed) below).

## Scope

- **In:** enumerate the mall's boards (metadata only) and classify each as
  review-bearing, inquiry-bearing, or other.
- **Out (later PRs):** article/post body capture; mapping discovered boards into a
  real REVIEW/INQUIRY collection; `urgentinquiry` (긴급문의) as a follow-up candidate.
- **Never:** community **write**. AI replies are SellerOps-internal drafts; the
  connector does not post to Cafe24. Intended later OAuth scope set is Product read +
  Order read + **Community read** (`mall.read_community`) only.

## Why Board Discovery is *not* a `DataType`

`DataType` (`REVIEW, INQUIRY, ORDER_SUMMARY, PRODUCT, SALES`) is 1:1 with
`connector_capabilities.data_type` and the per-(seller account × data type)
**scheduling** model, and is consumed by exhaustive `switch` expressions across the
ingestion backbone (`SyncRunExecutor`, `MockApiConnector`, `ConnectorResult`,
`NaverApiConnector`, `FileUploadConnector`). Board Discovery is a one-shot
**config/mapping lookup** that yields board metadata, not canonical, deduped VOC
records — so it is modeled as **connector-internal infrastructure** (sibling to
`Cafe24OrdersClient`), with zero edits to `DataType`, the mock connector, the
scheduler, or ingestion. This keeps discovery from masquerading as a schedulable
collection type with an ingestion path it does not have.

## Design

All under `backend/.../connector/cafe24/`, wired behind the existing feature flag
(`Cafe24ConnectorConfiguration`); with the flag off (default) none of these beans
exist and runtime is byte-identical.

| Component | Responsibility |
|---|---|
| `Cafe24BoardRow` | Jackson projection of one board row — **metadata only**: `board_no`, `board_name`, `board_type`. No article body / writer / customer fields. |
| `Cafe24BoardsClient` | `GET /api/v2/admin/boards` with `Authorization: Bearer …`; mall_id shape guard, 429 → `Cafe24RateLimitedException`, non-200 → HTTP-coded throw (body kept out of the message). |
| `Cafe24BoardClassifier` | Pure offline `classify(row) → REVIEW_BEARING / INQUIRY_BEARING / OTHER` by name keywords, **inquiry before review** precedence; null/blank → OTHER. |
| `Cafe24BoardDiscovery` | Thin orchestrator: list → classify → sanitized `Result` (per-board `board_no` + `board_name` + `board_type` + kind, plus a per-kind count map). Takes an already-minted access token; does not open the vault or refresh tokens. |

Classifier keywords: inquiry — 문의, Q&A/QnA, 1:1, 상담, `inquiry`;
review — 후기, 리뷰, `review`; everything else (공지, 자유게시판, 갤러리, …) is OTHER.

## Capability status — `CONFIRMED`

Confirmed by **one supervised live `/boards` read** against the real target mall
(`Cafe24BoardDiscovery.VERIFICATION_STATUS`). The capability ships **flag-off by
default** (`sellerops.connector.cafe24.enabled`); the run used the re-stored
Community-read credential and a temporary, doubly-flag-gated verifier that has since
been removed. Evidence is sanitized — board-level metadata and aggregate counts only,
never article content, customer data, tokens, `mall_id`, or raw bodies.

### Outcome — PASS

| field | value |
|---|---|
| verifier calls | exactly **1** (one token refresh + one `GET /api/v2/admin/boards`) |
| HTTP status | **200** |
| boards parsed | **13** |
| token rotation | persisted (single-use refresh token rotated and written back) |
| DB writes | refresh-token rotation only — no sync_jobs / sync_cursors / order_daily_summaries / canonical reviews / inquiries |
| articles / comments / urgent-inquiry | not fetched |

### Classification result

| classification | count | boards |
|---|---|---|
| REVIEW_BEARING | 1 | 구매후기 |
| INQUIRY_BEARING | 2 | 문의사항 · 1:1 맞춤상담 |
| OTHER | 10 | 공지·이벤트·FAQ·자유게시판·자료실·한줄메모 etc. |

The three VOC-bearing boards were identified with **no false positives or negatives**
across the 10 OTHER boards. Field names `board_no` / `board_name` / `board_type`
parsed cleanly (`board_type` arrives as a numeric code).

### `board_name`-based classification validated

`board_type` alone is insufficient: the run showed **one `board_type` value (5)
spanning a REVIEW board, an INQUIRY board, and an OTHER board**. Keying classification
off `board_name` (with `board_type` captured as metadata only) is therefore the
correct approach, now confirmed against real data.

### Caveat

A mall that **renames or adds** boards may need the classifier keyword set extended;
the confirmation covers the default Cafe24 board naming observed on the target mall.

## Follow-ups (separate, gated)

- **Article body capture** for the review/inquiry boards (its own PR; introduces the
  collection path keyed off the discovered `board_no`).
- **`urgentinquiry` (긴급문의)** as a later candidate — only if the existing
  architecture supports it with minimal additional scope.
- Reply generation stays **internal draft-only**; no Cafe24 write.

## Sanitized-only rule

Evidence and logs from any future run carry board metadata only. Never capture or
echo: tokens, `mall_id`, article/post content, writer or customer fields, order IDs,
or raw response bodies.
