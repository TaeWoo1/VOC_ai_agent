# Coupang Routine Operations v1 — 고객문의

> The first Coupang vertical that is *operational work* rather than connection work: acquire the
> seller's customer inquiries through an official API, carry them into the existing routine spine,
> and answer them — after the seller confirms the draft — through Coupang's own reply API.
> **Live-proven acquisition** (2026-08-14, `docs/coupang_inquiry_live_proof_v1.md`); the routine
> chain and the reply path are implemented and offline-tested but have never had a live subject.
> Sanitized: no secret, key, vendor id, IP, buyer identity, inquiry text, or seller data appears here.
>
> **Revised 2026-08-14.** §5 originally described a guided-browser answer, built on the belief that
> Coupang published no answer API. It does:
> `POST …/v4/vendors/{vendorId}/onlineInquiries/{inquiryId}/replies`. The API is now the path and the
> browser flow is demoted to a diagnostic. The superseded design and everything its three
> calibration sittings measured are kept in §5-bis, because the measurements were real.

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
- **`CoupangApiConnector`** — advertises `INQUIRY` as **`CONFIRMED`** beside `ORDER_SUMMARY`
  (promoted by the live proof, not by the code existing) and routes `fetch` by data type. REVIEW
  still throws `UnsupportedDataTypeException`.
- **`CoupangResponseDiagnostics`** — the order client's sanitization rules for provider bodies,
  extracted so both streams share one implementation rather than two.
- **A paced sweep** — a minimum 250ms between signed calls (4/s, under Coupang's documented 5/s).
  Added after a live 429; see the live-proof record §4.
- **No migration, no new table, no new endpoint.** Inquiries land in the existing `inquiries` +
  `inquiry_work_item` via the shared `IngestionService`.

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

**SellerOps posts the reply through Coupang's own API, after the seller confirms it.** See §5 —
this superseded the guided-browser answer once the official endpoint was found.

---

## 5. The answer path — official API (superseded the guided browser answer)

> **This section replaced a browser flow.** Everything below §5.3 is the record of that flow and of
> what its calibration measured. It is kept because the measurements are real and the diagnostic is
> still useful — not because it is the path.

### 5.1 The endpoint

```
POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/onlineInquiries/{inquiryId}/replies
body: { "content": ..., "vendorId": ..., "replyBy": ... }
```

**The version asymmetry is Coupang's, not a mistake.** Collection is `v5`; this answer endpoint is
`v4`. Aligning one to the other would be inventing an endpoint rather than calling a documented one.

**What is not verified from this repository.** The three request field names come from Coupang's
public API reference. No live call has exercised them. The client is written so the first live
attempt either succeeds or fails loudly with the platform's numeric code — never a silent retry
against a guess.

### 5.2 The flow

```
UNANSWERED inquiry → work item → customer context → AI draft
   → the seller confirms THAT exact draft version (immutable binding)
   → CoupangChannelReplyAdapter → official reply API
   → re-query the ANSWERED bucket → COMPLETED only when Coupang lists it as answered
```

The publish core needed no change: `InquiryPublishService` was already channel-neutral (confirm →
bind → gated dispatch → verify), so Coupang is a **second adapter** beside ESM's, not a second flow.

**Nothing auto-sends.** The adapter is registered only behind
`sellerops.inquiry.publish.execution-enabled`; with the flag off no Coupang adapter bean exists and
the registry resolves empty. A dispatch runs only from `ACTION_PENDING`, reached only by a seller's
explicit confirmation of a specific draft fingerprint.

**Never a resend.** A `POST` that times out may already have answered a customer, so the HTTP
boundary has its own write verb and its own `CoupangTransportAmbiguityException` — every *other*
fail-closed state in this connector means "nothing was sent", and that is the one distinction a
reply path cannot lose. It maps to `DELIVERY_UNKNOWN`, which the core verifies and never resends.

**Two places where the pessimistic reading is the honest one:**

- A **200 that does not say success is not a success.** Coupang answers business rejections with
  HTTP 200 and a non-OK envelope; reading only the status would record a reply that was never
  posted, and the seller would believe a customer had been answered.
- A **verification that could not run is `NOT_COMPLETED`**, never confirmed. "We could not check"
  rounding up to "it landed" would close a work item on an answer nobody received.

Verification asks the platform, not our own text: is this `inquiryId` now in the ANSWERED bucket.
Comparing bodies would read customer-visible content back *and* turn a whitespace difference into a
failed verification. The window brackets the inquiry's KST day by one day either side, because the
stored timestamp is UTC.

### 5.3 `replyBy` — a configuration gap, stated plainly

Coupang stamps an answer with the WING operator id. **SellerOps does not hold it**: the credential
handoff stores 업체코드 / Access Key / Secret Key and nothing else. It is configured explicitly
(`sellerops.connector.coupang.reply-by`) and blank refuses to publish — `RETRYABLE`, not
`PERMANENT`, because nothing was sent and the same approved draft becomes sendable the moment the
deployment is corrected. Marking it permanent would throw away a seller's approved reply over a
config gap.

*Classification: product-owner / deployment decision. Where this value comes from per connected
seller is not answered here.*

### 5.4 Attachment gap — recorded, not investigated

The official `onlineInquiries` response documents **no image or attachment field**. A buyer who
attached a photo may therefore have an inquiry that is only fully visible in WING, and SellerOps
would draft an answer without knowing a picture exists.

This is recorded and **deliberately not acted on in this unit**. Investigating it means a separate
READ_ONLY attachment discovery with its own decision about what may be read; extending the reply
path into attachment scraping is explicitly out of scope.

*Classification: external-research required.*

---

## 5-bis. The guided answer (Action Window) — DEMOTED to diagnostic

`collector/src/action-window/coupang-inquiry/` — a three-step run at v2 intent `REPLY_SUBMISSION`:
open the screened WING window → the seller confirms they reached their own 고객문의 screen → the
seller posts the reply → the operator reports the outcome.

**It has no driver and reads no DOM.** The WING 고객문의 screen has never been measured: there is no
calibrated selector, no target signature, no observation predicate. So this run highlights nothing
and observes nothing. A guessed selector either points at the wrong control or silently matches
nothing, and both are worse than an honest "you are on the screen; the draft is in the panel; post
it yourself." Measuring that screen is a follow-up calibration sitting.

### What the three READ_ONLY calibration sittings measured

Kept because the measurements are real and each one killed a hypothesis. All three were READ_ONLY,
on the seller's own account, with no click, input, or reply. No buyer text left the page.

| Sitting | Reading | What it settled |
|---|---|---|
| 1 (`tr`/`li`/`[role=row]` rows) | `CONTAINER_AMBIGUOUS` | The refusal rule was unsatisfiable on any real app page — navigation `<li>` and a data table coexist. |
| 2 (same, rule relaxed) | 54 rows · 0 id matches · **`답변완료` 0 AND `미답변` 0** | A row set containing neither status word is not the inquiry list. The scan had confidently measured the navigation. **The row tag was assumed before it was measured.** |
| 3 (anchor-led, attributes only) | 2479 elements · 113 carrying ids · digit-run lengths **`[1,2,3,4,10,14]`** · 1 frame | Our ids are 9 and 11 digits. **Those lengths are absent.** The 접수번호 was never in an attribute — and there is no child frame to blame. |

The operator then read the answer off the screen: the identifier is **printed**, as
`주문문의 (158846709)`, under the column headed `문의유형(접수번호)` — and that 9-digit number is the
API's own `inquiryId`. The official reply endpoint made the whole question moot a few minutes later.

**The lesson that generalizes:** three sittings were spent because each probe decided what the page
looked like before measuring it — first the row tag, then the attribute location. Both were
structural mistakes, not tuning errors, and both produced *confident zeros* that read exactly like
real refutations.

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

Updated by the live proof of 2026-08-14 (`docs/coupang_inquiry_live_proof_v1.md`).

| Channel × capability | State | Basis |
|---|---|---|
| Coupang INQUIRY (API) | **VERIFIED**, `CONFIRMED` | A real account collected through the official v5 path, and a re-sweep of the same window inserted nothing, skipped every row, and left the stored rows untouched. |
| Coupang REVIEW | **BLOCKED**, unchanged | No official API. Nothing was built. |
| Routine chain (queue → proposal → draft → Action Window) | **IMPLEMENTED · LIVE_UNPROVEN** | Offline-tested end to end; both live inquiries were already answered, so no work item opened and the chain had no subject. A live subject requires a real buyer question and cannot be manufactured. |
| Coupang inquiry reply (write) | **IMPLEMENTED · LIVE_UNPROVEN** | The official API path exists behind the execution flag with offline regression. **No live write has been attempted**, because there is no unanswered inquiry to answer and one cannot be manufactured. |
| WING browser targeting | **DIAGNOSTIC · demoted** | Superseded by the official API. What its three calibration sittings measured is recorded in §5-bis. |

`docs/multi-channel-connector-roadmap.md` §4.1 and the capability ledger were moved on this evidence
and no more: INQUIRY is 라이브 검증 ✅ but **not** 운영 지원 — the connector flag stays off.

## 8. What the live proof settled — and what it did not

All seven questions this section used to list were put to a real account on 2026-08-14. The full
record is `docs/coupang_inquiry_live_proof_v1.md`; in brief:

| | Result |
|---|---|
| Is the path `api/v5`? | **Yes** — no 404. |
| Does the key's app have 고객문의 access? | **Yes** — no 403. It is a separate permission from orders, and this one had it. |
| `inquiryAt`'s real rendering | Parsed under the KST reading; **zero** rows dropped as unrepresentable. |
| Does the backfill walk tile and terminate? | Yes — the cursor stopped exactly on `today − 30`. |
| Is re-collection idempotent? | Yes — insert 0, skip 2, duplicate 0, and `updated_at` unchanged: the rows were not written at all. |
| Does an ingested inquiry reach the work queue with a proposal and a draft? | **Not answered.** Both inquiries were already answered, so no work item opened. |
| Does the guided entry carry the operator to the real screen? | **Not answered** — no draft existed to carry, and no reply was posted. |

It also surfaced one defect that only a live run could: the sweep exceeded Coupang's documented
5 calls/s and took a 429 partway. It failed safely (cursor held, nothing lost or duplicated) and is
now paced to 4 calls/s — a fix that changes only timing and is not itself live-verified.

## 9. Follow-ups (not started)

- **A live write.** The reply path has never posted. It needs one genuinely unanswered inquiry, a
  configured `replyBy`, and a WRITE manifest with its own explicit approval — mode `WRITE` is never
  covered by a READ_ONLY grant. Until then: IMPLEMENTED · LIVE_UNPROVEN.
- **Attachment discovery** (§5.4) — whether an inquiry with a buyer photo is visible through the
  API at all. Separate READ_ONLY unit, its own decision. Not attachment scraping.
- **`replyBy` provisioning** — where the WING operator id comes from per connected seller.
- **~~Calibrate the WING 고객문의 screen~~** — demoted. The official reply API removed the reason to
  target a rendered page. The probe is kept as a diagnostic; it should not be extended.
- **`callCenterInquiries`** as a separate stream, with its own PII decision.
- **`backfillCursor` for INQUIRY** so an operator can re-collect an exact window without clearing
  the cursor (Coupang currently returns empty, so a windowed backfill fails closed).
- **Pace the ORDER stream too.** `CoupangOrdersClient` sweeps six statuses × pages with the same
  absence of pacing against the same per-vendor limit. It has never been observed taking a 429 and
  was deliberately left alone here: it is a live-proven path, and changing it on an inference rather
  than an observation is how proven paths break.
- **A live subject for the routine chain** — the first genuinely unanswered Coupang inquiry.
- **Product-name enrichment** — the inquiry endpoint carries none, so products created from this
  stream are named by their key until a product lookup fills them in.
