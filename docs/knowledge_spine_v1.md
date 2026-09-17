# Knowledge Spine v1 — Customer Operations Manager Demo v1 · Q1

> 작성 2026-09-18. 제품 목표: **Customer Operations Manager Demo v1**(product-owner decision, canonical).
> 판매자가 고객 운영을 맡기면 Reviewnary가 Observe → Understand → Knowledge → Decide → Prepare →
> Ask/Execute → Learn을 수행하고, 책임질 수 없는 예외만 판매자에게 가져온다. vertical은
> `CUSTOMER_OPERATIONS_V1` 하나이고, Runtime 확장보다 **Knowledge · Judgment · UX 품질**이 우선이다
> (`docs/responsibility_runtime_v1.md` §26).
>
> Q1의 질문은 하나다. **판매자가 이미 남긴 운영 흔적을, Agent가 믿고 쓸 수 있는 회사 지식으로 읽을 수
> 있는가.** 마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 마이그레이션 0.

## 1. 감사 결과 — 원천은 이미 다 있었고, 한 번에 읽는 길이 없었다

| P0 원천 | 이미 있던 저장소 (owner) | Q1 이전 상태 |
|---|---|---|
| 판매자 직접 입력 지식 | `org_knowledge_sources`/`_chunks`, `product_knowledge_sources`/`_chunks` (`SELLER_ENTERED_KNOWLEDGE`) | 문의·리뷰 초안 lane이 각자 검색 |
| 상품 상세 · 상품 사실 | `product_knowledge_sources`(`SELLER_AUTHORED_CHANNEL_CONTENT`·`AI_EXTRACTED_FROM_SELLER_IMAGE`), `product_facts` | facts는 어떤 knowledge 검색에도 들어가지 않음 |
| 과거 문의 + 실제 판매자 답변 | `answer_memory` (채널 수집 답변 · 승인 · 검증 전송; AI 초안 0) | 문의 초안 lane만 읽음 |
| 과거 리뷰 + 판매자 답글 | `review_reply_approval` + append-only `review_reply_draft` (+ `review_reply_outcome`) | 지식으로 읽는 곳 **0** |
| 판매자 결정 이력 | `review_triage`(actor `SELLER:`), `review_triage_corrections`(STANDING) | 조사자 payload에 토큰·날짜로만 |
| 업로드 자료 | 두 knowledge 테이블의 `SELLER_UPLOADED_DOCUMENT` | 초안 lane이 각자 검색 |

그래서 새 generic knowledge platform도, 새 테이블도 만들지 않았다. **Raw source는 그 테이블들이고,
Spine은 그 위의 읽기 전용 view다.**

## 2. 모양

- `knowledge/spine/adapter/*` — 원천마다 adapter 하나(`SellerKnowledgeAdapter` · `ProductFactAdapter` ·
  `InquiryAnswerAdapter` · `ReviewReplyAdapter` · `SellerDecisionAdapter`). 각 adapter는 행을
  `KnowledgeEntry`로 읽는다: `entryId` · `sourceType` · `scope`(ORG/PRODUCT) · `productId` · `channelCode` ·
  `authority` · `title` · `text` · `capturedAt`(freshness) · `provenance`(판매자가 읽는 한 문장) ·
  `sourceRefs`(원천 행으로 가는 포인터들).
- **저장하지 않는다.** entry는 읽을 때마다 원천 행에서 조립되므로 원천과 어긋날 수 없다 — 정책을 고치면
  entry가 바뀌고, 은퇴시키면 사라지며, 두 번째 사본이 없다.
- `KnowledgeSpineService` — `entries` · `search` · `compiled` · `trace`.
- `GET /api/knowledge/spine/search?q=&productId=&limit=` · `GET /api/knowledge/spine/compiled?productId=` ·
  `GET /api/knowledge/spine/trace?entryId=&productId=` — org는 JWT에서만, 남의 org 상품은 404, 쓰기 0.

### 2-1. Authority (product-owner 순서 그대로, `KnowledgeAuthority.rank()`)

| rank | authority | Q1 생산자 |
|---|---|---|
| 1 | `SELLER_POLICY` | org 운영 기준(입력·업로드 모두) |
| 2 | `SELLER_CONFIRMED_PRODUCT_KNOWLEDGE` | 판매자가 **직접 입력**한 상품 지식 |
| 3 | `RECENT_SELLER_DECISION` | 판매자 리뷰 처리 판단 · STANDING 판단 정정 |
| 4 | `PRODUCT_DETAIL` | 상세페이지 글 · 이미지 판독 · **업로드한 상품 자료(설명서)** · 채널 상품 사실 |
| 5 | `PAST_SELLER_ANSWER` | Answer Memory(강도 무관) · 승인된 리뷰 답글 |
| 6 | `COMPILED_KNOWLEDGE` | compiled view **전체**의 authority — 개별 claim은 원천 authority를 유지 |
| 7 | `EXTERNAL_REFERENCE` | 생산자 0 (테스트가 고정) |

**Authority는 relevance가 아니다.** 검색은 질문을 덮는 정도(coverage)로 먼저 줄 세우고, authority는
같은 coverage 안의 tie-break다. 배송 정책이 두께 질문에 답하지 않는다.

구현 판단 하나를 적어 둔다: 업로드한 **상품** 자료는 PO 순서의 「현재 product detail/manual」이라 rank 4,
업로드한 **org** 자료는 회사가 써서 올린 운영 기준이라 rank 1. 기존 `KnowledgeAuthorship.tieBreakRank`
(입력 > 업로드 > 상세페이지 > 이미지)와 방향이 같다.

### 2-2. Scope fence

- `productId` 없음 → ORG entry만. 있음 → ORG + 그 상품의 PRODUCT entry. **다른 상품에 묶인 행은 0.**
- 상품이 없던 과거 답변(`answer_memory.product_id is null`)은 ORG — 상품을 말한 적이 없어 틀린 상품일 수
  없다(`AnswerMemoryService`와 같은 규칙).
- 펜스는 두 번 선다: 모든 adapter가 org·product를 자기 predicate에 넣고, 서비스가 adapter 출력이 만나는
  지점에서 한 번 더 거른다. 남의 org 상품 id는 adapter 호출 전에 404.
- `CHANNEL` scope는 선언하지 않았다 — 오늘 어떤 원천도 「한 채널에만 참인 사실」을 말하지 않는다.
  entry는 출처 채널을 `channelCode`로만 든다.

### 2-3. 무엇이 지식이 **아닌가**

- **고객 문장.** 리뷰·문의 본문은 매칭에만 쓰이고(`searchable`) entry text로 나가지 않는다. 리뷰·문의는
  `sourceRefs`로만 닿는다.
- `RULE` 리뷰 답글 — org 템플릿을 그 리뷰에 쓴 것은 그 리뷰에 대한 결정이지 주제에 대한 답이 아니다
  (`InquiryAnswerMemoryHook`과 같은 판단). 승인 fingerprint와 다른 버전, WITHDRAWN 승인도 제외.
- actor가 `SELLER:`가 아닌 triage, WITHDRAWN 정정, 은퇴한 자료, 문단이 없는 자료.

### 2-4. Compiled read model

`compiled(org, product)`는 저장되지 않는 결정론 view다. entry를 **하나의 `KnowledgeTopic`**을 이름 짓는
경우 그 topic으로, 아니면 원천 가족(운영 기준 · 상품 정보 · 과거 답변 · 판매자 판단)으로 묶고, 각 section은
authority → 최신 → id 순으로 claim 3개와 `onRecord` 총수를 보인다. claim은 원천 entry의 발췌(200자)이고
원천 authority와 `sourceRefs`를 그대로 든다 — **compiling은 과거 답변을 정책의 무게로 올리지 않는다.**
view 전체의 `newestSourceAt`이 그 view의 freshness다.

### 2-5. 추적

`SourceRefResolver`가 ref를 닫힌 `SourceRef.Kind → 엔티티` 표로 원천 행에 다시 읽는다(org가 predicate에
있으므로 남의 org 행은 해석되지 않는다). `trace`는 entry를 원천에서 새로 읽고 ref마다 `resolved`를 붙인다.

## 3. 기존 경로에 대한 영향

**0.** 문의 초안(`InquiryEvidenceRetriever`)·리뷰 초안(`ReviewDraftComposer`)·Answer Memory·조사자
(`CaseInvestigationTools`)는 한 줄도 바뀌지 않았다. Spine은 기존 스코어러(`KnowledgeRetriever` lexical ·
`RetrievalQuery` ladder · `KnowledgeTopic.applicable` 거절)를 **호출할 뿐** 조정하지 않는다. semantic lane
(임베딩·재진술·적합성)은 쓰지 않는다 — 고객 질문을 벤더로 보내는 것은 org별 배포 결정이고, 새 읽기 경로가
그것을 넓히는 자리가 아니다.

## 4. 증명

`KnowledgeSpineTest` 9개(H2 test DB, 실제 repository, 네트워크·모델 0):

1. 한 상품에 대한 **한 번의 검색**이 운영 기준 · 상품 지식 · 상품 사실 · 과거 문의 답변 · 리뷰 답글 ·
   판매자 판단을 모두 돌려주고, 각각 scope · authority · capturedAt · provenance · sourceRefs를 갖는다.
2. 다른 상품(같은 org)의 지식은 검색 · corpus · compiled 어디에도 없고, **adapter 각각**도 계약을 지킨다.
3. 다른 org의 지식은 없고, 남의 org 상품 id는 404다(adapter에 직접 남의 상품 id를 줘도 남의 행 0).
4. compiled claim의 모든 ref가 이 org에서 해석되고 **다른 org에서는 해석되지 않는다**; trace가 리뷰 답글을
   리뷰 행까지 따라간다; 모든 `SourceRef.Kind`에 표가 있다.
5. section은 authority 순이고 교환 section은 운영 기준이 과거 답변보다 앞선다.
6. 고객 문장은 어떤 entry에도 없다.
7. RULE 답글 · SYSTEM triage는 지식이 아니고, 승인 철회 · 자료 은퇴 뒤에는 사라진다.
8. `COMPILED_KNOWLEDGE`·`EXTERNAL_REFERENCE`를 내는 adapter 0; 아무것도 없는 org는 `ABSENT`.
9. spine 패키지 소스에 save/delete/persist/merge/모델/HTTP 호출 0.

**mutation 확인**: `InquiryAnswerAdapter`의 상품 필터를 풀면 (2)가, `SourceRefResolver`의 org predicate를
빼면 (4)가 실패하는 것을 확인한 뒤 되돌렸다.

**기존 fence가 잡은 것 하나**: 처음 버전의 `SellerKnowledgeAdapter`가 switch에서 이미지 판독 authorship 상수를
**이름으로** 읽었고, `DetailImageFetchBoundaryTest`·`DetailContentShapeTest`(그 authorship의 생산자는 정확히 하나)가
두 번째 생산자로 세어 실패했다. 테스트는 그대로 두고 adapter가 이름 대신 `default` 분기와
`carriesExactFiguresUnaided()`로 묻게 고쳤다 — 읽는 쪽이 그 이름을 쓰면 「생산자 수」라는 스위치가 무의미해진다.

backend 전체 **4,316 통과 · 실패 0 · 건너뜀 39**(직전 4,307 + 9). collector·frontend는 변경 0이라 재실행하지 않았다.

## 5. 남은 것 (구현하지 않음)

- **Agent 연결.** REST 읽기 경로는 agent-runtime이 판매자 bearer로 부르는 seam이지만, runtime tool 추가와
  조사자(`CaseInvestigationTools`) 연결은 하지 않았다. 둘 다 과거 답변·리뷰 답글 **텍스트를 모델 payload에
  싣는** 변경이라 payload floor 결정이 먼저다 → PRODUCT_DECISION_NEEDED (Q2 착수 전).
  `INVESTIGATOR_RETRIEVAL_GAP`(§25-6)은 그대로다.
- **채널에서 수집된 리뷰 답글**은 저장되지 않는다(`reviews`에 답글 본문 칸 없음) → 리뷰+답글 지식은
  reviewnary에서 승인된 답글뿐이다. 수집을 넓히는 것은 새 acquisition이라 Q1 밖.
- 충돌은 authority 순서로만 정리한다. 두 원천이 **서로 다른 말**을 하는지 판정하지 않는다.
- Demo Org 라이브 읽기는 하지 않았다 — 워크트리 백엔드를 dev DB에 띄우면 Flyway가 V106–V110을 적용한다.
