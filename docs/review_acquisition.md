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
| **Seller-center review export** | **Likely yes, unconfirmed** — 리뷰 관리 → 구매평 엑셀 다운로드 [third-party]; NaverPay/쇼핑 구매평 may be excluded → [walkthrough-required] + [sample-required] (B5) | **Unknown** — no official export confirmed; "리뷰 엑셀" results are third-party **scrapers**, not a WING feature → [walkthrough-required] (B6) |
| **Scheduled report / email** | Unknown — no public evidence → [walkthrough-required] (B7) | Unknown — no public evidence → [walkthrough-required] (B7) |
| **Browser-automation feasibility** | Medium — contingent on an official export existing; NAVER login may present 2FA/captcha → user-attended only | Unknown — contingent on an official export existing at all |
| **Risk** | Medium | Medium–High (no confirmed official review source) |
| **Recommended review route** | Seller-center export automation (opt-in) **only if** the export is confirmed by walkthrough + sample; prefer email-report if one exists | **Defer** review acquisition until an official export is confirmed. (CS/inquiry API is separate and is **not** reviews.) |

**What is established vs. open:**
- Established: **no product-review retrieval API was found for either channel** — for NAVER via
  the vendor's explicit statement, for Coupang via its *absence* in the reviewed official docs
  (not an official "unavailable" statement). So official API integration cannot be the
  review-ingestion path; reviews must come from a seller-center **export** or an emailed report.
- Open (gates everything actionable): whether an **official** seller-center review **export**
  exists on each channel, and its shape/coverage. These are unconfirmed and need user evidence.

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

**B5 — NAVER, seller-center review export: likely yes, unconfirmed.**
- Third-party guides describe 스마트스토어센터 → **리뷰 관리 → 구매평 엑셀 다운로드** (used to
  migrate reviews elsewhere).
  - https://imweb.me/blog?idx=402 ; https://www.cre.ma/blog/link-smartstore [third-party]
- Same sources flag that **NaverPay/네이버쇼핑 구매평 may not be exportable** → the export could
  be incomplete. **Third-party blogs are not proof of an official export.** Confirm the button,
  filters, format, coverage, and limits via screenshots + a real sample. [walkthrough-required] + [sample-required]

**B6 — Coupang, seller-center review export: unknown.**
- Searches for "쿠팡 상품평 엑셀 다운로드" return **third-party scraping services** (paste a product
  URL → scrape reviews), e.g. https://kmong.com/gig/553334 [third-party]. These are **not** an
  official WING export and are out of scope. Whether WING itself offers an official 상품평 export
  is **unconfirmed**. [walkthrough-required]

**B7 — Scheduled / emailed review reports (both channels): unknown.**
- No public evidence found either way. [walkthrough-required]

---

## C. First discovery target — NAVER SmartStore (a target to verify, not a build decision)

**NAVER is the first discovery target because a seller-center review export appears plausible
([B5], third-party-documented) and must be verified — not because it is proven ready for
automation.** No automation should be built until a walkthrough + real sample confirm an
official, repeatable, sufficiently-complete export.

Why NAVER over Coupang for the *next evidence step*:
- NAVER has at least third-party-documented evidence of an *official* export (구매평 엑셀
  다운로드); Coupang's "export" hits are third-party scrapers, with no official export confirmed.
- Both have no usable review API, so an export is the only candidate route for either.

**Gating risk (must be resolved before any build):** if the NAVER export omits NaverPay/쇼핑
구매평 (potentially most SmartStore reviews), coverage may be insufficient. A real sample must
confirm coverage first.

Coupang review acquisition is **deferred** until an official export is confirmed. Its CS/inquiry
API is a separate track and is **not** reviews.

---

## D. Decision: do not build automation yet — collect evidence first

**Chosen next step: candidate #5 — manual seller-center walkthrough + sample-file collection.**
Not production RPA, not a parser change, not browser-automation code. Every downstream choice
(parser schema, automation steps, scheduling, coverage) depends on facts we do not yet have.

Evidence-collection step (#5) must produce:
- seller-center walkthrough (NAVER first; Coupang to confirm defer-vs-proceed),
- screenshots of the review-management page and any export button/dialog,
- a real **anonymized** sample export (CSV/XLSX),
- the export **column schema**,
- **repeatability** and **date-range/row limits**,
- whether a **scheduled/emailed** report exists.

Only after #5 confirms an official, repeatable, sufficiently-complete export do we proceed —
in this order, each separately approved:
1. **#4 — Parser hardening** against the *real* export schema (no session automation; pays off
   under every route).
2. **#1 — NAVER seller-center export automation spike** (opt-in, user-attended, Section-E guardrails).
   - **#3 — Email-attachment ingestion** is *preferred over #1* if the walkthrough reveals a
     scheduled/emailed report (lower risk, no brittle UI automation).

Manual CSV/XLSX upload remains the **pilot fallback** (already built), explicitly not the
product destination.

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
Hold for approval. On approval and once the Section-F evidence (especially a real NAVER export
sample + the NaverPay-coverage answer) is in hand, proceed with **#4 parser hardening**, then the
**#1 NAVER export-automation spike** (or **#3 email ingestion** if a report turns out to be emailable).
