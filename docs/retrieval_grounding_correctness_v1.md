# Retrieval & Grounding Correctness v1 (2026-08-30)

**Scope.** The four retrieval defects the Agent Context/Reasoning integration QA (2026-08-29) named. Not a
new RAG engine: the deterministic lexical retriever (`KnowledgeRetriever`/`KnowledgeText`) and its
thresholds are **unchanged**; what changed is what it is asked, what its empty answer means, and which
store a "past answer" question reads. Knowledge Capture, UI rework, planner latency and vector search
are out of scope. Conversation Object Integrity v1 is untouched.

| # | Defect | Root cause | Change |
|---|---|---|---|
| 1 | 「반품 조건」 finds the product's 「교환 및 반품 안내」; the planner's sentence about the same document finds nothing | The absence gate is a ratio over the question's content words. Title+body+instruction glued into one string carries a dozen words no note contains (확인·명시·가능·있는지…), and the ratio sinks under them | **`RetrievalQuery`** — one question is searched as ≤4 bounded candidates in order: `TOPIC` (a structured topic the caller resolved) → `TITLE` → `SUBJECT` (content words minus a closed list of instruction/meta words, ≤8 from the front) → `FULL` (title+head of body, 400 chars). Each candidate meets the unchanged gates; the first that yields an applicable passage answers. Shared by the product library, the operating rules, the answer memory and the draft composer; the three search endpoints normalize their `query` the same way, so the runtime no longer has to craft queries. |
| 2 | 「등록된 상품 지식에 해당하는 내용이 없습니다」 said of knowledge that exists | One empty list for four different facts | **`RetrievalOutcome`** on every search response and on `InquiryEvidence` per lane: `FOUND` · `ABSENT` (nothing to search) · `NO_RELEVANT_EVIDENCE` (documents, no covering passage) · `NOT_APPLICABLE` (lexical hits, all rejected by the applicability gate). Seller-facing wording follows it — ABSENT 「등록된 배송 기준이 아직 없습니다.」 · NO_RELEVANT 「등록된 상품 정보에서 이 질문에 해당하는 근거를 찾지 못했습니다.」 · NOT_APPLICABLE 「배송 기준은 등록되어 있지만, 이 문의에 적용할 근거로 확인되지는 않았습니다.」 — in the Agent findings, the draft's `answerBasisAction`, and the KNOWLEDGE_ENTRY step (offered only when a rule is *missing*, never for NOT_APPLICABLE). |
| 3 | 「정책 없음」 vs 「정책 있음·비적용」 indistinguishable; 「배송 기간」 could adopt a return document on 배송비 overlap | The scorer has no applicability axis | **`KnowledgeTopic`** — a closed word table (배송/교환·반품·환불/주문 취소/결제/세금계산서/현금영수증) read from the question and from a document's *declaration* (its `OrgKnowledgeType` and its title; never its body). A passage is rejected only when both sides name topics and share none — the gate can refuse a hit, never admit one. Product docs, rules and the composer share it; the runtime's §29 POLICY noun routing keeps producing the `TOPIC` candidate. |
| 4 | 「예전에 뭐라고 답했어」 routed to `search_customer_memory` (signature store, no answer text) → 「찾지 못했습니다」 over 8 remembered answers | No READ over `answer_memory` in the Agent lane | **`GET /api/answer-memory/search`** (org-scoped, the same `AnswerMemoryService` the composer's memory lane reads) → READ tool **`search_answer_memory`** → closed need token **`PAST_ANSWER`** (planner prompt v8, parser, runtime need/evidence kinds, reachability matrix, scope: product-anchored when a product is named, else org). `CUSTOMER_HISTORY`/`search_customer_memory` keep their signature meaning; the tool description no longer promises answer text. Memory order unchanged: relevance → strength (VERIFIED > USER_APPROVED > IMPORTED) → recency. AI drafts/fallbacks are still never in the store; a memory-only match still never makes a draft GROUNDED. |

Also closed on the way: a coverage-limit finding was dropped from the prose as a "restated count" when the product name carried a digit (「전선몰딩 1호」 under 「상품 1개」) — gap sentences are exempt from that dedupe.

## Verification

Unit/integration (real scorer, DataJpa): `RetrievalQueryTest`, `KnowledgeTopicTest`, `ProductKnowledgeRetrievalOutcomeTest` (A/B/C/F/ABSENT/undeclared), `SellerOperationsKnowledgeServiceTest` (+D/E/F/long-thread), `AnswerBasisStateTest` (outcome-aware actions), `AgentOperatorResponseParserTest` (v8). Runtime `retrievalGrounding.test.ts` (E ×3, F ×2, G ×2, J) over the real graph. Backend full suite green; runtime 663; frontend untouched.

Live (disposable org `QA 검색근거`, real planner; this tree):

| Case | Result |
|---|---|
| A 「반품 조건」 | FOUND `교환 및 반품 안내` score 1.0 · 17 ms · 1 candidate |
| B planner sentence | FOUND the same document via its SUBJECT form · 8 ms · 1 candidate |
| C 「배송 기간」 | `NOT_APPLICABLE` (1 hit rejected), passages 0 · 9 ms |
| D no shipping rule | endpoint `ABSENT`; composer action 「등록된 배송 기준이 아직 없습니다…」 (model 0); Agent `ORG_POLICY_GAP outcome=ABSENT` + KNOWLEDGE_ENTRY |
| E shipping rule registered, tax-invoice inquiry | endpoint `NO_RELEVANT_EVIDENCE` (docs 1, 2 candidates); composer action 「등록된 세금계산서 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.」 (rules exist, none declares TAX_INVOICE → absence *for that topic*); Agent 「이 문의에 우리 세금계산서 기준으로 답변해줘」 → `ORG_POLICY_GAP outcome=ABSENT` + KNOWLEDGE_ENTRY. Never 「운영 기준 없음」 about the shipping rule, never 「상품을 연결하면」 |
| F product docs exist, 「방수 되나요?」 | endpoint `NO_RELEVANT_EVIDENCE` · 10 ms · 2 candidates; Agent 「QA 전선몰딩의 등록된 상품 정보(1건)에서 이 질문에 해당하는 근거를 찾지 못했습니다.」 |
| G 「QA 전선몰딩 문의에 예전에 뭐라고 답했어?」 | tools `resolve_product` → `search_answer_memory` (customer memory **not** called); the VERIFIED answer is quoted with its strength and date; `PAST_ANSWER` evidence carries `memoryId`. 「…방수 문의에 예전에…」 (a topic the record lacks) stays `NO_RELEVANT_EVIDENCE` |
| H memory only (product doc deleted) | composer `NO_LIBRARY` / `NO_ANSWER_BASIS`, no draft, model 0 — while the memory endpoint finds the same VERIFIED answer for 「반품 조건」 |
| I variant isolation | unchanged code path (`KnowledgeVariantScope` filters the document set before ranking; candidates run inside it) — covered by the existing composer/variant tests; no variant data on the QA org |
| J 「최근 문의 3개 보여줘」 | tools `list_inquiry_rows` only — knowledge 0 · rules 0 · memory 0 |

**Browse rule (found live, closed).** A product-anchored 「예전에 뭐라고 답했어」 names no topic, so the lexical
gate rightly matched nothing over a product with a verified answer. `AnswerMemoryService` now answers such a
question by *listing* that product's record (strongest, then newest) — only when the residual topic words
(question minus the product's name, `SUBJECT_STOP` and the closed `PAST_ANSWER_PHRASING`) are empty. A question
that names a topic and misses stays a miss. The runtime passes `productName` for the discount.

**Measurements.** Retrieval latency 5–18 ms per lane (local DB, ≤2 candidates tried on every live query, 4 is the
cap). Planner calls: 1 per Agent turn, as before (the PAST_ANSWER turn spent 1 plan + 1 repair round, the
planner's own retry); draft model calls: only on GROUNDED (2 in this run, both on the 배송 문의 once the rule
existed); judge rule-based. No new model call was introduced for keyword extraction. False positives: C and the
topical-miss cases stay refused; thresholds unchanged.

## Not fixed, reported
- The R4 product headline 「방금 본 리뷰를 상품 1개로 묶었습니다.」 precedes product-scoped answers that involved no
  review (pre-existing wording; outside this package's minimal-wording rule).
- A PAST_ANSWER need with no product anchor searches unbound memories only; its ABSENT sentence 「저장된 과거 답변이
  아직 없습니다」 is true of that scope, not of the org (the QA org's one memory is product-bound).
- The planner sometimes adds a PAST_ANSWER need to a policy request (E2) — harmless, one extra READ.
- Knowledge Capture (saving a seller's typed answer as knowledge) is still not built.

## Side effects and residue (exact)
- Disposable org `QA 검색근거` (`ac41fafe…`): signup; 3 inquiries via `/api/uploads`; 1 product document and 1
  shipping rule via product endpoints (the document later deleted via API for H); **SQL fixture**: 1
  `seller_accounts`, 3 `inquiry_work_item` OPEN, 1 `answer_memory` row (EXECUTOR_SENT_VERIFIED, product-bound);
  product flows then wrote 3 proposals and 2 MODEL drafts. **All removed after the run** (see cleanup below).
- Demo Org: **0** writes. Marketplace calls **0**. Backend booted with the QA org appended to the plan/draft/judge
  allow-lists through a wrapper (no env file edited) and restored to the original env afterwards.
- **Cleanup (done):** API-deleted the rule and the document; SQL-deleted the org's rows in FK order
  (`inquiry_draft_evidence` 2 · `inquiry_reply_draft` 1 · `inquiry_proposal` 3 · `inquiry_work_item_audit` 3 ·
  `inquiry_work_item` 3 · `customer_memory_entries` 3 · `item_analyses` 3 · `agent_llm_usage` 17 · `answer_memory` 1 ·
  `inquiries` 3 · `sync_jobs` 1 · `seller_accounts` 1 · `products` 2 · `users` 1 · `organizations` 1) and the runtime
  store scope. Verified: rows for the org 0, orphan work items/drafts/evidence 0, Demo Org `ae51c7f8` still ANSWERED,
  Demo `answer_memory` 22 → 22, Flyway still at V88 (no migration in this package).

---

# Retrieval Query Selection v1 (2026-08-30, closes the residue above)

**Scope.** One defect: the same stored Product/Org knowledge was `FOUND` for the seller's short question and
`NO_RELEVANT_EVIDENCE` for the planner's need question about it. No new feature, no UI, no Knowledge Capture, no
planner change, no threshold change, no scorer change; retrieval candidate cap (4) unchanged; migrations 0.

## 1. The failure, traced (real planner, disposable org 「QA 질의선택」, product 「QA 전선몰딩」, one document 「교환 및 반품 안내」)

Same endpoint, same document, before the fix — `GET /api/products/{id}/knowledge/search`:

| Input | Who wrote it | SUBJECT candidate | askable ratio (gate 0.35) | outcome |
|---|---|---|---|---|
| 「반품 조건」 | seller | `반품 조건` | 1.00 | FOUND |
| 「QA 전선몰딩 반품 조건이 명시돼 있는지 확인해줘」 | seller | `qa 전선몰딩 반품 조건이` | 0.80 | FOUND |
| 「‘QA 전선몰딩’의 상품 설명/FAQ/정책 문서 중 반품(교환·반품·환불) 조건이 명시된 문장이 있는가」 | planner (run I) | `qa 전선몰딩 설명 faq 문서 반품 교환 환불` | 0.31 | NO_RELEVANT_EVIDENCE |
| 「‘QA 전선몰딩’ 상품의 판매자 작성 문서(상품 설명·FAQ·정책) 중 반품 조건이 명시돼 있는지 확인」 | planner (run I2) | `qa 전선몰딩 상품의 작성 문서 설명 faq 반품` | 0.14 | NO_RELEVANT_EVIDENCE |
| 「‘QA 전선몰딩’에 대해 판매자가 작성한 상품 설명/FAQ/안내문에 반품 조건(가능/불가 기준, 기간, 상태 요건, 비용 부담 등)이 명시돼 있는가? …」 | planner (run I-before, live this package) | (8-word cap reached before 조건) | 0.26 (FULL) | NO_RELEVANT_EVIDENCE |

`KnowledgeTopic` classified every input as `EXCHANGE_RETURN` and the document too — the topic gate was never the
divergence. `FULL` fails the absence gate for every phrasing including the seller's (0.33). **The first divergence is
the SUBJECT candidate**: the planner's artefact nouns (설명·FAQ·문서·문장·안내문·작성·상품의·판매자) were scored as
topic words the corpus has no words for, and `SUBJECT_WORDS = 8` taken from the front then dropped 조건 to keep them.
Live Agent turn I-before: plan 11.4 s · `search_product_knowledge` → `PRODUCT_KNOWLEDGE_GAP` · 「…근거를 찾지 못했습니다」.

## 2. The rule — two closed token classes, not one more stop word per sentence

`backend/…/knowledge/QueryTokens.java` (replaces `RetrievalQuery.SUBJECT_STOP`, an exact-match list that needed an
entry per inflection):

- **INSTRUCTION** — a closed set of *stems* (확인·찾아·알려·명시·적혀·나와·기재·있·없·가능·여부·필요·답했·보낸…) matched as
  stem + *closed grammar*: a particle tail or a chain of the closed ending pieces (돼·되어·된·있는지·해줘·주세요·한다·했·음…),
  segmented by a tiny DP. 명시돼 · 명시된 · 명시되어 · 명시돼있는지 · 확인해주세요 · 찾아봐줘 · 답했는지 are one stem each; 확인서 and
  설명서 are not stem + grammar and stay nouns. Lone noun-forming syllables (서·문·증) are deliberately not pieces.
- **META** — a closed set of *nouns* for the artefact, the party, the relation and the record (문서·문장·문구·설명·안내문·
  FAQ·정책·규정·기준·내용·정보·근거·판매자·회사·상품·작성·등록·관련·대해·예전·과거·뭐라고·문의·리뷰·사례·참고…), matched exact or with the
  same grammar (상품의·판매자가·작성한·등록된·답변했는지).
- Everything else is **TOPIC-bearing**, and only those words form the SUBJECT candidate (cap unchanged) and the
  memory lane's `residualTopicWords`.

`TOPIC / TITLE / SUBJECT / FULL` are unchanged; **a structured topic is tried first** when the caller holds one:
`GET …/knowledge/search?topic=` (optional) → `RetrievalQuery.of(topic, null, query)`, and `text()` — what the topic gate
classifies — now includes it. The runtime's product lane passes the plan's closed `filters.topic` as the seller's word
(`SHIPPING` → 「배송」, `EXCHANGE_RETURN` → 「교환 반품 환불」, the same two words the POLICY lane already searches with);
`PRODUCT_SPEC`/`USAGE`/`OTHER`/null send nothing — **a question with no topic is not forced into one**, and the
question's own `KnowledgeTopic` is *not* turned into a bare topic candidate (a one-word query is a threshold lowering
in disguise: it would make 「반품 포장재 재사용 가능한가요」 FOUND against a return policy that never mentions packaging).

## 3. Candidate agreement (pinned)

| Input | SUBJECT after | outcome | first passage |
|---|---|---|---|
| A 「반품 조건」 | `반품 조건` | FOUND | 교환 및 반품 안내 |
| B 「이 상품의 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘」 | `교환이나 반품이 조건이` | FOUND | 교환 및 반품 안내 |
| C planner I / I2 / I-before (three sentences, `PlannerSentences`) | `qa 전선몰딩 반품 교환 환불 조건이` / `qa 전선몰딩 반품 조건이` / `qa 전선몰딩 반품 조건 불가 기간 상태 요건` | FOUND · FOUND · FOUND | 교환 및 반품 안내 (also with a second document 「설치 방법」 present) |
| D 「배송 기간」 | `배송 기간` (unchanged) | NOT_APPLICABLE | — |
| D′ planner phrasing of D | `qa 전선몰딩 배송 기간이` | NOT_APPLICABLE | — |
| 「확인서 발급 가능한가요」 · 「설명서 동봉되나요」 | `확인서 발급` · `설명서 동봉되나요` | miss (correct) | — |

Tests: `QueryTokensTest` (inflections · meta with particles · nouns not eaten by prefix · grammar closed),
`RetrievalQueryTest` (candidate agreement over A/B/C₁₋₃ + the memory-lane sentence, D untouched, topic-first),
`ProductKnowledgeRetrievalOutcomeTest` (C₁₋₃ find the same document · **capture-safety invariant**: a source the
seller's sentence finds is found by every planner phrasing with the same first passage · topic-first reported as the
matching form · D′), `SellerOperationsKnowledgeServiceTest` and `AnswerMemoryServiceTest` (noun and instruction
sentence find the same rule / the same remembered answer), runtime `retrievalQuerySelection.test.ts` (topic argument
only for operating topics; 「최근 문의 3개」 → knowledge 0 · policy 0 · memory 0).

## 4. Live after the fix (same org, same data; planner calls per turn unchanged = 1)

| Turn | Planner need (4th–6th phrasings, all new) | Result |
|---|---|---|
| I 「QA 전선몰딩 반품 조건이 명시돼 있는지 확인해줘」 | 「…상품 설명/FAQ/상품별 정책 문서에 반품(교환·환불 포함) 조건이 명시돼 있는지, 있다면 어떤 문구로 어디에 적혀 있는지」 | `SATISFIED`, `PRODUCT_KNOWLEDGE_DOC` 「교환 및 반품 안내」, excerpt quoted; plan 11.0 s (before 11.4 s), tools 28 ms |
| D 「QA 전선몰딩 배송 기간이 명시돼 있는지 확인해줘」 | 「…배송 기간(출고/배송 소요일 등)이 명시돼 있는지 확인」 | not adopted (`NO_RELEVANT_EVIDENCE`, 「찾지 못했습니다」) — never FOUND |
| ORG 「우리 반품 기준 뭐였지」 | POLICY need | `ORG_POLICY` 「교환·반품 처리 기준」 quoted (lane unchanged) |
| ROWS 「최근 문의 3개 보여줘」 | INQUIRY rows | tools: `list_inquiry_rows` only — retrieval 0 |
| MEM 「이 상품 문의에 반품 조건 예전에 뭐라고 답했어?」 (product anchored) | PAST_ANSWER need | `PAST_ANSWER` 「예전에 보낸 답변(전송이 확인된 답변)…」 |

Direct endpoints after: product lane — all five 반품 phrasings FOUND (`candidatesTried = 1`, matched by SUBJECT), 「배송
기간」 and its planner phrasing NOT_APPLICABLE, `topic=교환 반품 환불` FOUND at candidate 1 with `query = 교환 반품 환불`;
org lane — 「우리 반품 기준 뭐였지」 and 「우리 회사 규정에 교환이나 반품이 가능한 조건이 명시돼 있는지 확인해줘」 FOUND, same
rule; memory lane — 「반품 조건」 · 「QA 전선몰딩 문의에 반품 조건 예전에 뭐라고 답했어?」 · 「예전에 반품 조건에 대해 고객에게
어떻게 답변했는지 확인해줘」 FOUND, same answer. **The memory lane was a second instance of the defect found live here**:
the seller's own sentence missed on 문의에·뭐라고·답했어 (the lane listed exactly those words in `PAST_ANSWER_PHRASING`, but
only for its browse decision, not for the SUBJECT candidate) — closed by the shared classifier, so all three lanes
normalize the same way.

**Latency.** `RetrievalQuery.ofText` 9.5 µs/call (100k planner sentences, JIT-warm); search endpoint p50 3–4 ms /
p90 5–6 ms for both the noun and the longest planner sentence; turn time is the planner (11 s) either way — no
regression. Model calls in QA: 1 planner per turn as in production; 7 QA turns in total (one of them an accidental
duplicate of turn I launched in the background — its planner wrote a 5th phrasing, also `SATISFIED`).

## 5. Not fixed, reported
- The org lane does not discount the org's own name (the product lane discounts the product's), so a planner sentence
  that quotes 「‘QA 질의선택’의 …」 carries 6 noise characters; the Agent's POLICY lane never sends the sentence (it
  searches the topic word), so this is unreachable in the product today.
- 「운영」 and 「고지」 as artefact qualifiers (운영 정책, 고지 문서) are not META — 운영 시간 and 고지 are real topics; they
  cost 2 characters of noise each when a planner writes them.
- Planner variance in *anchoring* is unchanged: one PAST_ANSWER run did not resolve the product and searched unbound
  memories (`ABSENT` for that scope, said as such); anchored by `productId` it is FOUND.
- `SUBJECT_WORDS = 8` still counts the product's name words (discounted by the scorer but occupying two slots).

## 6. Side effects and residue
Disposable org 「QA 질의선택」 (`26f8b51d…`): signup, 4 inquiries via `/api/uploads`, 1 product document, 1 org rule,
1 profile via their endpoints, 1 SQL `answer_memory` row (product-bound). **All removed** (SQL, FK order: 35 rows across
13 tables + the org; residue 0, orphans 0, orgs 38 → 37, runtime store scope removed). Demo Org: 0 writes
(`answer_memory` 22 → 22, `ae51c7f8` ANSWERED). Marketplace calls 0 · WRITE 0 · migrations 0 (Flyway 88). Backend booted
with the QA org appended to the plan/draft/judge allow-lists through a wrapper (no env file edited) and restored to the
original env afterwards.
