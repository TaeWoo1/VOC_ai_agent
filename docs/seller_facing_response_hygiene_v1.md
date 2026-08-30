# Seller-facing Response Hygiene v1 (2026-08-30)

**Scope.** What the seller reads in the Agent conversation and its artifacts — not what the runtime
knows. The Agent's internal structure (needs, evidence refs, provenance stamps, judge digests, the
trace) is untouched; retrieval and grounding semantics stay as Retrieval & Grounding Correctness v1
closed them. Knowledge Capture, planner latency and any UI redesign are out of scope.

The rule that organises the package: **every seller-facing sentence is chosen from a closed
vocabulary this repository wrote, in one place** — `agent-runtime/src/operator/wording/sellerWording.ts`
— and nothing a model wrote (a planner rationale, a clarification reason) or a system stamped
(`CAFE24:PRODUCT_API:v2`, an evidence kind, a need question) reaches the seller as text.

| # | Requirement | What changed |
|---|---|---|
| 1 | No internal terminology | `SOURCE_LABEL` (evidence kind → 상품 정보 · 운영 정책 · 과거 승인 답변 · 주문 정보 · 회사 정보 · 과거 사례 …) is the label of every 「확인한 자료」 row; a locator label is appended only for kinds whose label is a seller-authored title (a rule, a document, a remembered answer, an issue) and only when it reads as Korean words (`isSellerSafeLabel`). Product facts say 「(채널 상품 정보)」 instead of the source stamp (`factSourceLabel`). 「SellerOps가 갖고 있지 않습니다」 → 「아직 저장돼 있지 않습니다」. 「확인하지 못한 항목」 names the need's kind, never its question. `INTERNAL_TOKEN` is the regression guard (message, artifact display fields, evidence labels, chips). |
| 2 | Direct answer first | Findings are ordered answer-before-limits (`claimsCoverageLimit` last). A NO_ANSWER_BASIS turn is **what is missing + the one next step** — the backend's specific note (when it is not the generic 「답변 기준이 필요합니다」) and its `answerBasisAction`, then the `KNOWLEDGE_ENTRY` step titled **「답변 기준 추가」**. A draft that asks the customer back is announced as 「고객에게 되묻는 답변 초안을 준비했습니다.」. A PREPARE with nothing to point at answers with the question alone. |
| 3 | No recitation | The registered 회사 정보 is **referred to** (「등록된 회사 정보를 참고했습니다.」) unless the seller asked for the introduction itself (`COMPANY_INTRO_ASK`, a closed cue). Rules, product documents and remembered answers are quoted as a **bounded excerpt** (`excerpt`, 160 chars, cut at a sentence end) under the seller's own title — 「등록된 배송 기준 「배송 안내」: …」 — never the whole text, never the provenance. |
| 4 | Retrieval wording | One table, `retrievalSentence(lane, outcome)`, shared by the graph nodes and (by wording) the backend's `AnswerBasisState.actionKo`: **ABSENT** 「등록된 배송 기준이 아직 없습니다.」 · **NO_RELEVANT_EVIDENCE** 「등록된 운영 정책/상품 정보에서 이 질문에 맞는 근거를 찾지 못했습니다.」 · **NOT_APPLICABLE** 「배송 기준은 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.」 · FOUND has no sentence. 없다·찾지 못했다·바로 적용하기 어렵다 never mix (unit-pinned). A PAST_ANSWER search with no product anchor says the scope it searched (「상품과 연결되지 않은 과거 답변은 아직 없습니다. 상품 이름을 말씀해 주시면…」) — found live, where a product-bound VERIFIED answer read as 「과거 답변이 아직 없습니다」. |
| 5 | Draft artifact | `DraftArtifact` is body-first: the draft text, one compact grounding line (state chip · 근거 · 상품 정보 1 · 운영 정책 1 · 회사 정보 참고), then **「말투 다듬기」 / 「보내기 준비」** as conversation sentences (the latter leads only to the Approval artifact, which owns the irreversible control — no write here), then 「문의 화면에서 직접 고치기」 as a secondary link. On a reloaded thread the same saved version is **re-read** from the inquiry (`GET /api/inquiries/{workItemId}`, READ); an older card says it was superseded rather than loading forever. `answerBasisAction` now travels on the artifact. |
| 6 | Contradictions / duplicates | 「AI 초안이 준비돼 있습니다」 is dropped beside a knowledge gap; a selected inquiry is described by its card, not again by prose; the resolver's and the scope gate's 「…상품을 찾지 못했습니다」 collapse to one (`dedupeNear`); a clarification 「어떤 문의?」 while an inquiry is selected is **not asked** — the anchor is shown with its next moves. |
| 7 | Wrong headline | 「방금 본 리뷰를 상품 N개로 묶었습니다」 only when a REVIEWS set was actually grouped (`scope=WORKING_SET` over REVIEWS); any other product answer leads with its first finding. |
| 8 | Planner raw wording | `unsupportedSentence(rationale)` and `clarificationKindOf(reason)` → `clarificationSentence(kind)`: the model's text is read only to pick one of a few closed, 존댓말 sentences (「대상 텍스트나 객체가 지정되지 않아…」 → 「어떤 문의를 확인할지 먼저 선택해 주세요.」). The frontend no longer prints a 「이 요청은 계획을 세우지 못했습니다」 mechanism headline over the sentence. |

Also: the backend `RetrievalQuery.SUBJECT_STOP` gained the inflections the planner actually writes
(명시되어·명시되·적혀있는지·나와있는지) — a completion of the existing closed list, not a threshold change.

## Verification

Unit/integration: runtime `test/conversation/responseHygiene.test.ts` (wording table · excerpt/label/stamp
helpers · planner-text renderer · no-anchor vs anchored clarification · NO_ANSWER_BASIS composition ·
company profile referred/quoted · product headline · near-duplicate collapse · a token sweep over eight
turns' messages, artifact display fields, evidence labels and chips); re-contracted strings in
`retrievalGrounding`, `knowledgeContext`, `conversationService`, `operatorInvestigation.e2e`;
backend `AnswerBasisStateTest`, `RetrievalQueryTest`; frontend `DraftArtifact.test.tsx` (body-first order,
prompts, reload re-read, superseded state, NO_ANSWER_BASIS card, failed-turn header) and one
re-contracted `AgentPanel` assertion. Runtime 682 passed · frontend full green · backend full green.

Live (disposable org 「QA 응답위생」, real planner and draft model; marketplace 0 · WRITE 0):

| Case | Result |
|---|---|
| A 「우리 배송 정책 뭐였지?」 | 「등록된 배송 기준 「배송 안내」: 주문 다음 영업일에 출고하며…」 — excerpt, evidence label 「운영 정책 · 배송 안내」, provenance 0 |
| B policy exists, not applicable | 「배송 기준은 등록되어 있지만 이 문의에 바로 적용하기 어렵습니다.」 + 「답변 기준 추가」 (generic 「답변 기준이 필요합니다」 not repeated in prose) |
| C product knowledge miss | 「QA 전선몰딩의 등록된 상품 정보(1건)에서 이 질문에 맞는 근거를 찾지 못했습니다.」 — never 「없다」 |
| D past approved answer | 「예전에 보낸 답변(전송이 확인된 답변, 2026-08-27): …」 via `search_answer_memory`; tokens 0 |
| E grounded draft (NEEDS_CLARIFICATION in this org) | body read in the chat card; 「근거 · 상품 정보 1 · 운영 정책 1 · 과거 답변 1 · 회사 정보 참고」; 「말투 다듬기」 from the card produced v5; approval control absent |
| F NO_ANSWER_BASIS | 「등록된 세금계산서 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.」 + 「답변 기준 추가」; model 0 |
| G company context | the summary was read (planner `get_seller_profile`) and never recited; grounding unchanged (NO_ANSWER_BASIS stayed) |
| H 「그 객체 삭제해줘」 | FAILED with 「어떤 문의를 확인할지 먼저 선택해 주세요.」 — planner's 반말 rationale not shown |
| I review-less product answer | headline is the finding; 「방금 본 리뷰…」 0 |
| J 7-turn browser conversation (1440×900) | internal tokens 0 on every turn · console errors 0 · off-host requests 0 · horizontal scroll 0 · duplicate agent sentences 0 (apart from the same headline on two separate draft turns) · reload re-read the head draft body |

## Not fixed, reported
- Case I: the planner's *need question* for a product document (「‘QA 전선몰딩’ 상품의 판매자 작성 문서(상품 설명·FAQ·정책) 중 반품 조건이 명시돼 있는지 확인」) fails the retriever's absence gate while the seller's own sentence finds the document. The runtime searches with the need question; choosing the seller's sentence instead is a retrieval-query decision outside this package's scope.
- The planner is non-deterministic about attaching a POLICY/PAST_ANSWER need to a draft request; the prose is now stable across those shapes (a draft turn recites nothing), but the evidence disclosure count varies.
- The draft card's state chip (「고객에게 되묻는 답변」) and the turn's headline say the same thing in two forms; kept, because the card must stand alone in the panel.

## Side effects and residue
- Disposable org 「QA 응답위생」: signup; 4 inquiries via `/api/uploads`; 1 product document, 2 org rules and 1 profile via their endpoints (the shipping rule later deleted via API for case B); SQL fixture: 1 `seller_accounts`, 4 `inquiry_work_item` OPEN, 1 `answer_memory` (EXECUTOR_SENT_VERIFIED, product-bound). Draft runs then wrote proposals and MODEL draft versions. **All removed after the run** (see the commit's report for the FK-ordered counts).
- Demo Org: 0 writes (its `answer_memory` 22 → 22; `ae51c7f8…` still ANSWERED). Marketplace calls 0 · WRITE 0. Backend booted with the QA org appended to the plan/draft/judge allow-lists through a wrapper (no env file edited) and restored to the original env afterwards.
