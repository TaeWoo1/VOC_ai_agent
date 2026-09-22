# Demo Core Experience v1 — SellerOps 데모 제품 정의

Status: **CANONICAL (제품 정의)** · 2026-08-24 · 소유: 이 문서
Scope lock 위치: `docs/product-scope-v1.md` v1.14 항목 · IA: `docs/product_assembly_ia_v1.md`

이 문서는 **데모로 보여줄 SellerOps가 무엇인가**를 고정한다. 기존 canonical technical
문서(`docs/sellerops_canonical_reference.md`, `docs/architecture.md`,
`docs/multi-channel-connector-roadmap.md` §4.1, `docs/sellerops_operator_graph_v2.md`)를
**덮어쓰지 않는다.** 저 문서들이 계속 각자의 진실을 소유하고, 이 문서는 그 위에서 **화면과
경험의 순서**만 정한다. 충돌하면 `CLAUDE.md`의 conflict priority가 이긴다.

---

## 1. 북극성

```
운영 Dashboard → Agent 분석 → Product Knowledge / RAG → 추천·초안
    → 사용자 승인 → (다음 package) Action Executor → marketplace
```

이 package(v1)는 **「사용자 승인」 직전까지**를 만든다. marketplace WRITE는 만들지 않는다.
Agent reasoning graph의 WRITE 0은 계약으로 유지된다
(`OperatorToolRegistry` · `operatorToolRegistry.test.ts` · `privilegedPlaneFence`).

## 2. 제품 정의 (11 조항)

| # | 조항 | 이 저장소에서의 의미 |
|---|---|---|
| D1 | 첫 화면은 **운영 Dashboard** | `/` = Overview. Today Inbox는 Dashboard 안의 한 구역으로 내려간다 |
| D2 | 매출 / 주문 / 문의 / 리뷰 중심 | KPI 6종 (§4) |
| D3 | 숫자가 아니라 **trend + channel breakdown** | 기간 시계열 + 채널 분해를 항상 같이 준다 |
| D4 | AI Insights는 Dashboard를 **보조** | 주인공이 아니다. 3~5개, 짧게, 클릭하면 그 화면으로 |
| D5 | Agent는 **어디서든** 접근 가능 | 전역 진입점 + 현재 화면의 structured context |
| D6 | 단순 조회는 **빠른 deterministic path** | 버튼/닫힌 `intent` lane은 그대로 (v2 §two lanes) |
| D7 | 복합 분석은 **LLM Planner → Specialist → Tool → Evidence** | 타이핑된 문장은 계획 없으면 run 실패 — 변경 없음 |
| D8 | **Product Knowledge + RAG는 데모 필수** | 판매자가 직접 넣은 지식을 Agent가 읽고 근거로 쓴다 (§6) |
| D9 | Agent reasoning graph **WRITE 0** | READ-only tool catalogue, 구조 테스트가 WRITE를 거부 |
| D10 | 승인 후 **별도 Action Executor**가 marketplace WRITE | v1 범위 밖. 자리만 비워 둔다 |
| D11 | 문의/리뷰 답변은 **초안 → 승인 → 발송** UX | v1은 초안 자리까지 |

## 3. 화면 책임 (IA delta)

`docs/product_assembly_ia_v1.md`의 워크플로 IA(홈/리뷰/문의/주문/채널 연결)를 유지하되,
**홈의 정의가 바뀐다.**

| 경로 | v1 이전 | Demo Core Experience v1 |
|---|---|---|
| `/` | Today Inbox (텍스트 목록) | **Overview Dashboard** — KPI · trend · channel breakdown · AI Insights · 오늘 할 일 |
| `/products` | **없었다** | 상품 목록 (신설) |
| `/products/:id` | **없었다** | Product Intelligence (신설) — 정보/리스팅/신호/이슈/지식/Agent |
| `/inquiries` | 큐 | 큐 + 초안 자리 + 진단 텍스트 제거 |
| `/reviews` | 계정별 기록 | trend · 부정 리뷰 · 반복 이슈 · 필터 |
| `/agent` | 메뉴 목적지 | 전역 진입점의 착지점. 컨텍스트를 들고 들어온다 |

## 4. Dashboard KPI — 6종과 그 출처

| KPI | 출처 테이블 | 비교 |
|---|---|---|
| 매출 | `order_daily_summaries.sales_amount` | 최근 7일 vs 이전 7일 |
| 주문 | `order_daily_summaries.order_count` | 〃 |
| 문의 | `inquiries` (received_at) | 〃 |
| 미답변 문의 | `inquiries` ACTIVE 술어 | **현재 상태** — 비교 없음 |
| 리뷰 | `reviews` (received_at) | 최근 7일 vs 이전 7일 |
| 부정 리뷰 | `reviews.is_negative` | 〃 |

### 4.1 매출 semantics — 채널마다 같은 단어, 다른 수량

**세 채널의 「매출」은 같은 정의가 아니다.** 이것은 감사 결과이며 추측이 아니다.

| 채널 | 금액 근거 | 세는 단위 | 날짜 근거 | 취소/반품 차감 |
|---|---|---|---|---|
| NAVER | `productOrder.initialPaymentAmount` (할인 후, 주문 시점) | **상품주문** row (PAYED 전이) | `paymentDate` KST | **안 함** (`remainPaymentAmount` 미사용) |
| COUPANG | `orderItem.orderPrice` 합 | **배송건(shipment box)** | `summaryDate` KST | 안 함 |
| CAFE24 | `payment_amount` | **distinct `order_id`** | `order_date` KST | 안 함 |

따라서:

- **채널별 매출/주문은 그 채널의 정의로 정확하다.** 채널별 표시가 1차 시민이다.
- **채널 합계는 근사다.** 합계에는 정의를 붙인다: *"결제 시점 기준 결제금액 합계 (취소·반품 차감 전)"*.
- **주문 「건수」의 단위가 채널마다 다르다** (상품주문 / 배송건 / 주문). 합계 건수는
  같은 문장 안에서 단위를 밝히지 않으면 쓰지 않는다.
- 이 정의를 바꾸려면 connector를 바꿔야 하고, 그것은 이 package의 범위가 아니다.

### 4.2 Coverage는 차트보다 위다

Cross-Channel Operational Reasoning v1의 `ChannelDataState`가 Dashboard에서도 규칙이다.

- **`BLOCKED` / `NOT_CONNECTED` 채널은 차트의 0이 아니다.** 계열에서 빠지고, 그 사실이 적힌다.
- **`OBSERVED_FRESHNESS_UNPROVEN`은 최신이라고 말하지 않는다.**
- **`ZERO`만이 "0건"이다.**
- 합계는 **어떤 채널이 합계에 없는지** 함께 말한다.

## 5. AI Insights

Dashboard 보조 구역. **3~5개**, 각 한 줄, 클릭하면 해당 화면/Agent 컨텍스트로 이동.
후보: 미답변 문의 backlog · 부정 리뷰가 몰린 상품 · 반복 리뷰 이슈 · 채널 편중 ·
데이터 신선도 문제. 긴 설명 금지. **없는 데이터로 인사이트를 만들지 않는다** —
근거가 없으면 그 카드는 나오지 않는다.

## 6. Product Knowledge + RAG v1

기존 `ProductFact`(채널이 말한 사실)와 **다른 축**을 하나 더 놓는다:
**판매자가 직접 쓴 지식** (`product_knowledge_sources`).

- source type: `DESCRIPTION` · `FAQ` · `USAGE` · `POLICY` · `LINK`
- 보존: `productId` · type · title · **provenance** · created/updated · author
- 검색: Postgres 전문검색(`simple` config) + trigram — **새 vector store를 도입하지 않는다**
- 성공 기준은 "vector store가 생겼다"가 아니라
  **REAL 상품에 넣은 지식을 Agent가 실제로 읽고 evidence로 인용한다**이다.

`ProductFact`와 절대 섞지 않는다: 채널이 말한 것과 판매자가 쓴 것은 provenance가 다르고,
Evidence Judge가 그 차이로 문장을 판정한다.

## 7. Agent quota

- **per org / day** run budget (신설, 백엔드)
- **per run** planner/judge/tool budget (기존 `OperatorBudget` 재사용)
- 숫자는 **env/config**로만. source hardcode 금지.
- 초과 시: 사용자에게 보이는 정상 상태, marketplace 영향 0,
  **deterministic dashboard는 계속 동작**, planner correctness를 낮추는 fallback 없음.

## 8. 유지되는 계약

A1/A2 · Temporal Evidence · Operational Defaults · C1/A5/A8/C3/C4 · A9/C5 ·
Grouped Product Answers · Product Review Signals · Cross-Channel Operational Reasoning.

특히: **BLOCKED를 ZERO로 표현 금지** · **stale evidence를 current fact로 표현 금지** ·
**PRODUCT/CHANNEL scope integrity** · **Agent WRITE 0**.

## 9. 범위 밖 (v1)

NAVER credential/IP 원인 추적 · NAVER recurrence 재시도 · 새 connector/channel ·
repeated inquiry product schema · 20 vs 69 product 결정 · marketplace answer WRITE ·
full autonomous agent · weekly report automation.

NAVER routine `BLOCKED_EXTERNAL`은 기록된 상태 그대로 둔다
(`docs/naver_inquiry_api_audit_v1.md` §13–§14).

## 10. 다음 package

**Inquiry Action Flow v1** — 초안 → 사용자 승인 → 실제 channel send.

---

## 11. 구현 결과 (2026-08-24, 라이브)

마켓플레이스 접촉 **0** · **WRITE 0** · §4.1 어떤 칸도 옮기지 않음.
(참고: Cafe24/Coupang의 60분 routine READ는 self-pilot standing grant 하에 **평소대로** 계속 돌아간다 —
이 package가 만든 호출이 아니다. NAVER 세 schedule은 여전히 운영자 disable.)

### 11.1 Dashboard — API와 DB 대조

`GET /api/dashboard/overview?days=7` (2026-08-18 ~ 08-24, 비교 08-11 ~ 08-17):

| KPI | API | DB 직접 조회 | 일치 |
|---|---|---|---|
| 매출 | 1,735,542 | CAFE24 308,082 + COUPANG 1,041,760 + NAVER 385,700 = 1,735,542 | ✅ |
| 주문 | 103 | 7 + 48 + 48 = 103 | ✅ |
| 문의 | 1 | NAVER 1 | ✅ |
| 미답변 문의 | 69 | CAFE24 69 + COUPANG 0 + NAVER 0 | ✅ |
| 리뷰 | 49 | COUPANG 4 + NAVER 45 | ✅ |
| 부정 리뷰 | 0 | 0 | ✅ |
| 이전 기간 매출 / 주문 | 261,030 / 13 | 261,030 / 13 | ✅ |

전부 `data_origin='REAL'` 기준 (DEMO_SEED 주문 25일·리뷰 30건은 제외되어야 하고, 제외됐다).

채널 상태: NAVER 주문·문의 `BLOCKED` · NAVER 리뷰 `FRESHNESS_UNPROVEN` ·
CAFE24 3종 `OBSERVED_FRESH` · COUPANG 3종 `FRESHNESS_UNPROVEN`.
합계에서 빠진 것: **쿠팡 문의**(이 기간에 낸 행 0 + 최신 여부 미확인) — 화면에 이유와 함께 적힌다.

### 11.2 AI Insights (5개, 전부 근거 있는 것만)

미답변 문의 69건(카페24 69) · 선바로 전선몰드 부정 리뷰 3건(2026-03-03~07-23) ·
네이버 연결 끊김 · 반복 리뷰 문제 19건(접착 부족) · 쿠팡이 매출의 60%.

### 11.3 RAG — REAL 상품에 실제로 입력한 지식으로

상품 `8722bf9c…` (「[박스발송] 선바로 일체형 전선몰딩…」)에 **사용법·FAQ·정책 3건**을 화면 API로 입력.

| 질문 | 결과 |
|---|---|
| 사용 방법을 고객에게 어떻게 설명하면 돼? | **USAGE + FAQ 인용**, 둘 다 judge `SUPPORTED`, evidence `PRODUCT_KNOWLEDGE_DOC` ×2, provenance `product-knowledge-library/USAGE:데모 운영자` |
| 반품 배송비 | POLICY 단독 (1.0) |
| 겨울에 접착이 잘 안 됩니다 | FAQ 우선 (0.8) |
| 벽지에 붙일 수 있나요 | FAQ 단독 (1.0) |
| **방수 되나요?** | **「등록된 상품 지식(3건)에는 이 질문에 해당하는 내용이 없습니다. (상품에 그런 내용이 없다는 뜻은 아닙니다.)」** — 지어낸 문장 0 |
| 배터리 충전 시간 / 원산지 | 검색 단계에서 **NO MATCH** |
| 반복 리뷰 문제 + 등록한 사용법 (결합) | listing + knowledge ×2 + issue evidence 한 답에 |

**검색은 vector store 없이** 한 상품 코퍼스 위의 결정론적 lexical 채점이다 (§6). 두 신호를 함께 쓴다 —
rarity 가중 topic coverage(순위)와 askable ratio + 최장 공통 구간(부재 판정). 한 신호만으로는 각각
라이브에서 틀렸고, 그 두 실패가 `KnowledgeText.weigh` javadoc에 그대로 적혀 있다.

### 11.4 Agent quota

`agent_llm_usage` 호출별 행. 한 run = **run slot 1개 + LLM 호출 2회**(plan + judge) 실측.
`daily-runs-per-org=5`로 낮춰 재기동 → 새 run이 `AGENT_QUOTA_EXHAUSTED`로 정상 종료,
문구는 「오늘 사용할 수 있는 AI 분석 횟수를 모두 썼습니다… 화면의 숫자와 목록은 그대로 이용할 수 있습니다」.
**같은 순간 Dashboard는 6개 KPI와 5개 insight를 그대로 반환했다.** 기본값 복원 확인.

### 11.5 라이브가 찾아 같은 package에서 고친 결함 5건

1. **`CAFE24 ORDER_SUMMARY = ZERO`** — 매출 ₩308,082과 주문 7건을 같은 화면에서 보여주면서.
   coverage가 `channel_orders`(건별)를 세는데 Cafe24 커넥터는 `order_daily_summaries`만 쓴다.
   **`ZERO`는 "없습니다"를 허가하는 유일한 상태**이므로 이건 오탈자가 아니라 계약 위반이었다.
2. **"쿠팡가 매출의 60%"** — Cross-Channel v1의 "쿠팡는"에 이은 두 번째 조사 결함. `Korean` 신설.
3. **"…의 brand은(는) 선바로입니다"** — 조사 placeholder가 그대로 출력되고 fact key가 영어였다.
4. **freshness insight가 사실과 달랐다** — 「이 채널의 최근 데이터는 위 숫자에 포함되지 않았습니다」인데
   NAVER는 주문 48·리뷰 45·문의 1을 그 합계에 실제로 기여하고 있었다. 자기 범위를 과장하는 주의문은
   판매자에게 주의문을 무시하도록 가르친다.
5. **RAG 순위·부재 판정** — §11.3 참조.

### 11.6 회귀

backend **2,833 / 0 failures** · agent-runtime **488 passed / 23 skipped** ·
frontend **161 files / 2,244 tests** · `tsc` clean (frontend·agent-runtime).

### 11.7 남은 데모 blocker

- **화면 스크린샷 없음** — 이 세션에서 브라우저 자동화에 연결하지 못했다. 라우트 렌더 테스트가
  실제 컴포넌트를 마운트해 통과하고 API는 전부 라이브 대조했지만, 시각 확인은 미실시.
- **`/reviews`에 자체 trend가 없다** — 리뷰 추이는 Overview에만 있다.
- **lexical 검색의 한계** — 「교환 반품 규정은 어떻게 되나요」는 판매자가 「교환 **및** 반품」이라고
  써서 매칭되지 않는다. 실패 방향은 정직(「해당 내용이 없습니다」)하지만 recall 손실이다.
- 상품 중복 제목(데모 org의 알려진 사실)이라 「선바로 일체형 전선몰딩」은 두 canonical 상품 중
  먼저 걸리는 쪽으로 해결된다. 20 vs 69 상품 결정과 마찬가지로 범위 밖.

## 12. FEATURE FREEZE (2026-09-22, product-owner decision)

**Demo Core는 이 커밋에서 얼린다.** 남은 작업은 결함 수정과 리허설뿐이고, 새 기능·새 우선순위 기준·
새 화면·새 backend capability는 이 범위에서 추가하지 않는다.

**얼린 것 — 판매자가 걷는 순서 그대로**

| # | 화면 | 소유하는 질문 |
|---|---|---|
| 1 | 홈 `/` (`CustomerOpsHome`) | 자동 확인 → 내 확인 필요 · 확인 필요 · 실행 대기 · 반복 문제 |
| 2 | 확인할 일 `/customer-operations/cases` | 홈이 줄인 그 목록의 전부 — **같은 composer, 같은 건수** |
| 3 | Inquiry Case `/customer-operations/cases/{id}` | 무엇을 확인했고 무엇이 판매자의 결정인가 |
| 4 | Review Case `/reviews/reply/{id}` | 이 리뷰를 어떻게 판단하고 무엇을 할 것인가 |
| 5 | 실행 대기 (홈 안) | 승인했고 아직 등록하지 않은 것 |
| 6 | 반복 문제 (홈 안) → `/memory/{id}` | 무엇이 반복되고 근거는 무엇인가 |
| 7 | Memory `/memory` | 반복 문제 전체와 그 판단·조치 기록 |

**얼린 계약**

- **확인 필요는 하나의 목록이다.** 케이스 · 확인 필요 리뷰 · 문의 큐를 소유 화면으로 dedupe한
  `mergeHomeWork` 하나이고, 홈과 확인할 일이 같은 수를 말한다.
- **정렬 기준은 하나다** — 기다린 시간, 두 그룹(이번 해 · 한 해 넘은 백로그) **안에서만**.
  `/inquiries`의 `isOldBacklog`를 읽는다. 새 우선순위 점수는 만들지 않는다.
- **이 제품에 dispatcher는 없다.** 실행 대기의 모든 행은 링크이고, 승인은 문장을 얼릴 뿐
  등록은 판매자가 판매자센터에서 한다.
- **반복 문제는 일이 아니다.** 확인 필요 아래에 서고, 동사도 버튼도 갖지 않는다.
- **두 「반복」을 섞지 않는다** — `REPEAT_MIN`이 세는 것은 자동 분류 버킷이고 반복 문제는 이슈
  메모리의 aspect+problem signature다. triage 문구는 「반복」을 쓰지 않으며 테스트가 고정한다.

**freeze 밖으로 올리는 것 (product-owner 결정)**

- 홈의 5줄 브리핑 컷에서 **간밤에 조사된 케이스가 보이지 않는다** — 「오래된 순」 규칙대로 recent
  그룹의 맨 뒤에 선다. 바꾸려면 새 우선순위 기준이 필요하고 그것이 이 freeze가 금지하는 것이다.
  확인할 일에는 있다.
- 케이스 화면의 「원문 보기 ↗」와 「발송 화면으로 ↗」가 **같은 URL**이다.
- `SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED=false`로 도는 데모에서 「다음 확인」이 지난 시각을
  말한다(`docs/demo_runbook_v1.md` §1).
- 미결정 리뷰의 `investigated`·`knowledgeUsed`를 rule lane이 기록하지 않는다 — 화면은 초안이
  인용하는 동안 침묵할 뿐, 빈 칸 자체는 backend의 것이다.
