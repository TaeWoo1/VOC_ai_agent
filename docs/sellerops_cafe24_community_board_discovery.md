# Cafe24 Community Board Discovery — design + verification plan

The first slice toward collecting Cafe24 **reviews and inquiries**. On Cafe24 those
live inside community **boards** (게시판), so before any capture we need a
`board_no → REVIEW / INQUIRY / OTHER` mapping. This slice ships that **Board
Discovery** read skeleton **offline**: the connector stays flag-off by default
(`sellerops.connector.cafe24.enabled`), nothing calls Cafe24, and the capability is
**`NEEDS_VERIFICATION`** until one gated live `/boards` read.

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
| `Cafe24BoardDiscovery` | Thin orchestrator: list → classify → sanitized `Result` (per-board `board_no` + kind + name, plus a per-kind count map). Takes an already-minted access token; does not open the vault or refresh tokens. |

Classifier keywords (doc-asserted): inquiry — 문의, Q&A/QnA, 1:1, 상담, `inquiry`;
review — 후기, 리뷰, `review`; everything else (공지, 자유게시판, 갤러리, …) is OTHER.

## Capability status — `NEEDS_VERIFICATION`

The `/boards` endpoint shape, the board-row field names, and the classifier's
keyword rules are all **doc-asserted and unobserved** against a real mall. A mall may
rename or add boards, so the mapping must be confirmed by a gated live read before any
review/inquiry collection is keyed off it.

## Live-verification plan (gated, later turn)

Run only under an explicit per-run operator approval; dev backend + disposable dev DB,
scheduler off, flag on for the single run.

1. In Cafe24 Developers, add **Community read** (`mall.read_community`) to the app's
   scopes (alongside the existing order read).
2. **Re-run OAuth consent** for the **correct target mall** (the scope set changed, so
   the prior grant is insufficient) and exchange the code locally for a fresh
   `refresh_token`.
3. **Re-store** the credential via the local intake endpoint (refresh token entered
   locally, never echoed).
4. Trigger **one** gated `/boards` read (the only live call) and print **sanitized
   board metadata only**: per-board `board_no` + classified kind + board name, and the
   per-kind counts. No tokens, mall_id, article content, customer data, or raw bodies.
5. If the board shapes and the mapping check out, a follow-up offline PR promotes the
   Board Discovery status `NEEDS_VERIFICATION → CONFIRMED`.

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
