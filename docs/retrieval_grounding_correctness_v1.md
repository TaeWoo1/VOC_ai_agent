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
