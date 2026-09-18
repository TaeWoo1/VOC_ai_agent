# Customer Ops Demo Closure v1

2026-09-18 · branch `feat/review-decision-workspace-v1` · follows `docs/customer_ops_product_quality_closure_v1.md`

Goal: «Reviewnary knows the seller, observes customer operations, handles most work, asks only when needed, and can
act after approval.» This document records what is built and proven offline, and the four live runs that remain —
each needs its own approval under `docs/sellerops_live_approval_contract.md`.

## 0. Product decisions applied

1. **Pilot retrieval** (embedding + question restatement + evidence relevance check) — **ON for the pilot
   allow-list**, global default OFF. `deploy/pilot/pilot.env.example` now ships the three flags `true`; `deploy.sh`
   and the backend boot validator still refuse to start until each has its key and the pilot organisation's UUID
   (never `*`).
2. **Review safety** — the conservative policy stays: textless 4–5★ may auto-resolve; an asserted problem goes to
   the Agent; other worded 4–5★ are MONITORING. Auto-close rate is not optimised.

## 1. Built and proven offline (commit `016adbb4` + this commit)

| Area | What exists now | Proof |
|---|---|---|
| **Review media (canonical)** | `review_media` (V112): one row per attachment the channel observation read — a CDN **reference**, never bytes; accepted only from the channel's image CDN over https. `inspection_status` is a separate fact (`NOT_INSPECTED` / `INSPECTED` / `FETCH_FAILED` / `MODEL_FAILED` / `NOT_AN_IMAGE`); a DB check forbids a description without `INSPECTED` | `ReviewMediaLaneTest` |
| **Observation → media** | `NaverReviewObservationRequest.Review.attachments` (optional; count must equal `attachCount`); the service writes them onto the canonical review after ingest. The helper's page script projects addresses only when `NAVER_REVIEW_ATTACH_URL_KEY` is set — **null until the live census (M2) names the field**; no guessed key | collector 1,049 tests; backend observation tests |
| **Vision capability (12th)** | `ReviewMediaInspector` is the one door: org-gated, OFF by default, own key/model (`gpt-5.6-terra`), ≤3 photos per review, fetched under `ImageFetchPolicy`, sent as bytes (never the address) with only that review's rating and redacted words | payload-floor assertions in `ReviewMediaLaneTest`; `AgentDraftBoundaryTest` (new row); `DetailImageFetchBoundaryTest` (new holder) |
| **Vision in investigation** | Review cases get `[m*]` lines: an inspected photo is described and citable; an uninspected one is «보지 못했습니다(이유)»; a count without addresses is only `[media] …있다는 것만 확인`. Prompt v4 adds one rule | `CaseInvestigationMediaTest` |
| **Case screen** | original content + photos (served same-origin through an authenticated endpoint that re-fetches under the same policy; CSP unchanged) with inspection status and what was seen; knowledge/provenance, recommendation, why seller, Teach, 「지난 답변을 기준으로 쓰기」, draft and the link to the approval screen | `OperationsCase.test.tsx` (7) |
| **Home** | adds 「최근 24시간 동안 N건을 확인했습니다」 (every customer case opened in the window) ahead of auto-resolved · monitoring · prepared · verifying; decisions and collection/auth gaps unchanged; real rows only | `customerOperations.test.ts`, processor home test |
| **Synthetic leakage** | 「Reviewnary가 배운 것」 counts and examples exclude anything standing on a non-REAL product | `KnowledgeBootstrapTest.syntheticProductsNeverReachTheLearnedView` |
| **Full single-item chain** | scheduled run → case → investigation (NEEDS_DECISION) → prepared draft → seller approval through the **production** `InquiryPublishService` → adapter publish + read-back → execution + verification rows → next run closes the case `ACTED / SELLER_ACTED`, quoting the lifecycle; nothing hand-inserted between steps, the channel adapter is the only fake | `OperationsCaseProcessorTest.theChain_…` |

## 2. Demo validation suite A–H

| | Scenario | Offline proof | Live |
|---|---|---|---|
| A | positive routine review → AUTO_RESOLVED | textless 4–5★ auto-resolve; worded praise → MONITORING (policy 0-2) — `OperationsCaseReviewRulesTest`, processor test | — |
| B | repeated/problem review → MONITORING or Issue | 3★/4–5★ with an asserted problem → investigated; issue extractor + agent leg 31/31 non-false (`docs/customer_ops_product_quality_closure_v1.md` §3-1) | — |
| C | grounded inquiry → draft | `KnowledgeIntelligenceClosureTest`; quality set F5 live: drafts 23/27, unsupported 0 | — |
| D | missing knowledge → ASK → Teach → regenerate | `KnowledgeIntelligenceClosureTest` | — |
| E | later similar case reuses taught/decision context | `KnowledgeIntelligenceClosureTest`, `KnowledgeBootstrapTest` | **M1** (real NAVER history) |
| F | image review → vision investigation | `ReviewMediaLaneTest`, `CaseInvestigationMediaTest` | **M2 → M3** |
| G | approved inquiry → external WRITE → verification | chain test (fake adapter); NAVER/Cafe24 WRITE lanes previously `LIVE_VERIFIED` (08-25/26) | **M4** |
| H | observation/auth failure → truthful, never 0 | processor gap tests; `theHomeShows…NeverRendersAnUnobservedSourceAsZero`; bootstrap with connectors off → `FAILED`, 0 requests | — |

## 3. Live runs that remain — four manifests

All run against a **disposable clone** (`createdb -T sellerops sellerops_demo_live`); the dev database stays
read-only. Worktree backend at this commit on port 8091 with scheduler, self-pilot, proactive and the responsibility
scheduler OFF. Canonical Demo Org, NAVER account `bdccb7a7`. NAVER Commerce calls require this machine's egress IP to
still be registered with the NAVER app (it was for the 08-22/08-26 proofs).

**M1 · NAVER 90-day inquiry + answer history (READ_ONLY)**
- operation: press the seller path `POST /api/knowledge/learned/bootstrap` once
- allowed live actions: `GET /v1/contents/qnas` and `GET /v1/pay-user/inquiries`, paged, window 2026-06-20…2026-09-18
  (KST); product-detail enrichment **OFF** (no detail reads)
- max actions: ≤ 40 GETs · WRITE 0 · model calls 0
- then, local only: the imported answers appear in 「Reviewnary가 배운 것」, and a later similar synthetic question on
  the clone retrieves one with provenance 「문의 답변 · 채널에 등록된 답변」

**M2 · NAVER Seller Center review row-model census (READ_ONLY, Aside u0, operator logged in)**
- operation: open `sell.smartstore.naver.com/#/review/search`, one in-page evaluate, close
- reports **only**: for rows with attachments — the entry key names, value types and URL host; for rows with
  `hasComment = true` — the names of row keys holding non-empty strings other than `reviewContent`, with lengths
- clicks 0 · input 0 · scroll 0 · download 0 · no text values leave the page
- outcome decides: `NAVER_REVIEW_ATTACH_URL_KEY` (F), and whether a reply-text field exists (the NAVER review-reply
  knowledge lane — built only if it does; otherwise recorded as the exact gap)

**M3 · one image review end-to-end (READ_ONLY + vision)** — prepared after M2, because M2 changes code (the key)
- scheduled NAVER review observation on the clone → canonical review + `review_media` → one CDN fetch per photo
  (≤3) → vision model (≤3 calls) → investigation (1 model call) → case evidence and disposition
- WRITE 0

**M4 · one approved NAVER inquiry answer (mode WRITE, max 1)**
- target: one of the three REAL NAVER inquiries still UNANSWERED in the dev database (09-03/09-05) — **the operator
  chooses which and writes/approves the text**; the run re-reads its state first and stops if it was answered
- allowed live actions: 1 answer call on that inquiry through the existing adapter + its read-back verification
- then: the case on the clone closes `ACTED` from the answer lifecycle
- note: the NAVER 상품 문의 answer call **overwrites** an existing answer; the pre-send check refuses when state is
  unproven

## 4. Not done yet, and why

- M1–M4 above: not run — each needs a fresh approval.
- NAVER review reply text: not implemented — whether it can be read at all is exactly what M2 answers.
- Decision Memory on a second similar case: covered offline (E); a live second case would come from M1's history.

## 5. Live results (2026-09-18)

**M1 — PASS.** One press of the seller path on a disposable clone: 2 NAVER list GETs (+ token exchange), 17 inquiries in
the 90-day window (5 new/changed, 12 unchanged), remembered past answers 23 → 27. A later question sharing the stored
question's key nouns («난연 소재 맞나요? 주방 쪽에 쓰려고 합니다») retrieves the 09-05 seller answer with provenance
「문의 답변 · 채널에 등록된 답변」; the same question on another product retrieves nothing. Looser paraphrases sharing
one noun are `NO_RELEVANT_EVIDENCE` under lexical retrieval (M1 made no model calls, so the pilot semantic retrieval
was off). The three NAVER inquiries that were unanswered on 09-03/09-05 are now answered on the channel — M4 needs a
new candidate.

**M2 — PASS.** Row model of the default period: 48 rows, 24 attachments on 23 rows. Each attachment entry carries
`attachUrl` and `attachPath` (https, `phinf.pstatic.net`, jpg/jpeg), `reviewAttachmentType` (`I` on all 24), and
size/name/description keys. No row in the period had `hasComment = true`, and no row key holds reply text — the list
model exposes only the boolean. Implemented: `NAVER_REVIEW_ATTACH_URL_KEY = "attachUrl"`, `I` → IMAGE, anything else
UNKNOWN. **NAVER past review reply text: UNAVAILABLE from the list surface** (API: none; export: flag and date only;
list model: flag only). Unobserved: whether an answered row adds a field, and the detail modal (a click, out of scope).

**M3 — PASS, one step substituted.** Activating Customer Ops on a disposable clone opened a run; the scheduled Aside
read (one page read, no interaction) stored 48 reviews and 24 photo references (all `IMAGE`, `phinf.pstatic.net`).
Review `9046894c` (★5, 2 photos, 80 characters): 2 fetches, 2 vision inspections (both `INSPECTED`, problem visible
`NO`: a bag of white molding connectors; an open box with bagged white molding and connectors), 1 investigation citing
`subject, m1, m2` → agent `AUTO_RESOLVED` / `NO_ACTION` / HIGH. The case screen's read shows both photos as
「Reviewnary가 사진을 확인했습니다.」 with what was seen, and the photo endpoint served the image (3/3 fetches used).
Substituted: opening the case (reviews present at a source's first settled read are handed over and never opened by the
processor). The rule classifies this review MONITORING; the investigation was invoked explicitly for the proof.
Defects seen, not fixed: the photo tool has no label in 「Reviewnary가 확인한 것」; an agent-closed case keeps the rule's
「지켜봅니다」 reason sentence.

**M5 — BLOCKED_AT_READ, nothing stored.** All 5 candidates (2026-08-21) were in the list model, marked replied, rendered,
each with exactly one detail control naming its own id (no direct URL). One detail was opened and closed (2 of 6
clicks). The committed reader found **no AngularJS scope** on the detail pop-up, so the reply cannot be read from a view
model there; the other targets were not opened. Next: a READ-only structure census of the open detail (DOM section
names/lengths only) to identify the reply element, then a reader change and a fresh approval.

**M5 (resumed) — PASS.** Discovery (2 clicks, structure only): the detail pop-up exposes no view data, shows neither the
review id nor a reply date, and pre-fills the existing reply in its reply textarea under 「판매자답글」. The reader now
reads that field, fail-closed on six checks (one pop-up; the pop-up's review text equals that id's row-model text,
compared in the page; one label; one bound field; untouched form; non-blank). Three replied reviews read in 6 clicks,
stored on their canonical reviews with the export's 답글등록일시 and source `NAVER_REVIEW_DETAIL_V1`; a repeat
recorded nothing; the Spine finds a reply for the same product as 「리뷰 답글 · 채널에 등록된 답글」 and not for
another product; another organisation gets 404 for the product, nothing company-wide, and cannot write onto the review.

**M4-R — no draft, correctly.** The only unanswered NAVER product question is `naver-qna:689162087` (2026-09-17,
「종이컵 9oz 크기도 디스펜서 제품 판매하시나요?」, product 「종이컵보관함 수거함 디스펜서 컵 홀더」). The product has no
company knowledge, so the draft path returned `NO_ANSWER_BASIS` and made no model call. The second read could not
re-see the question (the list is filtered by posting time), so «unanswered» stands as of 15:30:08 KST; the send path
re-reads the answer state immediately before any write.
