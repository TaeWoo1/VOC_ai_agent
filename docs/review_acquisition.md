# Review Acquisition Discovery Spike

**Status:** Discovery / evidence-gathering. **No production code. No RPA. Hold for approval.**

**Goal:** identify the first viable path toward *automated* product-review collection, backed
by traceable evidence rather than assumptions. This document does **not** authorize building
automation; its output is a verified capability picture plus a precise evidence-collection ask.

## Definitions (these four are never conflated)

- **Product review** — a buyer's post-purchase rating/review of a product (구매평 / 상품평). This
  is the core data we want.
- **Product Q&A / customer inquiry** — pre/post-purchase questions on a product listing
  (상품문의). Not a review.
- **Customer-center inquiry** — tickets routed through the marketplace's CS/contact center
  (고객센터 문의, 네이버 톡톡). Not a review.
- **Order** — order/transaction records (주문). Not a review.

A platform offering an *inquiry* or *CS* API is **not** evidence of review support.

## Evidence quality legend

- **[official]** — vendor's own developer portal / API center (URL given).
- **[vendor-support]** — vendor's official support/discussion space, e.g. NAVER's commerce-api
  GitHub (URL given).
- **[third-party]** — blogs / service vendors; indicative only, **not** proof of an official feature.
- **[codebase]** — status of *our connector* in this repo (connector javadoc, note dated
  2026-06-12). This reflects what we implemented, **not** an authoritative statement about the
  platform.
- **[walkthrough]** — confirmed by a user's logged-in seller-center walkthrough (date noted; see
  Section W).
- **[walkthrough-required]** / **[sample-required]** — behind seller-center login; only a user
  walkthrough / screenshot / sample export can confirm (see Section F).

Searches run 2026-06-16. Every matrix cell's evidence (URL, or an explicit
walkthrough/sample requirement) is itemized in **Section B**.

---

## A. Capability matrix

| Capability | NAVER SmartStore | Coupang WING |
|---|---|---|
| **Product review API** | **Not provided by the Commerce API** [vendor-support] (see B1) | **None found** — no verified official product-review retrieval API in the reviewed Open API docs [official] (see B3) |
| **Inquiry / Q&A / CS API** (not reviews) | Not via Commerce API; 톡톡 is a separate partner system — unknown, verify [vendor-support] (see B2) | **Yes** — official CS API for customer-center & per-product *inquiries* (B4). **Inquiries, not reviews.** |
| **Seller-center review export** | **Yes — user-walkthrough confirmed (2026-06-16)** — 리뷰 관리 → **엑셀다운** produces `review_YYYYMMDD_HHMMSS.xlsx` [walkthrough] (see W, B5) | **Unknown** — no official export confirmed; "리뷰 엑셀" results are third-party **scrapers**, not a WING feature → [walkthrough-required] (B6) |
| **NaverPay / 네이버쇼핑 구매평 coverage** | **Pending verification** — user must confirm whether NaverPay/쇼핑 reviews are included or excluded in the export → [walkthrough-required] (gates the direction) | n/a — Coupang reviews deferred |
| **Parser compatibility (export → ingestion)** | **Reads OK; review-mapping hardening required** — `FileParser` (POI) reads the `.xlsx`, but `ReviewRowMapper` aliases miss NAVER headers; the **body** alias miss makes **every row fail** today. Additive aliases + a date-format check needed (see S) | n/a |
| **Scheduled report / email** | Unknown — no public evidence → [walkthrough-required] (B7) | Unknown — no public evidence → [walkthrough-required] (B7) |
| **Browser-automation feasibility** | Medium — contingent on an official export existing; NAVER login may present 2FA/captcha → user-attended only | Unknown — contingent on an official export existing at all |
| **Risk** | Medium | Medium–High (no confirmed official review source) |
| **Recommended review route** | Seller-center export automation (opt-in) **only if** the export is confirmed by walkthrough + sample; prefer email-report if one exists | **Defer** review acquisition until an official export is confirmed. (CS/inquiry API is separate and is **not** reviews.) |

**What is established vs. open:**
- Established: **no product-review retrieval API was found for either channel** — for NAVER via
  the vendor's explicit statement, for Coupang via its *absence* in the reviewed official docs
  (not an official "unavailable" statement). So official API integration cannot be the
  review-ingestion path; reviews must come from a seller-center **export** or an emailed report.
- Established (NAVER): a **seller-center review export exists** — confirmed by a user walkthrough
  on 2026-06-16 (리뷰 관리 → 엑셀다운 → `.xlsx`); column names observed (Section W).
- Open (still gates a build): NaverPay/쇼핑 구매평 **coverage** (include/exclude), **parser
  compatibility** against a real anonymized sample, export **repeatability / date & row limits**,
  and whether a **scheduled/emailed** report exists. The export's *existence* is confirmed; its
  *sufficiency for routine automation* is not.
- Coupang: whether an **official** review export exists is still unknown → reviews **deferred**.

---

## W. User walkthrough evidence — NAVER SmartStore (2026-06-16, seller-provided)

A seller logged into the NAVER SmartStore Center and walked the review-export path. This is
first-hand evidence behind the login, superseding the earlier third-party-only inference.

**Observed UI path:**
- Main dashboard shows a **문의 · 리뷰 현황** area with a **리뷰 현황** card.
- Left navigation: **문의/리뷰관리 → 리뷰 관리**.
- The **리뷰 관리** page exists behind login, with review **filters** visible; the user can adjust
  the **date range** and other filters and press **검색**.
- The review-list area has an **엑셀다운** button; clicking it downloads a file named like
  **`review_20260616_200638.xlsx`** (`review_YYYYMMDD_HHMMSS.xlsx`).

**What this confirms:** a seller-center **review export exists** for the logged-in workflow
(immediate `.xlsx` download observed). **[walkthrough]**

**What this does NOT yet confirm (do not overstate):**
- It does **not** prove full automation is viable.
- It does **not** confirm **NaverPay / 네이버쇼핑 구매평** are included in the export (still
  pending a user yes/no).
- It does **not** confirm parser compatibility — no actual `.xlsx`/`.csv` sample has been
  analyzed yet.

**Observed export columns (header names, as reported — not yet validated against a file):**
상품번호 · 상품명 · 리뷰구분 · 구매자평점 · 포토/영상 · 리뷰상세내용 · 리뷰도움수 · 등록자 ·
리뷰등록일 · 최종수정일 · 리뷰글번호 · 관련리뷰글번호 · 관련리뷰상세내용 · 전시상태 · 답글여부 ·
답글등록일시 · 베스트리뷰 · 베스트리뷰선정일시 · 이벤트번호 · 혜택지급 · 혜택지급일시 ·
유저정보 등록 항목 · 상품주문번호 · 풀필먼트사 · 리뷰이동일

**Likely ingestion mapping candidates** (hypotheses to validate against a real sample — not
final, and the canonical review schema must be confirmed):

| Canonical field (candidate) | NAVER column (candidate) |
|---|---|
| externalId (review id) | 리뷰글번호 |
| productExternalId | 상품번호 |
| productName | 상품명 |
| rating | 구매자평점 |
| reviewBody | 리뷰상세내용 |
| author / displayName | 등록자 |
| createdAt | 리뷰등록일 |
| updatedAt | 최종수정일 |
| orderExternalId | 상품주문번호 |
| reply status | 답글여부 / 답글등록일시 |
| media flag | 포토/영상 |
| display status | 전시상태 |

**Remaining blockers (before any automation or parser change):**
1. An actual **anonymized `.xlsx`/`.csv` sample** is still needed (mask reviewer names/IDs/
   order identifiers; keep headers + structure).
2. **Encoding / date-format / data-type validation** against that sample.
3. **NaverPay / 네이버쇼핑 구매평 inclusion** — still needs an explicit yes/no.
4. **Export repeatability** and **date / row limits** — still need confirmation.
5. Whether a **scheduled / emailed** review report exists — still unknown.

---

## S. Sample-file schema analysis (2026-06-16)

Source: the seller's raw export `naver/review_20260616_200638.xlsx`, inspected **locally,
read-only**. The file is **git-ignored and never committed**; the inspection emitted only
aggregates/typed summaries — **no raw review text, reviewer ids, order numbers, or other row
values were printed or logged**.

**Opens successfully** — valid `.xlsx` (OOXML zip); a single worksheet was found and read.
**Shape:** 1 sheet (`Sheet0`), **3,695 data rows × 25 columns**.
**Headers:** match the walkthrough list **exactly — 25/25, in order** (no missing, no extra).

**Type inference (buckets only, no raw values):**

| Column | Type / nullability | Notes |
|---|---|---|
| 상품번호 | number-like string, len 9–11, no blanks | product id; keep as **string** (avoid int coercion) |
| 상품명 | text, len 13–41, no blanks | product name |
| 리뷰구분 | text, len 2–4, no blanks | review-**type** enum: 일반 / 한달사용 — type, not source; does **not** indicate NaverPay |
| 구매자평점 | number, **1–5** (distinct 1,2,3,4,5), no blanks | rating, integer |
| 포토/영상 | text 1,973 / blank 1,722 | non-blank len 79–136 → likely **media URL(s)**, not a mere flag |
| 리뷰상세내용 | text, len **10–1,059**, no blanks | the review body (free text) |
| 등록자 | text, len 6–18, no blanks | reviewer display id (masked-style) |
| 리뷰등록일 | text, **fixed len 20**, no blanks | timestamp; did **not** match ISO `YYYY-MM-DD HH:MM:SS` → non-ISO format (confirm) |
| 최종수정일 | text len 20, **17 set / 3,678 blank** | edit timestamp (mostly blank) |
| 리뷰글번호 | number, len 10, no blanks | **review id** |
| 상품주문번호 | number-like string, **fixed len 16**, no blanks | **order id (sensitive)** |
| 답글여부 | enum/flag text, len 1 | reply yes/no |
| 답글등록일시 | text len 20, **132 set / 3,563 blank** | reply timestamp |

**Dedupe key:** `리뷰글번호` is present for **every** row (3,695/3,695) and **fully unique**
(3,695 distinct) → a reliable **externalId / dedupe key**. Fallback if ever absent: a content
hash of (상품번호 + 리뷰등록일 + hash(리뷰상세내용)) — values hashed, never exposed.

**Parser compatibility — reads OK, but review mapping needs hardening:**
- `FileParser` (Apache POI, first sheet) reads this `.xlsx` and normalizes headers (BOM-strip +
  lowercase) — file format is fine.
- `ReviewRowMapper` maps via `HeaderAliases.pick` (**exact** lowercased-header lookup). Its alias
  lists do **not** include NAVER's headers. Gap:

  | Field | Current aliases | NAVER header | Status |
  |---|---|---|---|
  | body (required) | 내용 / 리뷰 / 리뷰내용 / review / body / content | **리뷰상세내용** | **MISS → every row fails** ("리뷰 내용이 비어 있습니다.") |
  | product | 상품명 / 상품 / product / product_name | 상품명 | match ✓ |
  | rating | 평점 / 별점 / rating / score / star | 구매자평점 | MISS (rating lost; non-fatal) |
  | date | 작성일 / 날짜 / date / received_at / reg_date | 리뷰등록일 | MISS (date lost; non-fatal) |
  | externalId | 리뷰id / 리뷰아이디 / review_id / external_id / id | 리뷰글번호 | MISS (unique key lost — important) |
  | sku / product id | sku / 상품코드 / 품번 | 상품번호 | MISS (no productExternalId captured) |

**Smallest parser-hardening plan (proposed, NOT implemented):**
1. Add NAVER aliases to `ReviewRowMapper` (additive only): body += `리뷰상세내용`; rating +=
   `구매자평점`; date += `리뷰등록일`; externalId += `리뷰글번호`. This alone makes the file ingest.
2. Date handling: `리뷰등록일` is a fixed-width 20-char non-ISO timestamp — confirm its exact
   format and ensure `DateParse` accepts it; consider preserving time (current
   `instantAtStartOfDay` drops it).
3. (Optional, schema decision) capture `상품번호` as a product external id — `CanonicalReview`
   has `sku` but no dedicated `productExternalId`; reuse `sku` or extend the schema (defer).
No new parser, no format change — alias additions + a date-format check.

**Privacy classification (what must be handled carefully):**

| Column | Sensitivity | Handling |
|---|---|---|
| 상품주문번호 | **High** — links a review to a specific order/purchase | do **not** expose in UI; do **not** persist plaintext; if a key is needed, store hashed/opaque |
| 등록자 | Medium — reviewer display id | operator surfaces only; never a join key; not in consumer-facing output |
| 유저정보 등록 항목 | Unknown/potentially PII | inspect cautiously; **do not persist** unless a need is justified |
| 리뷰상세내용 | Medium — free-text review content | operator surfaces only; consumer surfaces use sanitized cluster phrases (per consumer-safety policy) |
| 포토/영상 | Low–Medium — likely media URLs | prefer deriving a `hasMedia` boolean; persisting raw URLs is optional and may embed identifiers |
| 리뷰글번호 / 상품번호 | Low — opaque ids | safe as external ids / keys |

**`리뷰구분` enum-label check (2026-06-16, bounded — labels + counts only):** two distinct labels,
no blanks — **일반 (2,116)** and **한달사용 (1,579)**. This is a review **type** taxonomy
(regular vs one-month-use review), **not** a review **source/channel** taxonomy — so it does
**not** indicate whether reviews originate from NaverPay/네이버쇼핑. It does **not** help resolve
coverage. (No parser impact: clean 2-value enum.)

**Still unresolved by the file alone:**
- **NaverPay / 네이버쇼핑 구매평 coverage — still PENDING (inconclusive).** The sample has 3,695
  reviews, but neither the row count nor the `리뷰구분` enum (type, not source) reveals whether
  NaverPay/쇼핑 reviews are included or excluded. **Seller total-count confirmation is still
  required** (does 3,695 for that date range/filter match the seller's total review count
  including NaverPay?). Do not claim coverage either way until confirmed.
- Export **repeatability** and **date / row limits** (this export pulled 3,695 rows for the
  chosen filter — limit behavior unknown).
- Whether a **scheduled / emailed** report exists.

---

## B. Evidence notes (per claim, traceable)

**B1 — NAVER, product review API: not provided by the Commerce API.**
- NAVER's own commerce-api support space carries a standing review-query feature request and an
  official reply that reviews (and 톡톡) are not supported, with no near-term plan.
  - https://github.com/commerce-api-naver/commerce-api/discussions/1909 ("상품 리뷰조회 API 기능요청") [vendor-support]
  - https://github.com/commerce-api-naver/commerce-api/discussions/1582 [vendor-support]
  - https://github.com/commerce-api-naver/commerce-api ; API center https://apicenter.commerce.naver.com/ [official]
- Connector status: our `NaverApiConnector` implements only ORDER_SUMMARY; its note records "no
  official review API" as of 2026-06-12. This is *our implementation status*, consistent with B1
  above — not an independent platform source. [codebase]

**B2 — NAVER, inquiry/Q&A/CS API (not reviews): not via Commerce API; unclear otherwise.**
- The same vendor replies group 톡톡 consultations with reviews as unsupported by the Commerce
  API; 톡톡 is a separate "톡톡 파트너센터" system. Whether any product-Q&A endpoint exists is
  unclear. [vendor-support] → verify. (Distinct from product reviews regardless.)

**B3 — Coupang, product review API: none found in reviewed docs.**
- The Open API portal documents Product, Order (ordersheets), and CS APIs; **no product-review
  retrieval endpoint was found** in the reviewed documentation. This is an *absence in the
  sources reviewed*, **not** an official Coupang statement that no review API exists.
  - https://developers.coupangcorp.com/hc/en-us (Open APIs index) [official]
  - https://developers.coupangcorp.com/hc/en-us/sections/360005046534-Product-APIs [official]
- That third parties sell review *crawlers* is consistent with the absence of an API but is not
  proof: https://github.com/JaehyoJJAng/Coupang-Review-Crawling , https://www.octoparse.kr/blog/coupang-product-review-comment-scraper [third-party]
- Open item: confirm against the full Coupang Open API catalog / developer support whether any
  review endpoint exists → verify.

**B4 — Coupang, inquiry / CS API (not reviews): yes.**
- Official CS API for customers' online & contact-center *inquiries*:
  - https://developers.coupangcorp.com/hc/en-us/articles/360033645354-Query-of-Coupang-Contact-Center-Inquiries [official]
  - https://developers.coupangcorp.com/hc/en-us/articles/360033400754-Customer-Inquiry-Query-by-Product [official]
  - https://developers.coupangcorp.com/hc/en-us/articles/360033643314-CS-API-Workflow [official]
- **These are inquiries, not reviews.** Do not present as review support.

**B5 — NAVER, seller-center review export: confirmed by user walkthrough (2026-06-16); coverage/sample pending.**
- **Primary evidence:** a seller's logged-in walkthrough confirmed 리뷰 관리 → **엑셀다운** →
  `review_YYYYMMDD_HHMMSS.xlsx`, with column names observed. See **Section W**. [walkthrough]
- Corroborating (pre-walkthrough): third-party guides described the same 리뷰 관리 → 구매평 엑셀
  다운로드 path. https://imweb.me/blog?idx=402 ; https://www.cre.ma/blog/link-smartstore [third-party]
- **Still pending:** **NaverPay/네이버쇼핑 구매평** inclusion (a third-party source flagged it may
  be excluded — needs a user yes/no), an **anonymized sample** for schema/encoding/date-format
  validation, and **repeatability / date & row limits**. [walkthrough-required] + [sample-required]

**B6 — Coupang, seller-center review export: unknown.**
- Searches for "쿠팡 상품평 엑셀 다운로드" return **third-party scraping services** (paste a product
  URL → scrape reviews), e.g. https://kmong.com/gig/553334 [third-party]. These are **not** an
  official WING export and are out of scope. Whether WING itself offers an official 상품평 export
  is **unconfirmed**. [walkthrough-required]

**B7 — Scheduled / emailed review reports (both channels): unknown.**
- No public evidence found either way. [walkthrough-required]

---

## C. First discovery target — NAVER SmartStore (a target to verify, not a build decision)

**NAVER is the first target because its seller-center review export is now confirmed to exist
(user walkthrough 2026-06-16, Section W) — not because review automation is proven viable.** No
automation should be built until a real anonymized sample + the NaverPay-coverage answer confirm
a repeatable, sufficiently-complete export.

Why NAVER over Coupang for the *next evidence step*:
- NAVER's export is **walkthrough-confirmed** (리뷰 관리 → 엑셀다운 → `.xlsx`); Coupang's "export"
  hits are third-party scrapers, with no official export confirmed.
- Both have no usable review API, so an export is the only candidate route for either.

**Gating risk (must be resolved before any build):** if the NAVER export omits NaverPay/쇼핑
구매평 (potentially most SmartStore reviews), coverage may be insufficient. A real sample must
confirm coverage first.

Coupang review acquisition is **deferred** until an official export is confirmed. Its CS/inquiry
API is a separate track and is **not** reviews.

---

## D. Decision: do not build automation yet — finish evidence first

The walkthrough (#5) **partially landed**: the NAVER export's *existence* is confirmed
(Section W). It is **not** yet enough to build on — coverage, schema, repeatability, and
report/email availability are still open. **Still no RPA, no parser change, no browser
automation.**

**Progress:** a real sample was inspected and the schema is now known (Section S) —
headers match exactly, `리뷰글번호` is a complete & unique dedupe key, and the concrete
parser-hardening need is identified (NAVER aliases; body miss = 100% fail today).

**Updated next steps (each separately approved):**
1. **Resolve the NaverPay/쇼핑 coverage yes/no** (still the gating unknown — the file alone can't
   answer it; a `리뷰구분` enum-label check + the seller's total-count confirmation can). Section F.
2. **Parser hardening (candidate #4)** — additive NAVER aliases in `ReviewRowMapper` + a
   `리뷰등록일` date-format check; optionally capture `상품번호`. Smallest change; no new parser,
   no format change, no session automation. (Plan in Section S; not yet implemented.)
3. **NAVER seller-center export-automation spike** (candidate **#1**, opt-in, user-attended,
   Section-E guardrails) — only after coverage is confirmed sufficient and a committable
   **anonymized** fixture exists for tests.
4. **If a scheduled/emailed report exists, prefer email-attachment ingestion** (candidate **#3**)
   over browser automation (lower risk, no brittle UI driving).

Manual CSV/XLSX upload remains the **pilot fallback** (already built), explicitly not the
product destination. **Viability of NAVER review automation is not claimed** until the sample
file and NaverPay coverage are verified.

---

## E. Risks and guardrails (apply to any automation that follows — none yet)

- **No CAPTCHA/2FA bypass** — on a security challenge, stop and alert.
- **User-attended login only** — capture a session, never a password.
- **Encrypted session storage, with consent only** — reuse the existing envelope cipher
  (AES-256-GCM); decrypt in-backend, in memory, per run.
- **Manual re-auth on expiry** — expired session → fail closed → operator alert.
- **Official export only** — drive the seller center's own export; **no public-page scraping as a
  first choice** (third-party Coupang "review excel" scrapers are out of scope).
- **Minimal daily cadence** + rate-limited actions; never hammer.
- **Human-readable activity log** + **manual stop button**.
- **No raw leakage** — never log credentials, cookies, downloaded files, or raw review content;
  parse/persist only needed review fields.
- **Honesty** — do not mark a channel "reviews supported" until a real review source is verified;
  never present inquiries / Q&A / CS as reviews.

---

## F. What I need from you (to fill the unconfirmed cells)

**NAVER SmartStore (priority):**
1. **Review management page** — screenshot of 스마트스토어센터 → 리뷰 관리.
2. **Export button** — screenshot of the 구매평/리뷰 export (구매평 엑셀 다운로드) button and its dialog.
3. **Anonymized sample export** — a real exported review file (.xlsx/.csv) with reviewer
   names/IDs masked, so we can capture exact columns/format/encoding.
4. **NaverPay/쇼핑 구매평 coverage** — confirm whether those reviews are **included** in the
   export or **excluded** (this gates the whole direction).
5. **Date-range / filter / export-limit** — screenshots of available filters (date, product,
   rating, answered/unanswered, review type) and any row/date limits; whether download is
   **immediate** or an **async-generated report**.
6. **Scheduled / email report** — whether SmartStore can schedule or email a review report, or
   offers a report center.
7. (Helpful) whether the account's NAVER login uses **2FA / captcha** (affects user-attended automation).

**Coupang WING (to decide defer vs proceed):**
8. **Review / product-feedback page** — screenshot of any 상품평 / review management page in WING.
9. **Official review export?** — confirm whether WING has an **official** review export
   (Excel/CSV). If there is none, confirm so Coupang reviews stay **deferred** (we will not use
   third-party scrapers).
10. **Anonymized Coupang export sample** — only if an official export exists.
11. **Scheduled / email report** — whether WING offers one.

**Either channel:** a sample of any **emailed report** (headers + attachment format), if one
exists — this could unlock the lower-risk email-ingestion route (#3).

---

## Status / next step

Discovery document only — **no code, no RPA/browser automation, no COUPANG verifier work.**
NAVER export *existence* is walkthrough-confirmed (Section W); its *sufficiency for automation*
is not. Hold for approval. Immediate ask: an **anonymized NAVER export sample** + the
**NaverPay-coverage yes/no** (Section F). Then proceed with parser-compatibility analysis →
**#4 parser hardening**, then the **#1 NAVER export-automation spike** (or **#3 email ingestion**
if a scheduled/emailed report turns out to exist).
