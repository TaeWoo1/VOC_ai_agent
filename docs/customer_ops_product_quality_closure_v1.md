# Customer Ops Product Quality Closure v1

2026-09-18 · branch `feat/review-decision-workspace-v1` · follows `docs/knowledge_intelligence_closure_v1.md`

The gap this package closes: the Knowledge Spine worked on knowledge that already sat in the database. A **new**
production seller had almost none — so Reviewnary understood them only after they typed everything in. This package
makes the seller's existing operating history the first thing Reviewnary learns, makes the review rules stop closing
complaints on a rating alone, and re-measures inquiry grounding under the configuration a pilot org would run.

No new Responsibility type · no multimodal · no wiki/ontology · no prompt change · marketplace calls **0** · WRITE **0**
· migrations **0**.

## 1. What each channel lets Reviewnary learn — measured, not assumed

`knowledge/bootstrap/ChannelHistoryCapability` declares one row per channel × source, each with its repository
evidence. The seller sees the same sentence on the knowledge screen.

| | Past inquiry + seller answer | Past review + seller reply | Product detail |
|---|---|---|---|
| **NAVER** | **LEARNED** — both official resources return the published answer text (`answer` / `answerContent`); ingest stores `answer_body`; `InquiryAnswerMemoryImporter` records `IMPORTED_SELLER_ANSWER` on every ingest. Demo Org: 20/20 answered official rows carry the text. Routine reach 14 days; older history = the bootstrap's bounded READ | **SCREEN_UNPROVEN** — no review API; the Seller Center export's 25 columns carry 답글여부/답글등록일시 and **no reply text** (`contracts/review-export/naver/v1`). Whether the review screen exposes the text to a read is unobserved | **LEARNED, per product** — `NaverChannelProductClient` (`detailContent`, options) → `ProductDetailEnrichment`. 상품정보제공고시 sub-structure is not in the vendored contract and is not projected |
| **Cafe24** | **NOT_PROMOTED** — the answer is a child article (author not projected, so not provably the seller) or a comment (seller proven, body not stored) | **NOT_WIRED** — board comments are the documented resource the inquiry observer reads; no review path reads them | **LEARNED** — catalogue sweep stores description + spec facts |
| **Coupang** | **NOT_PROMOTED** — `commentDtoList` has no author field | **NOT_AVAILABLE** — no seller review reply | **LEARNED** — spec + taxonomy facts |

**Exact capability gaps (reported, not worked around):** NAVER review reply text has no official source; the next
step would be a bounded, approved READ-only observation of the Seller Center review screen (Aside), which needs a
live approval and was not run. Cafe24 review replies need a comment read on the review board (API exists, unwired).
Neither is faked here.

## 2. Production Knowledge Bootstrap

`KnowledgeBootstrapService.bootstrap(org)` — no parallel history store; every step is an existing path:

1. **Past inquiries + answers**: for each connected API account on a channel whose answers are provably the seller's
   (today: NAVER), one bounded READ over `[today − history-days, today]` KST (default 90) through
   `SyncRunExecutor`'s windowed backfill — the operator backfill's exact path (single-flight, cursor lane, ingest).
   The run's own `sync_jobs` row (`trigger = BOOTSTRAP`, `SUCCESS`) is the only «done» marker; failed, partial or
   coalesced runs are retried next time.
2. **Answer Memory import** (idempotent, no request) — the history becomes `IMPORTED_SELLER_ANSWER`, which the Spine
   already reads as `PAST_SELLER_ANSWER` authority.
3. **Product detail** via `ProductDetailEnrichmentTrigger` — one request per product, same switch
   (`sellerops.product.detail.enrichment.enabled`, default OFF), same staleness gate, over the products customers
   actually wrote about (inquiries + reviews, REAL rows, named products), most-discussed first, capped by
   `max-products` (30). This is a **second caller** of the trigger; the 2026-08-26 rule («none of them is reason to
   read a second product») is revised by this package's product-owner instruction and stays inside its bounds — never
   the catalogue, no image lane.

Triggers: the seller's button (`POST /api/knowledge/learned/bootstrap`, like 지금 동기화) and an automatic reconciler
for connected sellers without a finished read (`sellerops.knowledge.bootstrap.auto.enabled`, **default OFF** — it
makes READ requests on a seller's behalf and has not run live).

**Live status: `IMPLEMENTED · LOCAL_PROVEN · LIVE_UNPROVEN`.** On a disposable clone with connectors off, the button
failed closed (`FAILED — 채널에 자동 수집 커넥터가 없습니다`, request 0). The first real history read needs a
connected NAVER account and is a live READ run under the approval contract.

## 3. Intelligence safety

### 3-1. Review disposition — false AUTO_RESOLVED

All 18 false closes were **4–5★ with text**, labelled 확인 필요; none was textless. The rating cannot read words and the
triage tier is forbidden to (`ReviewTriageRules`). New rule (`OperationsCaseRules.forReview`):

- 4–5★ **textless** → AUTO_RESOLVED (unchanged — the only thing a rating may settle alone)
- 4–5★ with text + the issue extractor finds an asserted problem → **investigate** (`REVIEW_HIGH_RATING_PROBLEM`)
- 4–5★ with text otherwise → **MONITORING** (`REVIEW_HIGH_RATING_WITH_TEXT`, 14-day watch)
- 3★ with text + asserted problem → **investigate** (`REVIEW_WATCH_PROBLEM`); other 3★ → MONITORING (unchanged)
- 1–2★ unchanged

The extractor (production `issue-rules-v2`, negation-aware) only chooses between two outcomes that keep the review
open — it can add a look, never remove one — so the tier contract is untouched.

Measured on the full 218 labelled corpus (dev DB, read-only SELECT):

| | before | after |
|---|---|---|
| rules AUTO_RESOLVED | 114 | **0** |
| **rules false AUTO_RESOLVED** | **18** | **0** |
| MONITORING | 91 | 185 |
| handed to the investigator | 13 | 33 |
| MONITORING on 확인 필요 | 33 | 34 |

Agent leg (disposable clone, real investigator + model, 31 scored — 2 of the 33 are synthetic rows excluded by the
real-data filter): NEEDS_DECISION 28 · MONITORING 2 · AUTO_RESOLVED 1 (a 참고 review) · guards 0 · **false
AUTO_RESOLVED 0**. Pipeline total: **18 → 0**.

Cost stated: the 94 labelled praise reviews that used to close now sit in MONITORING for 14 days, and investigations
per corpus rise 13 → 33. Auto-close rate was not tuned. The extractor's recall is low (5 of the 18 assert a problem
it can see) — which is why the default for worded high ratings is MONITORING, not AUTO_RESOLVED.

### 3-2. Inquiry Quality Set — production-candidate retrieval

Same 36 synthetic cases, retrieval arm F5 (`text-embedding-3-large@1024` + question intent + rejection-only
eligibility judge, `gpt-5-2025-08-07@minimal`):

| axis | lexical (default-off deployments) | **semantic F5** | F5 without judge (diagnostic) |
|---|---|---|---|
| retrieval hit | 25/27 | 23/27 | 25/27 |
| wrong-product | 0 | **0** | 0 |
| wrong-policy | 1 | **0** | 4 |
| **false grounding** | 3 (Q20 Q21 Q22) | **0** | 5 |
| basis correct | 32/36 | 31/36 | 31/36 |
| gap named | 6/9 | 8/9 | 5/9 |

Live drafts under F5: refusals **9/9** (lexical 6/9) · unsupported claims **0** · figures carried 23/23 · drafts
23/27. The four unanswered (Q26 Q27 Q28 Q33; Q36 varied between runs) **all fail toward asking the seller**, none
toward a borrowed rule. The judge is what makes F5 safe: without it the semantic lane admits more wrong rules than
lexical does. No threshold, prompt or model was changed; the v2 parameters were not re-selected on this set.

Harness correction, stated: the first live F5 run flagged Q24 「2m」 as unsupported by substring; 「32mm」 (stated by the
corpus) contains that substring. The check is now figure-bounded and prints the surrounding text; the second run
scored 0. Whether the first run's text was 「32mm」 is not recoverable — reported as unverified.

## 4. Product Knowledge UX (minimal)

- **Knowledge screen «Reviewnary가 배운 것»** (`GET /api/knowledge/learned`): per source — past inquiry answers, past
  review replies, product detail (counted by product), seller material, 「다음에도 참고」 notes — a count, latest date
  and two examples with provenance and product; per connected channel, the capability sentence for each source
  (가져옴 / 가져오지 못함 + reason); and the «과거 운영 기록에서 배우기» button with a plain run summary.
- **Case screen**: a knowledge row that is a past seller answer carries 「지난 답변」; when the case has a gap, the
  teach card offers **「지난 답변을 기준으로 쓰기」**, which pre-fills the existing Teach form with that answer so the
  seller confirms (and may edit) it as current knowledge. A past answer alone still never grounds a reply.
- Teach → regenerate and 「다음에도 참고」 unchanged.

Browser QA on a disposable clone of the Demo Org (1440/1152): no horizontal scroll, off-host requests 0; the only
console errors are the absent local helper/agent runtime. Three copy defects found and fixed on the rendered page
(product count unit, fact example wording, titles repeating their excerpt), plus the run summary's remembered-answer
count (it reported rows touched by the import, 19, instead of the total remembered, 23). The case screen was not
rendered live — this DB has no investigated Customer Ops case — and is covered by its component tests.

## 5. Acceptance

| | evidence |
|---|---|
| fresh seller gains knowledge from history without writing | `KnowledgeBootstrapTest.historyBecomesKnowledgeForALaterCase` — NAVER answered rows (2 months old) → real ingest → Answer Memory → Spine |
| past answer retrieved in a later similar case | same test: the later question's evidence holds the `INQUIRY_ANSWER` entry, product-bound, provenance 「문의 답변 · 채널에 등록된 답변」; confirming it via Teach turns the case GROUNDED |
| unsupported → ask seller | same test (항균: NO_ANSWER_BASIS, evidence empty); quality set F5 false grounding 0, refusals 9/9 |
| review false AUTO_RESOLVED materially reduced | 18 → 0 (rules) and 0 (agent), §3-1 |
| strict isolation | same test: another org with the same product name and question sees nothing; another product of the same seller does not inherit a product-bound answer; quality set wrong-product 0 |
| bootstrap bounded / once / fail-safe | `theHistoryReadIsBoundedAndHappensOnce`, `anUnfinishedReadIsNotDone`, `productDetailFollowsCustomerActivity` |

## 6. Not done, reported

- NAVER review reply text — no official source; Aside observation needs a live approval (§1).
- Cafe24 review comments — API exists, not wired; Cafe24/Coupang inquiry answers not promotable without authorship.
- First live NAVER history read and the automatic lane — `LIVE_UNPROVEN`, both switches default OFF.
- Semantic F5 remains a deployment decision (vendor payload, cost, latency — `docs/knowledge_retrieval_quality_v2.md`);
  deployments without it keep the lexical numbers (false grounding 3).
- Worded 4–5★ reviews now wait 14 days in MONITORING; whether to spend agent calls on all of them instead is a cost
  decision, not taken.
- A DEMO_SEED product name can appear in a knowledge example (the example is the seller's own library row).
