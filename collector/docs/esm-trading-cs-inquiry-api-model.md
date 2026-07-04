# ESM Trading CS Inquiry — official API contract slice

> **Status: offline contract seam.** Pure/offline TypeScript under `src/ingestion/`.
> The official-API pivot for ESM inquiries — a Cloud API-track producer for the
> merged ingestion bridge (`inquiry-ingestion-bridge-model.md`). **No HTTP, real
> credential, or browser inquiry capture.** ESM inquiry-over-API is a Cloud API
> capability, distinct from the Local Agent's ESM review-export browser path.

---

## 1. Tenancy & credential ownership (Model B)

- **SellerOps owns its own ESM+ provider credential** (Model B — approved
  selling-tool provider). `ProviderCredentialRef` (`{ provider: "ESM_TRADING_CS",
  masterId, secretKeyRef }`): `masterId` is the ESM+ Master ID / JWT `kid`
  (an identifier, not a secret); `secretKeyRef` is an opaque vault handle to the
  Secret Key. Never the secret; never logged or enveloped.
- **Each customer is a `SellerConnection`** (`sellerId`, `connectionId`,
  `channel: "ESM"`, optional `gmarketSellerId`, optional `auctionSellerId`) — the
  tenant identity across the Gmarket/Auction umbrella. A call is scoped by the
  (provider credential × connection × marketplace) tuple.
- **Query window:** ESM CS listing is bounded to **7 days**
  (`ESM_CS_QUERY_WINDOW_MAX_MS`); callers must `validateQueryWindow` first.

## 2. Seams (no implementation)

| module                     | role                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `esm-trading-cs-client.ts` | `EsmTradingCsClient.listInquiries(credential, connection)` seam + the provisional `EsmTradingCsInquiryRecord` + credential/connection types |
| `esm-reply-token-store.ts` | `EsmReplyTokenStore` seam (put/get keyed by `connectionId + messageNo`) + an in-memory fake; production is **encrypted at rest** behind the seam |
| `esm-trading-cs-ingest.ts` | record → existing `InquiryIngestionEnvelope` mapper (+ batch); extracts the reply token to the store |

## 3. Transport DTO (exact official fields) & field homes

`EsmCsInquiryRecord` mirrors the ESM CS/QnA response 1:1: `qnaType, sellerId,
messageNo, goodsNo, siteGoodsNo, orderNo, payNo, informStatus, receiveDate,
answerDate, contractType, title, details, token, reAsking`. It carries **no**
inquirer PII and **no** SellerOps-derived fields.

| DTO field        | Home / handling                                                     |
| ---------------- | ------------------------------------------------------------------- |
| `messageNo`      | `channelInquiryId` (source identity + reply target)                 |
| `details`        | `sellerPrivatePayload.inquiryText` (raw, seller-private)             |
| `title`          | `sellerPrivatePayload.title` — **preserved** through Envelope → InquiryObservation → `CommerceSignal.sellerPrivate` → `SellerInquiryContext` (seller-visible; stripped from manufacturer projections) |
| `goodsNo`        | `productId` (master; `siteGoodsNo` not carried)                     |
| `orderNo`        | `sellerPrivatePayload.orderRef` (`payNo` not carried)               |
| `sellerId`       | integrity cross-check vs the connection's site seller id (not enveloped) |
| `informStatus`   | **intake eligibility authority** (text) — `미처리` → ingest, `처리완료` → skip, unknown → **fail closed** |
| `answerDate`     | **not used for eligibility** — may carry a sentinel value; informational only          |
| `receiveDate`    | **parsing DEFERRED** until its official format is confirmed — not parsed here; `sourceObservedAt` is caller-supplied (`context.observedAtMs`) |
| `token`          | **`EsmReplyTokenStore` only** (keyed by connectionId + sellerId + messageNo) — NEVER in envelope/WorkItem/log/audit |
| `qnaType / contractType / payNo / siteGoodsNo / reAsking` | not carried this slice |

**Derived in the mapper (not DTO fields):** marketplace/site (from `context.marketplace`
+ connection, cross-checked to `record.sellerId`; a site the connection is not on, or
a seller-id mismatch → `SITE_NOT_AUTHORIZED`); intake eligibility from `informStatus`
ONLY (`classifyInformStatus` / `evaluateIntakeEligibility`: `미처리` → ingest, `처리완료`
→ `ALREADY_ANSWERED`, anything else → `UNKNOWN_STATUS`; `answerDate` never consulted);
epoch timestamps (caller-supplied); topic/severity (`deriveInquiryCategory`,
placeholder). Envelope `responseDeadlineAt` is null (no API deadline).

**Three distinct status concepts** (do not conflate): the response **`informStatus`**
is TEXT (`미처리`/`처리완료`); the query **`status`** filter (`EsmCsQueryStatus` = `1..5`)
and the reply **`answerStatus`** (`EsmCsReplyAnswerStatus` = `1..2`, on
`EsmCsAnswerRequest`) are SEPARATE NUMERIC enums. Unsupported values are rejected at
the validation boundary (`validateQueryStatus` / `validateAnswerStatus` →
`UNSUPPORTED_QUERY_STATUS` / `UNSUPPORTED_ANSWER_STATUS`).

**Inquirer PII (`inquirerName` / `inquirerPhone`)** is discarded at the raw→DTO
boundary (`discardInquirerPii`) and never modeled on the DTO.

## 3a. Answer contract (documented; no execution here)

`EsmCsAnswerRequest` = `{ messageNo, token, answerStatus, title, comments }`. The
`token` is resolved from the `EsmReplyTokenStore` at reply time (never the envelope).
`comments` is bounded to **1000 UTF-8 bytes** (`ESM_CS_ANSWER_MAX_BYTES`,
`validateAnswerComments`). The reply executor/verifier port that consumes this is a
later Cloud API slice.

The deterministic seller-scoped `eventId` and all downstream validation come from
the merged bridge unchanged; the intake coordinator's channel source identity
remains the WorkItem dedup authority.

## 4. Secret handling (enforced by tests)

- The per-inquiry `replyToken` is written ONLY to the encrypted token store, keyed
  and connection-namespaced so one tenant can never read another's token — and it
  never appears in the envelope, the coordinator snapshot (WorkItem/aggregate/audit),
  logs, or sanitized results.
- The master credential ref never leaves the credential seam.
- Tenants are isolated: per-connection token keys + seller-scoped event ids.

## 5. Deferred

- The **live `EsmTradingCsClient`** (HTTP), the **encrypted store implementation**,
  and **credential/token resolution** (authenticated transport + encryption).
- The **Cloud API reply executor/verifier port** that resolves the reply token from
  the store at reply time (mirrors the Cafe24 `ApiConnectorPort` credential pattern)
  — the reply token is deliberately NOT in the dispatch fingerprint.
- Optional envelope extensions for `title` and a coarse `answerStatus`.
- The provisional `EsmTradingCsInquiryRecord` field set is corrected only from
  confirmed ESM Trading CS API docs — never guess-tuned.
