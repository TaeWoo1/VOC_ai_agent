# Review Acquisition Capability Matrix v1

2026-09-13. **Investigation only — no code changed, no enum added, no schema touched, no marketplace
opened.** The question is narrow and factual: **per acquisition path, what review information does
reviewnary actually obtain today, and where exactly is the multimodal gap.**

Companion to `docs/review_acquisition_baseline_v1.md`, which owns the architecture, the call flows and
the runtime boundaries. That document is not restated here. This one adds the axis it does not have:
**field-level truth per path, and media as five separate questions instead of one.**

**Superseded on media by `docs/review_media_presence_audit_v1.md` (2026-09-13).** That audit measured
what this one could only describe, and two numbers here are corrected there: the Coupang rows that
reached the database through a counter are **32**, not 34, and `OperatorVocItem` has **24** record
components, not 17.

**And its Cafe24 conclusion is now overturned by measurement.** An approved bounded READ (3 requests,
integers out, nothing stored) found **1 of 7 board-4 articles in the last 365 days carrying 1
attachment** — so Cafe24 is `MEDIA_PRESENT`, not unknown, and this document's «contract says YES,
nobody has looked» is closed. Coupang and NAVER are unchanged. `reviews.media_count` also gained
`media_count_observed` (V101) so a zero can be told apart from a silence; the account/channel half of
the same milestone is `docs/core_channel_boundary_v1.md`.

## 0. Method — what counts as evidence here

Every cell below is one of three things, and they are never mixed:

| mark | means |
|---|---|
| **code** | read in this checkout, file and symbol named |
| **measured** | counted in the live local database (canonical Demo Org, 2026-09-13, read-only) |
| **contract** | a vendored vendor reference or a committed golden fixture in this repository |

**"없음" and "아직 확인 못함" are different claims and are never merged.** Where the repository can
only say "nobody has looked", the cell says `UNKNOWN` and the reason it is unknown.

**No Seller Center was opened, no marketplace was called, no connector was enabled.** The NAVER export
is judged only from the artefacts committed here: `contracts/review-export/naver/v1/*`.

---

## 1. The canonical model, first — because it bounds every path

`backend/src/main/java/com/sellerops/review/Review.java` + `reviews` (measured column list):

```
id · org_id · channel_id · product_id · rating · body(NOT NULL) · is_negative · received_at
external_id · content_hash · dedup_key_version · reply_state · replied_at
source_option_id · media_count · data_origin · acquisition_sync_job_id · created_at · updated_at
```

Three absences decide most of this document:

1. **There is no media reference column anywhere — only `media_count int not null default 0`.**
   `V37__review_source_option_and_media.sql` is explicit: a count of photos/videos *counted inside the
   review body cell only*, "Zero (not null) is the honest default for a source that does not report
   media at all." No URL, no blob, no attachment id, no table.
2. **There is no author/buyer column, by written design.** V37's closing paragraph: *"What is
   deliberately NOT here: any column that could hold a review author… the acquisition path resolves
   that column so it can refuse to read it, and there is no field on this table for the value to land
   in."*
3. **There is no seller-account column.** See §6.

`CanonicalReview` (`ingest/canonical/CanonicalReview.java`) mirrors this exactly: `mediaCount` is an
`int`, and there is no field a URL could occupy. So **no connector can pass a media reference across
the ingest boundary even if it read one** — the type does not have a slot.

---

## 2. Capability matrix

`✅` present and stored · `◻︎` present at the source but dropped before storage · `—` not provided by
the source · `?` unknown in this repository.

| Channel / Method | Text | Rating | Date | Product | ExternalId | Media availability | Media reference | Stored canonically | Attention usable | Known limitation | Evidence / code path |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Cafe24 API** (board 4 구매후기) | ✅ `content` | ✅ `rating` | ✅ `created_date` | ✅ `product_no` → catalog resolve | ✅ minted `cafe24:b4:a{no}` | **contract: YES** — `attach_file_urls[{name,url}]` is a documented response property, and `attached_file=T/F` is a documented list filter | ◻︎ **never projected** — `Cafe24BoardArticleRow` has no attachment field and `@JsonIgnoreProperties(ignoreUnknown=true)` drops it silently; the client never sends `attached_file` | text/rating/date/product/externalId only; `media_count` stays 0 | ✅ (body · rating · product · replyState) | reviews are **double-stored** (`cafe24_community_articles` + a promoted `reviews` row — measured 1:1 on the Demo Org: 134 board-4 REVIEW articles, 134 `cafe24:b4:a…` reviews); `reply_state` forced `UNKNOWN`; 비밀글 excluded fail-closed; **whether board-4 articles actually populate `attach_file_urls` is unobserved** | `Cafe24ApiConnector#primaryBoard` · `Cafe24BoardArticleRow` · `Cafe24BoardArticleMapper` · `Cafe24ReviewIssueBridge` · `Cafe24ReviewPromoter` · `docs/vendor/cafe24-admin-api/get-boards-articles.md` |
| **Coupang WING / Aside** (screen READ) | ✅ `body` (may be truncated) | ✅ | ✅ `writtenOn` | ✅ `productId` + `vendorItemId` (option is the 1차 key) | **— none exists** (no per-review identifier on the screen) | **partial: the reader counts `img`/`video` nodes inside the body cell** | ◻︎ **count only, by policy** — `mediaCountOf` returns `el.querySelectorAll('img, video').length`; no `src`, no alt, no dimensions ever leave the page | ✅ incl. `source_option_id` **and `media_count`** — the only path wired end-to-end | ✅ | **measured: `media_count > 0` on 0 of 34 WING-acquired rows**; no external id ⇒ textless reviews on one option/day/rating merge; **28 of 34 textless**; column-role vocabulary has **no media role** | `collector/src/action-window/coupang-review/review-row-inpage.ts` · `review-rows.ts` · `review-handoff-client.ts` · `AgentReviewHandoffService` · `docs/coupang_review_policy_gate_v1.md` D3/D7 |
| **NAVER Seller Center export** (XLSX) | ✅ `리뷰상세내용` | ✅ `구매자평점` | ✅ `리뷰등록일` | ✅ `상품명`+`상품번호` | ✅ `리뷰글번호` (10-digit) | **contract: the export HAS a `포토/영상` column** (col E of 25) | ◻︎ **no alias exists** — `ReviewRowMapper` maps 8 of 25 headers and `포토/영상` is not one; **what a real cell contains is `?`** | text/rating/date/product/externalId/replyState/repliedAt | ✅ | 17 of 25 columns dropped; `등록자`·`상품주문번호`·`유저정보 등록 항목` are PII and sentinel-asserted as never persisted; time-of-day discarded (UTC start-of-day) | `contracts/review-export/naver/v1/{SPEC.md,expected-rows.json,naver-review-export-v1.xlsx}` · `ingest/map/ReviewRowMapper` |
| **Manual CSV / XLSX upload** | ✅ (body **required** — a bodyless row is rejected) | ✅ | ✅ | ✅ | ✅ when the file carries one | **— no alias, any header** | ◻︎ same mapper, same 8 aliases | same 8 fields | ✅ | **identical parser to the NAVER export** — the only difference is `method`; a review with no body cannot be ingested at all | `UploadController` → `FileUploadConnector` → `FileParser` (CSV/XLSX sniffed by bytes) → `ReviewRowMapper` |

**Author / buyer identifier: not obtained on any path, and refused at three independent layers** —
Coupang resolves the 구매자 column in order to *exclude* it (`role: "excluded"`); the NAVER fixture
carries `REVIEWER-MUST-NOT-PERSIST` so a test can prove it never lands; Cafe24 leaves `writer`,
`writer_email`, `member_id`, `client_ip` unprojected; and `reviews` has no column for it.

**Source / account identity:** carried by the *run*, never by the review — `reviews.acquisition_sync_job_id`
→ `sync_jobs.method` + `seller_account_id`. `ExecutableIdentityResolver` reads that chain, and it is the
only thing that makes a review executable (`MARKETPLACE` vs `NONE`).

### 2.1 Attention pipeline input — the narrowest surface of all

`IngestedReviewVocItemSource` reads exactly: `body` (through `VocPreviewSanitizer`), `productId` →
product name, `rating`, `replyState`, `receivedAt`, `createdAt`, `id`. `OperatorVocItem` carries no
media field.

⇒ **`media_count` is stored and never consumed by Attention, triage, or issue extraction.** Its only
readers are `ChannelReviewItemView` / `ChannelReviewDetailView`, which render
`사진·영상 {n}` on the review record screen — a chip that has never once been drawn on real data.

---

## 3. Media audit — the five questions, answered separately

This is the part the brief asked not to guess at. For each path:

| | Cafe24 API | Coupang WING/Aside | NAVER export | Manual CSV/XLSX |
|---|---|---|---|---|
| **1. Does the source schema provide it?** | **YES** — `attach_file_urls[{name,url}]`, plus an `attached_file` list filter (vendored reference) | **YES** in the weak sense: photos/videos are on the screen (`coupang-wing-review-list.ts` states it), and there is an `img`/`video` count | **YES, a column exists**: `포토/영상` (col E of the 25-column real export) | **NO** — a CSV has whatever the seller's file has; no defined shape |
| **2. Does the parser read it?** | **NO** — no field on `Cafe24BoardArticleRow`; unknown keys silently dropped | **PARTIALLY** — counted, never referenced. `mediaCountOf` looks **only inside the body cell** and the role vocabulary (`excluded/date/rating/product/productName/body`) has **no media role**, so a dedicated 사진 column would be classified `unmapped` and never opened | **NO** — `ReviewRowMapper` has no alias for it; `expected-rows.json` does not assert it | **NO** — same mapper |
| **3. Does the canonical model preserve it?** | **NO** — `CanonicalCommunityArticle` has no attachment field | **COUNT ONLY** — `CanonicalReview.mediaCount:int` | **NO** | **NO** |
| **4. Does the DB store it?** | count column exists, always 0 | **`media_count` — the only wired producer** | no | no |
| **5. Does Attention consume it?** | **NO** | **NO** | **NO** | **NO** |

### 3.1 What the numbers actually say

Measured on the live local database, all reviews, 2026-09-13:

| channel | origin | reviews | `media_count > 0` | max | external_id | option_id | empty body |
|---|---|---:|---:|---:|---:|---:|---:|
| NAVER | REAL | 4,498 | **0** | 0 | 4,498 | 0 | 0 |
| CAFE24 | REAL | 207 | **0** | 0 | 200 | 0 | 0 |
| COUPANG | REAL | 46 | **0** | 0 | 12 | 32 | 28 |
| ↳ of which WING-acquired (no external id) | | 34 | **0** | 0 | 0 | 32 | 28 |
| ↳ of which CSV-uploaded (`RV-*`) | | 12 | **0** | 0 | 12 | 0 | 0 |
| GMARKET | REAL | 11 | **0** | 0 | 0 | 0 | 0 |
| (synthetic: NAVER/COUPANG DEMO_SEED, NAVER VERIFY_FIXTURE) | | 67 | **0** | 0 | | | |

**Not one row in the database, on any channel, by any path, has ever carried a media count above
zero** — including Coupang, the one channel whose producer exists and runs.

That refines a statement already in the repository. `docs/review_triage_contract_v1.md` §6 bans
「사진 있음」 as triage evidence and explains it as *"the in-page extractor that fills this column
exists only in `collector/src/action-window/coupang-review/`, and this org's reviews are all NAVER."*
The first clause is right; **the second is not: this org has 46 REAL Coupang reviews, 207 Cafe24 and
11 GMARKET.** The ban stands and is if anything better founded — the extractor that exists has
produced zero — but the reason should be corrected when that document is next touched.

### 3.2 Coupang: zero is `MEDIA_UNKNOWN`, not `MEDIA_UNAVAILABLE`

Two readings fit the zero, and this repository cannot choose between them:

- the 34 WING-acquired reviews genuinely carried no photos (28 of them are textless — a rating and nothing else); or
- the counter cannot see them, because it looks **only inside the body cell** while WING may render
  media in its own column or behind an expansion.

`docs/multi-channel-connector-roadmap.md` §4.1 already records this honestly as
「`mediaCount` 전 행 0(첨부없음/미감지 미확정)」 — 2026-08-15, and still true a month later on more data.
The probe that could settle it was written and never read out: `coupang-wing-review-driver.ts` declares
`{ id: "photoWord", exactText: "사진" }` and `{ id: "videoWord", exactText: "동영상" }`, and **no
recorded observation of either exists anywhere in the repository.**

Settling it costs **one approved read-only census sitting** and no new capability.

(The other 12 Coupang rows carry `RV-*` external ids and no option id — they arrived by CSV upload, not from
WING, which is why the "no per-review identifier" statement is about the 34 and not about the table.)

### 3.3 Cafe24: the only path where media is contracted and simply not asked for

`docs/vendor/cafe24-admin-api/get-boards-articles.md` — this repository's own vendored copy of the
reference — carries, in the GET response sample, literally:

```json
"attach_file_urls": [ { "name": "…", "url": "…" } ]
```

and lists it in the response property table as *"attached file detail"*, with `attach_file_url1`–`5`
accepted on `PUT`. The list endpoint even accepts `attached_file` (`T`/`F`) as a filter.

The connector reads none of it. `Cafe24BoardArticlesClient` sends `start_date`, `end_date`, `limit`,
`offset` (and `comment=T` on the comment sweep) and nothing else; `Cafe24BoardArticleRow` has no
attachment field, and `@JsonIgnoreProperties(ignoreUnknown = true)` means the key arrives and is
discarded without a trace.

**Two things are true at once and must not be collapsed:** the *contract* provides review media as
URLs, and *whether this seller's board-4 articles populate it* has never been observed — the live
verification record (`docs/sellerops_cafe24_review_inquiry_capture.md`) enumerates the keys it cared
about plus the PII keys, and attachments are not among either.

### 3.4 NAVER: the column is real, the cell is unknown

`contracts/review-export/naver/v1/SPEC.md` states the 25 headers are **the real NAVER seller-center
export** (리뷰 관리 → 엑셀다운), "established by a read-only inspection of a real seller export held
**outside this repository**". `포토/영상` is column E.

The committed fixture puts `https://example.invalid/synthetic-media-1` in that cell on one of six
rows. **That is the fixture author's choice, not an observation.** The SPEC documents what the fixture
carries for `답글여부` and `관련리뷰글번호` and says nothing about `포토/영상`; `expected-rows.json`
does not carry a media field at all, so no test asserts anything about it.

⇒ **NAVER media = `MEDIA_UNKNOWN`.** The column exists; whether a real export writes a URL, a count, a
`Y`, or a blank is not established in this repository — and the brief forbids opening Seller Center to
find out. The cheapest honest resolution is **one existing real export file, inspected read-only**, and
the repository has a standing note that its provenance (`review_acquisition.md` §S) survives only in
the preserved runtime worktrees.

### 3.5 Coupang's media boundary is a written commitment, not an oversight

`docs/coupang_review_policy_gate_v1.md` §5.1 — the product description sent to Coupang verbatim —
states: **「저장하지 않는 항목: 구매자 ID·닉네임 등 작성자 식별정보 일체, 이미지·동영상 원본」**, and
constraint **D7** reads *"Storable: review raw text, rating, date, product identifiers, **media
metadata**. Nothing else."*

So for Coupang, `media_count` is exactly the line that was drawn: metadata yes, originals no. Storing a
Coupang media URL or file is **outside a commitment this product made in writing**, and reopening it is
a product-owner decision with an external counterparty attached — not a technical change. **No equivalent
statement exists for Cafe24 or for the seller's own NAVER export.**

---

## 4. Biggest gap per channel

| Channel | The single biggest gap |
|---|---|
| **Cafe24** | **Media is in the contract, in this repository, and not read.** No new scope, no new endpoint, no new request — `attach_file_urls` arrives on a call already being made and is thrown away. It is the cheapest multimodal source the product has. |
| **Coupang** | **No per-review identifier**, which is what forces content-hash dedupe and merges textless reviews on one option/day/rating. Media is second and is policy-bounded; the identifier is structural and limits everything downstream (locate, outcome binding, re-attribution). |
| **NAVER** | **17 of 25 columns are dropped and nobody decided which of them matter** — `포토/영상`, `리뷰구분`(일반/한달사용), `리뷰도움수`, `전시상태`, `베스트리뷰`, `관련리뷰글번호`. The export is the richest source the product touches and the mapper reads a third of it. |
| **Manual CSV/XLSX** | **A bodyless review cannot be ingested at all** (`ReviewRowMapper` throws 「리뷰 내용이 비어 있습니다」, `Review.body` is `NOT NULL`). A photo-only or rating-only review — the majority shape on Coupang — has no route through this path, which is also the route every NAVER export takes. |

---

## 5. Do we need an acquisition-completeness model?

**Yes as vocabulary, not yet as an enum — and the four suggested values are not the right four.**

The audit above needed **two independent axes**, and collapsing them into one token would lose the
distinction the whole exercise exists to protect:

- **text completeness** — is the body whole? (Coupang: `bodyTruncated` / `bodyExpandable` already exist
  in the collector and **stop at the agent**; nothing reaches the DB.)
- **media knowledge** — which of the five §3 stages is the blocker, and is a zero a *measurement* or an
  *absence of measurement*?

`TEXT_COMPLETE / MEDIA_AVAILABLE / MEDIA_UNAVAILABLE / MEDIA_UNKNOWN` mixes those and, worse, makes
`MEDIA_UNAVAILABLE` unwritable today: **no path can currently justify it.** Cafe24 would be
`MEDIA_UNKNOWN` (contract says yes, population unobserved), Coupang `MEDIA_UNKNOWN` (counted zero,
detection unproven), NAVER `MEDIA_UNKNOWN` (column exists, semantics unobserved), CSV genuinely
undefined. **An enum whose only reachable value is `UNKNOWN` is a column that will be read as a fact.**

And there is a precedent this repository set for exactly this shape: `ChannelDataState`, where **only
`ZERO` may say 「없습니다」**. The same rule belongs here — *a media verdict may be `NONE` only when
something looked and found none*.

**Recommendation: no enum in this milestone.** If one is built later it should be per-path and
per-stage, derived rather than stored (the way tier is a read-time function), and it must be able to
say *which stage* is the blocker, because that is what tells an engineer what to build.

---

## 6. Review ↔ account coupling

### 6.1 Why an account-less review cannot enter the Decision Workspace

Observed live in the 2026-09-13 core-loop smoke: a CSV-ingested review renders
「이 리뷰의 판매 계정을 확인하지 못했습니다 · 리뷰 처리는 계정 단위로 열립니다」. The chain:

1. `/api/uploads` writes a `reviews` row bound to a **channel**. It creates no seller account, and
   `reviews` has no account column to bind one to.
2. `ReviewDetailService` answers `sellerAccountId` by
   `accounts.findByOrgIdAndChannelId(orgId, channel.getId())` — a **lookup**, not a stored fact.
3. The frontend route `/reviews/reply/:reviewId` redirects to the account-addressed workspace; with a
   null account there is nowhere to redirect, so it says so (deliberately — the branch exists and is
   commented).
4. Every workspace endpoint is under `@RequestMapping("/api/seller-accounts/{accountId}/channel-reviews/{reviewId}")`.

### 6.2 What the account actually contributes — one channel comparison

`ReviewDecisionWorkspaceService#requireReview`:

```java
SellerAccount account = accounts.findById(accountId).filter(a -> orgId.equals(a.getOrgId()))…
return reviews.findByIdAndOrgId(reviewId, orgId)
        .filter(r -> account.getChannelId().equals(r.getChannelId()))…
```

The review is found and authorized by **`(reviewId, orgId)`**. The account supplies **only its
`channelId`, for an equality check.** `ReviewTriageService#decide` does the identical thing after
`VocItemRef.parseReviewId(actionRef)`. The ref itself is `VocItemRef.forReview(review.getId())` —
minted from the review id alone, never account-bound.

The repository already wrote this down once, in `ReviewDecisionContextView`'s docblock:
*"the decision endpoint has never been capability-gated: it authorizes on org + account + channel and
nothing else. **What was gated was only the address.**"*

### 6.3 The schema agrees — Review Core is already account-independent

Measured across every `%review%` table in the database:

**Carries an account (5 of the `%review%` tables):** `channel_review_acquisition_ref` ·
`review_import_launch` · `review_import_plan` · `review_reply_execution` ·
`review_reply_submission_ref` — all five are **acquisition or marketplace execution**. (The scan was
by table name; `cafe24_community_articles`, the Cafe24 raw store, also carries `seller_account_id` —
and is likewise an acquisition-side table, which is the same pattern rather than an exception.)

**Carries none (24, including `reviews`):** `review_triage`, `review_triage_audit`,
`review_triage_actions`, `review_triage_corrections`, `review_triage_correction_audit`,
`review_correction_dispositions`, `review_issues`, `review_issue_evidence`,
`review_issue_state_events`, `review_reply_draft`, `review_reply_approval`,
`review_reply_approval_audit`, `review_reply_outcome`, `review_reply_template`, … — every
**decision** table.

⇒ **The account is already absent from Review Core's data.** The coupling is an addressing convention,
not a model.

### 6.4 The minimum change boundary

Three call sites, one predicate, no migration:

1. `ReviewDecisionWorkspaceService#requireReview` — drop the `account.channelId == review.channelId`
   filter (org scoping is the real authorization and already applies);
2. `ReviewTriageService#decide` — the same filter, same reasoning;
3. `ChannelReviewService#detail` — the same scoping, cited by both as the shared rule.

plus **org-scoped sibling routes** (`/api/reviews/{reviewId}/decision-context`, `/decision-log`,
`/triage`) so an address exists that does not name an account. The existing account-addressed routes
can stay verbatim — this widens, it does not move.

**What must NOT move with it:** the reply/execution lane. `ReviewReplyWorkLookup` gates on the channel
having a REPLY flow, and `review_reply_execution` / `review_reply_submission_ref` hold a real account
because a submission is made *by an account*. Decision is account-independent; **sending is not.**
That separation is exactly what Review Decision Workspace v1 established when it made the server mint
a `decisionRef` for Coupang reviews that can never be answered.

Cost: ~3 predicate edits + 3 routes + their tests. **Schema change: zero.**

---

## 7. The smallest boundary to attach multimodal

Not a pipeline. In ascending order of commitment:

| Step | Change | Why it is the smallest |
|---|---|---|
| **0. Decide the verdict vocabulary** | nothing built | §5 — today every path would say `UNKNOWN`, and a column whose only value is `UNKNOWN` reads as a fact |
| **1. Learn whether media is there at all** | one Cafe24 read-only sitting projecting **presence only**; one Coupang census reading out the `photoWord`/`videoWord` counters already written; one read-only look at a real NAVER export's `포토/영상` cell | costs no schema, no storage, no model, no new scope — and it is the only thing that can turn three `UNKNOWN`s into facts |
| **2. Carry presence** | `CanonicalReview.mediaCount` **already exists** and `reviews.media_count` already stores it. Cafe24 needs one projected field on `Cafe24BoardArticleRow` and `mediaCount = attach_file_urls.size()` | **no migration, no new table, no new canonical field** — the slot is there and empty |
| **3. Make it visible truthfully** | the `사진·영상 {n}` chip already renders; the triage ban (`review_triage_contract_v1.md` §6) lifts per-path once a producer exists **for that path** | the screen is already built |
| **4. Carry a reference** | the first genuinely new thing: a column or a table for `{name, url}`, plus retention, expiry, auth-on-fetch, and an SSRF-safe fetch contract | `Review` and `CanonicalReview` have **no slot**, so this is where "audit" becomes "build" |
| **5. Read the image** | a vision capability, its own flag/key/payload floor | `docs/image_product_knowledge_v1.md` already built this discipline for **product detail images** and left the lane `DEFERRED`; review media would be its second consumer, not a new architecture |

**The boundary line is between 3 and 4.** Everything up to 3 fits inside fields that already exist.
Step 4 is where a seller's customer's photograph starts being stored by this product, and step 5 is
where it is sent to a vendor — and `image_product_knowledge_v1.md` already recorded that as a
**product-owner decision, not a cost decision**, because the payload stops being sentences we chose
and becomes an original image whose contents are unknown before sending.

---

## 8. Readiness — re-judged

| Track | Verdict | Basis |
|---|---|---|
| **Cafe24 text pilot** | **READY** | board-4 read is live-verified, text/rating/date/product/externalId all stored, promoted into Review Core and consumed by Attention and issue memory. The pilot's remaining blockers are the host and the app registration (`pilot_launch_readiness_v1.md` §6), not acquisition. |
| **Coupang Aside pilot** | **TECHNICALLY READY / POLICY-GATED — unchanged** | acquisition is live-proven and `PILOT_ALLOWED`; GA stays `POLICY_GATED` (§4.1). The Aside provider is a **provider swap** behind the same `ReviewAcquisitionProbeDriver` and the same `CoupangAcquiredReview`, so it changes no field. Unresolved: no per-review id, textless merge residue, `bodyExpandable` stops at the agent. |
| **Provider-independent Core** | **LARGELY TRUE ALREADY, one addressing exception** | `reviews` and all 24 decision tables are account-free; Attention reads 7 fields and knows nothing about acquisition; the baseline's §15 says Core requires only four things of a path. The exception is §6 — the workspace address. |
| **Multimodal** | **NOT STARTED, and blocked on knowledge rather than on code** | stage 1 of 5 is `UNKNOWN` on all three channels; stage 3 preserves a count only; stages 4 and 5 are zero everywhere. Nothing here is built, and nothing should be until §7 step 1 has answers. |
| **Agent-native pilot** | **PARTIAL** | the agent reads reviews through the same account-free Core (`get_review_detail`, `search_review_issues`) and the tool catalogue is 100% READ. What is not agent-native is acquisition itself: every path needs a seated seller (Coupang WING screen, NAVER export segments) or an OAuth connection (Cafe24). |

---

## 9. Recommended next milestone

**Review Media Presence Audit v1** — one milestone, three read-only sittings, and no storage:

1. **Cafe24** — project `attach_file_urls` **presence and count only** on the call already being made,
   behind no new scope, and record what board 4 actually returns for this seller. This is the single
   highest-value hour in the document: it converts a documented contract into a measured fact.
2. **Coupang** — run the existing `photoWord`/`videoWord` census and read the counters out. Decide
   `MEDIA_UNAVAILABLE` vs `detector blind` for the 46 rows already collected.
3. **NAVER** — inspect one real export's `포토/영상` cell read-only, and record its shape in
   `contracts/review-export/naver/v1/SPEC.md` beside the columns it already documents.

Then, and only then, decide steps 2–5 of §7.

**Second candidate, independent of media and cheaper: Review/account decoupling** (§6.4) — three
predicates and three routes, no migration, and it closes a live-observed dead end where reviewnary
holds a review it cannot let the seller decide about.

---

## PRODUCT_DECISION_NEEDED

1. **May reviewnary store a review media *reference* (URL) at all?** Today it stores a count and has no
   slot for more. For **Coupang** this reopens a commitment made in writing to the counterparty
   (「이미지·동영상 원본」 저장하지 않음; D7 permits metadata only). For **Cafe24** and the seller's own
   **NAVER export** no such statement exists — so the answer may legitimately differ per channel, and
   pretending it is one decision would quietly extend Coupang's constraint or quietly break it.
2. **Is a customer's photograph seller data or customer data?** Everything in §7 step 4 follows from
   this, and the product has never had to answer it: `reviews` holds what a customer *wrote*, not what
   they *photographed*.
3. **NAVER export provenance.** The 25-column schema rests on `review_acquisition.md` §S, which
   **does not exist in the active repository** (it survives only in the preserved runtime worktrees).
   `contracts/review-id-fingerprint/v1/SPEC.md` already flags this as reported-not-fixed. Porting §S
   in — or accepting the fixture as the sole record — is a decision.
4. **Whether to widen the NAVER mapper beyond 8 of 25 columns.** `리뷰구분`(일반/한달사용),
   `전시상태`, `리뷰도움수`, `관련리뷰글번호` are all operationally meaningful and all dropped today.
5. **Review/account decoupling** (§6.4) — whether a review acquired without a connection should be
   decidable. Cafe24 pilots are unaffected; every file-upload seller is.
