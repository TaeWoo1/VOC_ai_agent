# Coupang Routine Operations v1 — 고객문의

> The first Coupang vertical that is *operational work* rather than connection work: acquire the
> seller's customer inquiries through an official API, carry them into the existing routine spine,
> and hand the seller back to their own marketplace screen to answer. **Offline slice** — no live
> Coupang call has been made in this unit. Sanitized: no secret, key, vendor id, IP, buyer identity,
> inquiry text, or seller data appears here.

---

## 1. The choice, and the two facts that made it

The repo entered this unit with both Coupang VOC capabilities unresolved: REVIEW `BLOCKED`
("공식 API 없음", confirmed 2026-07-07) and INQUIRY `PENDING` ("CS API 존재, 스키마 미열람").
Reading the schemas resolved the second and confirmed the first.

**REVIEW — nothing was built, deliberately.** Coupang publishes no seller review API. The
alternatives are scraping (forbidden) or an unverified export flow (nothing official has been
found). It stays an honest `unsupportedScope` (`REVIEW_API` / "리뷰 API 없음 (쿠팡 미제공)"), and
manual upload remains its only production path. Product-owner direction already says exactly this:
Coupang review is `ACTION_WINDOW` or `INTEGRATION_PENDING` until an official route is verified
(roadmap §5.2).

**INQUIRY — two endpoints, and they are not interchangeable.** This is the finding that decided the
unit:

| | 상품별 고객문의 `onlineInquiries` | 쿠팡 고객센터 문의 `callCenterInquiries` |
|---|---|---|
| What it is | The Q&A a buyer posts on the product listing | CS consultations Coupang transfers to the seller |
| Buyer PII in the payload | **none** | `buyerEmail`, `buyerPhone` |
| Answered classification | `answeredType=ALL\|ANSWERED\|NOANSWER` | `partnerCounselingStatus` + transfer/confirm semantics |
| Query window | ≤ 7 days | ≤ 7 days |
| Built here | **yes** | **no** |

`onlineInquiries` is the primary because a stream that *cannot* leak buyer PII is better than one
that must remember not to. `callCenterInquiries` is not a widening of this connector — it needs its
own PII handling and its own decision about the confirm/transfer obligations it implies.

---

## 2. What shipped (backend, behind `sellerops.connector.coupang.enabled`)

- **`CoupangInquiriesClient`** — the official v5 `onlineInquiries` flow: both answered buckets swept
  per window, `pageNum` paging to the reported total, mapped to `CanonicalInquiry`.
- **`CoupangInquiryCursor`** — a two-phase cursor. The 7-day cap makes a single-sweep import
  impossible, so the initial import walks 7-day windows **backward** to a 30-day floor, one window
  per `fetch` with `hasMore=true`, driven by the executor's existing paging loop; then it settles
  into a trailing routine window.
- **`CoupangApiConnector`** — advertises `INQUIRY` as **`NEEDS_VERIFICATION`** beside
  `ORDER_SUMMARY` `CONFIRMED`, and routes `fetch` by data type. REVIEW still throws
  `UnsupportedDataTypeException`.
- **`CoupangResponseDiagnostics`** — the order client's sanitization rules for provider bodies,
  extracted so both streams share one implementation rather than two.
- **No migration, no new table, no new endpoint.** Inquiries land in the existing `inquiries` +
  `inquiry_work_items` via the shared `IngestionService`.

### The request, exactly as documented

```
GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries
    ?answeredType={NOANSWER|ANSWERED}&inquiryStartAt={yyyy-MM-dd}&inquiryEndAt={yyyy-MM-dd}
    &pageNum={n}&pageSize=50
```

CEA HMAC per request, `X-Requested-By` / `X-MARKET`, through the same `CoupangLiveCallGuard` choke
point as orders — a real gateway host without an armed approval id fails closed before signing.
`vendorId` is the path segment only; repeating it as a query parameter would change the signed
message for no gain.

### Mapping

| Canonical field | Source | Note |
|---|---|---|
| `externalId` | `onlineInquiry:{inquiryId}` | Namespaced so a future 고객센터 stream cannot collide |
| `body` | `content` | |
| `status` | the bucket the row arrived in | `NOANSWER`→UNANSWERED, `ANSWERED`→ANSWERED |
| `informStatus` | the raw `answeredType` token | kept verbatim as evidence |
| `receivedAt` | `inquiryAt` | offset honored; a bare local value is read as KST |
| `sku` | `sellerProductId`, else `vendorItemId` | verbatim, Cafe24 convention |
| `productName` | `null`, or `(미지정 상품)` with no key | this endpoint carries no product name |
| `author` / `title` / `isSecret` | — | never read / no subject line / Coupang does not classify |

**The platform classifies answeredness, not us.** `commentDtoList` entries carry no author field, so
they cannot distinguish a seller's answer from a buyer's follow-up; `answeredType` can. `NOANSWER`
is swept first and `ANSWERED` second, so an inquiry answered mid-sweep records as ANSWERED — falsely
open is the harmful direction, because it opens a seller task for work already done.

---

## 3. Two deliberate deviations, both from the order client

**A row that cannot be represented truthfully is dropped, and the page still lands.**
`CoupangOrdersClient` fails the whole page on a missing amount, and that is right there: one
unreadable line makes the day's *aggregate* silently wrong. Here every row is independent, and
failing the page would re-fetch the same bad row on every retry — the cursor could never advance
past it and the stream would wedge permanently. A row missing `inquiryId`, `content`, or a parseable
`inquiryAt` is counted and dropped with a log naming the missing **field**, never its value.

**The 7-day window is a narrower bound than the order stream's 31, and it is a real one.** A
scheduler outage longer than 7 days leaves a permanent hole: inquiries received before
`today - 7` are never swept by a routine run, and the cursor still advances. Recovery is a
deliberate re-backfill (clearing the cursor), not something the routine window heals on its own.

---

## 4. The routine, end to end

Nothing in the routine spine is Coupang-specific. A collected inquiry flows through the shared,
channel-neutral path:

```
onlineInquiries → CanonicalInquiry → ingestInquiries → Inquiry (+ work item, only if UNANSWERED)
   → InquiryProposalService.propose → PROPOSED + a coarse reply CATEGORY
   → InquiryReplyDraftService.save → the seller's own versioned draft
   → Action Window guided entry → the seller posts it on WING themselves
```

Proven over H2 in `CoupangInquiryRoutineFlowTest`: an UNANSWERED inquiry opens exactly one OPEN work
item bound to that connection; an already-ANSWERED one is stored as history with **no** task;
re-sweeping the overlapping window changes nothing; a platform answer flips the status and completes
the open task; no buyer identity is persisted anywhere on the path.

**SellerOps cannot post the reply.** `ChannelReplyAdapterRegistry` resolves adapters by channel and
Coupang has none, so the dispatch path is structurally empty — not disabled by a flag, absent.

---

## 5. The guided answer (Action Window)

`collector/src/action-window/coupang-inquiry/` — a three-step run at v2 intent `REPLY_SUBMISSION`:
open the screened WING window → the seller confirms they reached their own 고객문의 screen → the
seller posts the reply → the operator reports the outcome.

**It has no driver and reads no DOM.** The WING 고객문의 screen has never been measured: there is no
calibrated selector, no target signature, no observation predicate. So this run highlights nothing
and observes nothing. A guessed selector either points at the wrong control or silently matches
nothing, and both are worse than an honest "you are on the screen; the draft is in the panel; post
it yourself." Measuring that screen is a follow-up calibration sitting.

Consequences that are contract-level:

- **The terminal is `OPERATOR_REPORTED`, never `COMPLETED`.** `operatorOutcome` (what the seller
  says) and `verification` (always `UNVERIFIED`) are separate fields, so no consumer can read a
  report as a confirmation.
- **No submit path exists** — in the engine, in the stages, or in any driver, because there is no
  driver. A reply post is not idempotent; the guarantee against double-posting is that it never
  posts. A source-level test asserts no click/type/evaluate path was ever added.
- The run knows only an opaque 16-hex `submissionRef`. The reply text, the inquiry id, the buyer,
  and the product never enter the runtime.

---

## 6. Official API basis (developers.coupang.com — nothing guessed)

| Concern | Official fact | Source |
|---|---|---|
| Path | `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/onlineInquiries` | Customer Inquiry Query by Product |
| Params | `answeredType` (ALL/ANSWERED/NOANSWER) **required**; `inquiryStartAt`/`inquiryEndAt` `yyyy-MM-dd`, **≤7d**; `pageNum` (default 1); `pageSize` (default 10, **max 50**) | 동상 |
| Response | `data.content[] { inquiryId, productId, sellerProductId, sellerItemId, vendorItemId, content, inquiryAt, orderIds, commentDtoList[] }` + `data.pagination { currentPage, totalPages, totalElements, countPerPage }` | 동상 |
| PII | this endpoint returns **no** buyer contact field | 동상 (shape) |
| The other stream | `GET …/api/v5/vendors/{vendorId}/callCenterInquiries` returns `buyerEmail`, `buyerPhone` | Query of Coupang Contact Center Inquiries |
| Auth / rate limit | unchanged from the order slice (CEA HMAC; 429 at >5 calls/s per vendorId) | Creating HMAC Signature / rate-limit policy |

**The version segment is the one thing to re-verify live.** The published article renders this path
at `api/v5`; older community references show `api/v4`. A wrong version is an HTTP 404, which this
client surfaces as an honest non-200 failure with only the safe scalar error fields — it cannot be
mistaken for "the seller has no inquiries". The live proof settles it.

---

## 7. Honest capability state

| Channel × capability | State | Why |
|---|---|---|
| Coupang INQUIRY (API) | **IMPLEMENTED**, `NEEDS_VERIFICATION` | Code exists; **no live run has collected a single inquiry**. Must not be shown to a seller as 지원. |
| Coupang REVIEW | **BLOCKED**, unchanged | No official API. Nothing was built. |
| Coupang inquiry reply (write) | **guided only**, `UNVERIFIED` by design | SellerOps never submits; no adapter exists; the terminal is a report. |

`docs/multi-channel-connector-roadmap.md` §4.1 and the capability ledger are **not** updated by this
unit — they move only on live evidence, and there is none yet.

---

## 8. What the live proof has to settle

One READ_ONLY manifest, batched:

1. The `api/v5` path is the right one (a 404 here is the finding, not a failure to hide).
2. The credential's Coupang app actually **has** 고객문의 API access — the order-access grant does
   not imply it, and a 403 here is a distinct, real outcome.
3. `inquiryAt`'s real rendering (offset or bare), against the KST reading.
4. Whether any row is dropped as unrepresentable on real data, and which field.
5. The backfill walk tiles and terminates against a real account's history.
6. An ingested inquiry reaches the work queue, gets a category proposal, and holds a draft.
7. The guided entry carries the operator to their real 고객문의 screen and SellerOps writes nothing.

Prerequisite that is not free: a proof environment with a **stored Coupang credential** and the
calling IP registered. The previous unit's proof database was destroyed at teardown, so the
credential handoff has to run again before any of the above can be attempted.

---

## 9. Follow-ups (not started)

- **Calibrate the WING 고객문의 screen** so the guided run can highlight the actual composer and
  observe the seller's own submit — the one thing that would upgrade the entry from "carried there"
  to "guided".
- **`callCenterInquiries`** as a separate stream, with its own PII decision.
- **`backfillCursor` for INQUIRY** so an operator can re-collect an exact window without clearing
  the cursor (Coupang currently returns empty, so a windowed backfill fails closed).
- **Product-name enrichment** — the inquiry endpoint carries none, so products created from this
  stream are named by their key until a product lookup fills them in.
