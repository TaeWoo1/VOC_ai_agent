# 3-Channel REAL Agent Validation v1 — baseline (2026-08-23)

> **무엇인가.** canonical Demo Org의 **REAL** Cafe24 + NAVER + Coupang 데이터 위에서 SellerOps Agent
> (`OperatorGraph` v2, `/agent` 자유문장 레인)를 **아무것도 고치지 않은 채로** 6개 셀러 질문에 대해 측정한
> 기록이다. 목적은 기능 추가가 아니라 **제품 가치의 현재 위치를 고정하는 것**이다.
>
> **이 문서가 소유하는 것.** 2026-08-23 baseline run 6건의 plan · tool · evidence · final answer, 8축
> rubric 판정, A/B/C/D 결함 분류. 이 문서는 **수정 전 상태의 고정 기록**이며, 이후 어떤 수정도 이 문서의
> 숫자를 바꾸지 않는다. 수정의 효과는 새 회차 문서로 기록한다.
>
> **이 문서가 소유하지 않는 것.** capability 진실(`docs/multi-channel-connector-roadmap.md` §4.1) ·
> Operator 제품 행동 계약(`docs/sellerops_operator_graph_v2.md`) · 채널 데이터 획득 상태. 어떤 칸도 옮기지
> 않는다.
>
> 상위 계획: `docs/sellerops_operator_graph_v2.md` §18.3(실데이터 라이브 증명 계획).
> evidence 행: `docs/evidence/INDEX.md` §3.

---

## 1. 실행 조건

| 항목 | 값 |
|---|---|
| 일시 | 2026-08-23 16:53–16:55 KST |
| 커밋 | `68d6f407` (working tree clean) |
| org | `7146c50f-ff6d-4c83-ae96-18c930e6d8e0` (데모 제조사) |
| DB | 로컬 PostgreSQL `sellerops` |
| 표면 | `POST /api/agent-runs` (agent-runtime 8787) · `goalText` 자유문장 → `OPERATOR` |
| planner | **ON** — `agent-plan/v1+openai:gpt-5-2025-08-07+agent-plan-prompt/v2+schema/v1+out6000+effort:low` |
| judge | **OFF** — 결정론 rule judge(withhold-only). `operator_judge: judgeKind=RULE_BASED, reason=CAPABILITY_OFF` |
| 마켓 접촉 | **0** |
| 코드·프롬프트·도구 수정 | **0** (측정 전 어떤 튜닝도 하지 않음) |

**planner 활성화는 이 회차의 유일한 노출이다.** `docs/sellerops_operator_graph_v2.md` §18.3이 명시한
절차대로 `sellerops.agent.plan`을 **데모 org 하나에만** 켰다. 벤더 키는 제품 오너 결정에 따라 기존 draft
capability의 키를 재사용했고(플래그 분리는 그대로 유지), judge는 껐다 — rule judge는 withhold-only라
모델이 없을수록 조용해질 뿐 과감해지지 않으므로 **planner 하나만 변수로 두기 위해서**다.

### 1.1 사전 기록 — planner OFF일 때의 같은 6개

planner를 켜기 **전**, 동일한 6개 문장을 그대로 실행했다.

| 결과 | 값 |
|---|---|
| status | **6/6 `FAILED`** |
| trail | `plan_unavailable` |
| failureCode | `PLANNER_CAPABILITY_OFF` |
| plan · specialist · tool call · evidence · finding | 전부 0 |
| 정상 답변 생성 | **0건** |

`docs/sellerops_operator_graph_v2.md` §18.2의 실패 조건 **"planner unavailable 상태에서 정상 답변이
생성됨"은 발생하지 않았다.** 결정론/keyword fallback이 제품·테스트·비상 경로 어디에도 존재하지 않는다는
것이 라이브로 확인됐다.

---

## 2. 데이터 baseline (offline, 마켓 접촉 0)

같은 시점 org의 REAL 데이터. rubric 판정의 정답지는 전부 여기서 나왔다.

| 채널 | REAL 리뷰 | 최신 | 부정 리뷰 | REAL 문의 | 최신 | 미답변 ACTIVE |
|---|---|---|---|---|---|---|
| NAVER | 4,340 | 2026-08-22 | 17 | **0** | — | 0 |
| CAFE24 | 133 | 2026-08-17 | 1 | 3,312 | 2026-05-06 | **69** |
| COUPANG | 23 | 2026-08-23 | 4 | 2 | 2026-08-07 | 0 |
| GMARKET | 11 | 2026-05-21 | 0 | 0 | — | 0 |

- Cafe24 REAL 문의 3,312건 중 **3,199건이 `EXCLUDED_SPAM`**, `ANSWERED` 44건, **미답변 ACTIVE 69건이며
  그 69건의 최신 수신일은 2025-03-27**(측정일 기준 17개월 전)이다.
- **NAVER는 REAL 문의가 한 건도 없다.**
- REAL 리뷰와 REAL 문의가 **동시에** 있는 상품은 **4개뿐**이고, 그 4개 중 **부정 리뷰가 있는 상품은 0개**다.
- `products.name`이 Coupang/Cafe24 유래 상품에서 SKU 숫자다(`15223228019`, `94`, `170`). 사람이 읽는
  이름은 `channel_products.channel_product_name`에만 있다.

### 2.1 Q4 대상 상품 (offline 선정)

`800d396a-eecb-4b78-b227-18c36db080b5` — Coupang 리스팅명 **"판도리 일체형 종이컵 수거함"**
(canonical `products.name`은 SKU `15223228019`).

| 사실 | 값 | 출처 |
|---|---|---|
| REAL 리뷰 | **8건** (2026-07-30 ~ 08-23), 전부 **4~5점** | `reviews` |
| 부정 리뷰 | **0건** | `reviews.is_negative` |
| review issue 근거 | **0행** | `review_issue_evidence WHERE product_id = …` |
| REAL 문의 | **1건**, 상태 `ANSWERED` (2026-07-30) | `inquiries` |
| 채널 | COUPANG 단일 | `channel_products` |

**이 상품에 대한 정답은 "불만·반복 이슈 신호가 없다"이다.** 리뷰/문의 신호가 양쪽에 실재하면서 최근인
유일한 REAL 상품이라 선정했다. 단일 채널이므로 cross-channel 검증은 이 상품으로 불가능하며, **그 사실
자체가 측정 결과**다(§5 D3).

---

## 3. run 기록 (6건)

모든 run 공통: `plan.candidateTools = 0`(계획은 도구를 지명하지 않았다 — v2 설계상 need는 evidence kind이고
도구 선택은 specialist 몫이다) · **WRITE 도구 0** · 모든 `actionClass` = `READ` · 마켓 요청 0.

### Q1 — 「오늘 내가 먼저 확인해야 할 게 뭐야?」 → `DONE`

| 항목 | 값 |
|---|---|
| planner | LLM 사용 |
| plan | need 2 — ① "오늘 미답변 문의가 얼마나 있는가? (총 건수)" `required` ② "오늘 우선 답변해야 할 가장 오래된 미답변 문의는 무엇인가? **(첫 페이지 목록)**" |
| specialists | `INQUIRY_OPS` |
| tool 호출 순서 | `get_today_inbox` → `get_today_inbox` |
| channel coverage | 없음 (org 전체) |
| resolved entities | 없음 |
| evidence | 2건 — `e1`·`e2` 모두 `INBOX_COUNT`, `locator {count: 69, label: 미답변 문의}`, `observedOn = null`, `coverage = COVERED`, `provenance = inbox/SERVER:unansweredInquiries` |
| need 판정 | ①`SATISFIED`(e1) ②**`SATISFIED`(e2)** |
| findings | 1건 `SUPPORTED` — **"답변이 필요한 문의가 69건 있습니다."** |
| note | "근거가 확인되지 않아 1건은 답에서 제외했습니다." (rule judge withhold) |
| nextActions | `문의 확인하기 → /inquiries?state=NEEDS_REPLY` (READ) |
| clarification | 없음 |
| budget | iterations 1 · toolCalls 2 · llmCalls 2 · 16.3s · `COMPLETE` |

**검증.** 69는 DB의 Cafe24 `UNANSWERED/ACTIVE`와 정확히 일치한다. 그러나 ② need는 **목록**을 물었는데
**카운트** 증거로 `SATISFIED`가 됐고, `e1`과 `e2`는 같은 호출의 같은 값이다. 그리고 그 69건은 전부
2025-03-27 이전인데 "오늘"로 물은 질문의 답에 시점 표기가 없다.

### Q2 — 「최근 부정적인 리뷰가 있는 상품을 알려줘.」 → `DONE` (되물음)

| 항목 | 값 |
|---|---|
| plan | need 2 — "현재 감지된 부정적 리뷰 관련 이슈와 그 심각도/추세" · "각 부정적 이슈의 근거가 어느 상품에 얼마나 귀속되며, 최근 기간의 증거가 있는가" (둘 다 `required`) |
| specialists | **없음** (`dispatch_skipped`) |
| tool 호출 | **0회** |
| evidence · findings | 0 · 0 |
| need 판정 | 2건 모두 `PENDING` |
| clarification | "'최근'의 기간(예: 7/14/30일), '부정적 리뷰'의 기준(예: 별점 ≤ 2, 특정 불만 이슈 포함), 그리고 출력 범위(예: 상위 N개, 전부)와 채널 범위가 정해지지 않았습니다." |
| budget | toolCalls 0 · llmCalls 1 · 14.2s · `CLARIFICATION_NEEDED` |

**검증.** `reviews.is_negative`와 rating이 이미 저장돼 있고 REAL 부정 리뷰는 22건이다. 답할 수 있는
질문에 되물었다.

### Q3 — 「반복해서 비슷한 문의가 들어오는 상품이 있어?」 → `DONE` (되물음)

| 항목 | 값 |
|---|---|
| plan | need 1 — "최근 지정 기간 내에 반복 문의 패턴이 감지된 상품(상품별 반복 문의 건수/비중/우선순위)" |
| specialists · tool · evidence · findings | 없음 · 0회 · 0 · 0 |
| clarification | "분석 기간이 지정되지 않았다. 어떤 기간(예: 지난 7일/30일/분기)을 기준으로 반복 문의를 볼지 확인이 필요하다." |
| budget | toolCalls 0 · llmCalls 1 · 15.7s · `CLARIFICATION_NEEDED` |

**검증.** `list_repeated_inquiries`는 `windowDays` 기본값 28을 이미 갖고 있다. 기간을 되물을 이유가 없었다.

### Q4 — 「판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알려줘.」 → `DONE`, **틀린 답**

| 항목 | 값 |
|---|---|
| plan | need 2 — ① "이 상품의 리뷰에서 반복 불만/이슈 신호와 추세가 있는가?" ② "이 상품의 문의에서 반복 질문/불만 패턴과 최근 문의량 증가 여부" (둘 다 `required`) |
| specialists | `REVIEW_OPS`, `INQUIRY_OPS` — **`PRODUCT_OPS` 미배치** |
| tool 호출 순서 | `search_review_issues` → `get_today_inbox` |
| **resolved entities** | **없음 — 상품이 한 번도 해결되지 않았다** |
| evidence | `e1` `REVIEW_ISSUE` 배송 파손 / count 15 / HIGH / `observedOn 2026-06-16`<br>`e2` `REVIEW_ISSUE` 접착 파손 / count 1 / HIGH / `2026-05-22`<br>`e3` `REVIEW_ISSUE` 표면 누락 / count 2 / HIGH / `2026-04-03`<br>`e4` `INBOX_COUNT` count 69 / `observedOn null` |
| need 판정 | ①`SATISFIED`(e1,e2,e3) ②`SATISFIED`(e4) |
| findings | 4건 전부 `SUPPORTED`, judge `RULE_BASED`, `unsafeAssertion=false` — "「배송 파손」에 대한 리뷰 근거가 15건 기록돼 있습니다." · "「접착 파손」… 1건…" · "「표면 누락」… 2건…" · "답변이 필요한 문의가 69건 있습니다." |
| note | **없음** |
| clarification | **없음** |
| budget | toolCalls 2 · llmCalls 2 · 11.6s · `COMPLETE` |

**검증 — 이 run의 모든 상품 귀속은 사실이 아니다.**

```
SELECT count(*) FROM review_issue_evidence
 WHERE product_id = '800d396a-eecb-4b78-b227-18c36db080b5';   -- 0
```

세 이슈의 근거는 각각 3개·1개·1개의 **다른 상품**에 귀속돼 있고, 근거 날짜(2026-04-03 ~ 06-16)는 이
상품의 리뷰 구간(07-30 ~ 08-23) **밖**이다. 69건도 org 전체 수치이며 이 상품의 문의(1건, 답변완료)와
무관하다. 셀러가 이름으로 지목한 상품에 대해 **HIGH 심각도 이슈 3건을 아무 경고 없이 단정**했고, 진실은
"이슈 없음"이었다.

**구조적 원인 세 겹.**
1. `search_review_issues`의 스키마에 **상품 파라미터가 없다** — 이 도구는 구조적으로 org-scope다.
2. **`PRODUCT_OPS`만 상품을 해결한다**(`RESOLVE_PRODUCT`는 그 specialist에만 있다). planner가 배치하지
   않아 `resolved`가 비었다.
3. **compose도 rule judge도 범위 불일치를 보지 않는다.** judge는 "이 finding에 evidence가 붙어 있는가"만
   확인하고 "그 evidence의 범위가 need의 범위와 같은가"는 묻지 않는다.

### Q5 — 「답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘.」 → `DONE`, **내용 0**

| 항목 | 값 |
|---|---|
| plan | need **8** — 미답변 건수/처리범위 · 미답변 목록(오래된 순) · 각 문의의 채널·상품·상태·과거 대응 맥락 · 반복 주제 해당 여부 · 유사 과거 사례와 승인된 답변 문안 · 연결 상품 리스팅/옵션 개요 · 구체적 상품 사실 · **답변 초안 작성을 위한 문의 원문/세부** |
| specialists | `PRODUCT_OPS`, `INQUIRY_OPS` |
| tool 호출 | toolCalls 3 charge, **evidence 0** |
| resolved entities | 없음 |
| findings | **0** |
| need 판정 | 8건 중 5건 `PENDING`, 나머지 미보고 |
| note | "어떤 상품을 묻는지 확인하지 못했습니다. 상품명이나 SKU를 함께 알려주세요. **INQUIRY_OPS 조회에 실패해 이 부분은 답에 포함되지 않았습니다.** 확인하지 못한 항목: …" |
| budget | toolCalls 3 · llmCalls 1 · 18.7s · **`COMPLETE`** |
| 런타임 로그 | `operator_specialist_failed {specialist: INQUIRY_OPS}` (dispatch 후 72ms) |

**근본 원인 확정.** `agent-runtime/src/operator/graph/inquiryOps.ts` 의 `CUSTOMER_HISTORY` 분기는
해결된 상품이 없을 때 `search_customer_memory`를 **anchor 없이**(`{limit: 5}`만) 호출한다. 백엔드
`CustomerMemoryController.search`는 `inquiryId`·`signatureKey`/`topic`·`productId`가 모두 없으면
`400 조회 기준이 필요합니다`로 **정상적으로** 거절한다. 그 예외가 specialist 전체를 죽여, 성공했을
`get_today_inbox`·`list_repeated_inquiries`까지 함께 소실됐다. 코드 주석은 "상품이 없으면 plan의 topic
mention에서 단서를 얻는다"고 적혀 있으나 **topic은 실제로 전달되지 않는다.**

그리고 run은 `FAILED`가 아니라 **`DONE` + findings 0**으로 끝났다 — v2 계약이 "FAILED보다 나쁘다"고
지목한 바로 그 상태다.

**"답변 초안"은 이 레인에서 구조적으로 불가능하다.** Operator 카탈로그는 READ 전용이고 초안 도구가 없다
(초안은 `intent` 레인의 `INQUIRY_DRAFT` 서브그래프 소관). 이것은 결함이 아니라 레인 경계이며, 셀러의
자연스러운 한 문장이 두 레인에 걸친다는 사실이 측정 결과다.

### Q6 — 「최근 판매 운영에서 내가 놓치고 있는 위험이나 개선 포인트가 있어?」 → `DONE` (되물음)

| 항목 | 값 |
|---|---|
| plan | need 5 — 미답변 백로그 · 리뷰 반복 신고의 심각도/추세 · 상품별 이슈 집중도 · 반복 질문 후보 · 저장된 분석의 상세페이지/FAQ 보완 제안 |
| specialists · tool · evidence · findings | 없음 · 0회 · 0 · 0 |
| clarification | "'최근'의 기간 범위(예: 7일/14일/30일)와 점검 범위(모든 채널 vs 특정 채널)가 불명확합니다." |
| budget | toolCalls 0 · llmCalls 1 · 17.6s · `CLARIFICATION_NEEDED` |

**검증.** 계획 분해 자체는 이번 6건 중 가장 정확하게 질문의 폭을 잡았다. 실행이 0이었을 뿐이다.

---

## 4. rubric 판정

`PASS` / `PARTIAL(◐)` / `FAIL` · `—` = 주장이 0건이라 판정 대상 없음.

| # | 항목 | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 |
|---|---|---|---|---|---|---|---|
| 1 | planner correctness | ◐ | FAIL | FAIL | **FAIL** | ◐ | ◐ |
| 2 | retrieval/tool correctness | ◐ | FAIL | FAIL | FAIL | FAIL | FAIL |
| 3 | product-centered reasoning | ◐ | FAIL | FAIL | **FAIL** | FAIL | FAIL |
| 4 | cross-channel reasoning | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| 5 | evidence grounding | **PASS** | — | — | **FAIL** | — | — |
| 6 | freshness/provenance | FAIL | — | — | FAIL | — | — |
| 7 | unsupported-claim avoidance | **PASS** | PASS | PASS | **FAIL** | ◐ | PASS |
| 8 | actionable usefulness | ◐ | FAIL | FAIL | FAIL | FAIL | FAIL |

**판정 근거**

1. **planner correctness** — Q1은 "첫 페이지 목록" need를 `INQUIRY_VOLUME`으로 분류해 카운트 도구로
   보냈다. Q2·Q3·Q6은 기본값이 존재하는데도 되물었다. Q4는 상품명이 문장에 있는데 `PRODUCT_OPS`를
   배치하지 않았다 — 이 한 번의 누락이 Q4의 모든 오류를 만들었다. Q5·Q6의 need 분해 자체는 타당했다.
2. **retrieval/tool correctness** — 실제로 도구가 돈 것은 Q1·Q4·Q5뿐이고, Q1은 같은 도구를 두 번 불러
   같은 증거를 두 개 만들었으며, Q4는 org-scope 도구로 상품 질문을 답했고, Q5는 인자 없는 호출로 죽었다.
3. **product-centered reasoning** — 6건 중 상품을 canonical row로 **해결한 run은 0건**이다.
4. **cross-channel reasoning** — 6건 전부 채널을 한 번도 구분하지 않았다. "69건은 전부 Cafe24이고
   NAVER 문의 데이터는 아예 없다"는 셀러에게 결정적인 사실인데 어느 답에도 없다.
5. **evidence grounding** — Q1의 69는 DB와 정확히 일치한다. Q4는 §3 Q4의 SQL대로 **근거가 0인 상품에
   대한 주장**이다.
6. **freshness/provenance** — 모든 `INBOX_COUNT` 증거의 `observedOn`이 `null`이고, 17개월 된 백로그가
   "오늘"의 답으로 제시됐다. `REVIEW_ISSUE` 증거는 `observedOn`을 갖지만 그 날짜가 질문 대상 기간과
   맞는지 아무도 확인하지 않는다.
7. **unsupported-claim avoidance** — Q1에서 rule judge가 근거 없는 finding 1건을 실제로 제외했다.
   Q2·Q3·Q6은 주장 자체가 0이다. Q5는 빈 답이지만 `note`로 실패를 밝혔다(◐). **Q4만 FAIL이며, 이것이
   이 회차에서 가장 심각한 단일 결과다.**
8. **actionable usefulness** — 셀러가 실제로 쓸 수 있는 결과를 낸 run은 Q1 하나이고, 그 내용은
   대시보드가 이미 보여주는 숫자와 같다.

### 4.1 확인된 성과 — plan divergence는 실재한다

6개 질문이 **6개의 서로 다른 need 집합**과 서로 다른 specialist 조합
(`{INQUIRY}`, `{}`, `{}`, `{REVIEW,INQUIRY}`, `{PRODUCT,INQUIRY}`, `{}`)으로 갈렸다. 고정 tool sequence는
관측되지 않았다. `docs/sellerops_operator_graph_v2.md` §18.2의 실패 조건 중 **"동일 고정 시퀀스"**와
**"planner 부재 시 정상 답변"**은 둘 다 발생하지 않았다.

---

## 5. 반복 failure pattern

| # | 패턴 | 관측 |
|---|---|---|
| P1 | **되물음이 사실상의 기본값** — 기간 기본값이 계획 단계에 없다 | Q2·Q3·Q6 (6건 중 3건이 도구 0회) |
| P2 | **org-scope 증거가 상품/목록 scope의 need를 만족시킨 것으로 기록된다.** rule judge는 "증거가 있는가"만 보고 "증거의 범위가 need의 범위와 같은가"는 보지 않는다 | Q1 ②, Q4 전부 |
| P3 | **specialist 하나의 예외가 run 전체를 삼키고, 결과는 `FAILED`가 아니라 `DONE`+findings 0** | Q5 |
| P4 | **카탈로그 18개 도구 중 9개는 어떤 specialist도 호출하지 않는 죽은 경로**인데 planner에게는 18개 전부가 제시된다 | 전 run |
| P5 | **freshness 무표기** — 데이터의 자기 날짜가 답에 도달하지 않는다 | Q1·Q4 |

**P4의 미도달 9개** — `get_issue_trend` · `get_issue_evidence_summary` · `search_unanswered_inquiries` ·
`get_inquiry_detail` · `list_item_analysis` · `get_dashboard_product_issues` · `search_channel_knowledge` ·
`get_channel_capability` · `get_connection_guidance`. 어느 specialist 코드도 이 이름들을 invoke하지 않는다
(`allowedTools`는 `plan.candidateTools ∪ SPECIALIST_TOOLS[specialist]`이므로 계획이 지명하면 통과는 하지만,
**호출하는 코드 자체가 없다**). Q4의 상품별 이슈 귀속, Q1/Q5의 미답변 목록, Q6의 추세는 전부 이 9개 안에
있다.

---

## 6. 결함 분류

### A — Agent reasoning / product defect

| id | 내용 | 근거 |
|---|---|---|
| **A1** | **상품이 해결되지 않은 채 org-scope 증거로 상품 질문에 단정 답변** | Q4 |
| **A2** | anchor 없는 `search_customer_memory` 호출로 `INQUIRY_OPS` 전체 사망 + `DONE`/0 | Q5 |
| A3 | need 질문과 evidence kind 불일치를 `SATISFIED`로 기록(목록 need ← 카운트 증거) | Q1 ② |
| A4 | 기간 기본값 부재로 인한 습관적 되물음 | Q2·Q3·Q6 |
| A5 | 카탈로그 9개 도구 미도달 — planner에게는 광고됨 | P4 |
| A6 | specialist 실패 원인이 로그에 남지 않음(`operator_specialist_failed`가 이름만 기록) — 관측성 | Q5 |

### B — retrieval / data coverage limitation

| id | 내용 |
|---|---|
| B1 | `search_review_issues`에 상품 파라미터가 없다. 상품 단위 리뷰 이슈는 `get_issue_evidence_summary`로만 가능한데 그것이 A5의 미도달 목록에 있다 |
| B2 | 판매 정책(교환·반품·보증) 저장소 부재 — `inquiryOps.ts`가 이미 정직하게 선언하고 있다 |

### C — UX / presentation

| id | 내용 |
|---|---|
| C1 | `products.name`이 Coupang/Cafe24 유래 상품에서 SKU 숫자 → Agent가 상품을 숫자로 부르게 된다 |
| C2 | clarification·`note`가 `/agent` 화면에서 어떻게 렌더되는지 이번 회차 미검증(API만 측정) |

### D — known channel limitation

| id | 내용 |
|---|---|
| D1 | NAVER REAL 문의 **0건** — 문의 관련 답은 구조적으로 Cafe24 편중 |
| D2 | Cafe24 REAL 문의 3,312건 중 3,199건이 `EXCLUDED_SPAM`, 미답변 ACTIVE 69건은 전부 2025-03-27 이전 |
| D3 | REAL 리뷰와 문의가 동시에 있는 상품 4개, 그중 부정 리뷰가 있는 상품 0개 — cross-channel 상품 검증의 데이터 기반이 얇다 |

**제품 사용을 막는 blocker로 올린 것: A1, A2.** 나머지(A3~A6, B, C)는 backlog.

---

## 7. 결론

- **가장 잘 된 2개** — **Q1**(유일하게 DB와 정확히 일치하는 사실을 evidence 체인과 함께 반환했고, rule
  judge가 근거 없는 1건을 실제로 제외했다) · **Q6**(답은 못 냈지만 5개 need 분해가 질문의 폭을 정확히
  잡았고, 지어내는 대신 되물었다).
- **가장 약한 2개** — **Q4**(근거가 0인 상품에 HIGH 이슈 3건을 확신 있게 귀속) · **Q5**(`DONE`인데 내용 0,
  그리고 요청된 "초안"은 이 레인에 구조적으로 존재하지 않는다).
- **현재 셀러에게 줄 수 있는 가치** — 낮다. 6개 중 검증되는 답은 1개이고 그 내용은 대시보드가 이미
  보여주는 숫자와 같다. 지금 증명된 것은 **"자연어 → LLM 계획 → specialist/도구 → evidence → judge → 답"의
  사슬이 REAL 데이터 위에서 끝까지 돈다**는 구조적 사실이지 셀러 업무의 대체가 아니다. 그리고 그 사슬은
  현재 **틀린 답을 자신 있게 낼 수 있는 상태**이며, 이는 빈 답보다 나쁘다.
- **다음에 고칠 단 하나의 highest-leverage blocker: A1** — need의 범위와 evidence의 범위가 일치하지
  않으면 finding을 조립하지 않는다. 이 하나가 rubric 3·5·7을 동시에 무너뜨린 원인이고, A3(Q1의
  목록/카운트 불일치)도 같은 규칙 하나로 잡힌다.

**안전 확인.** 6 run 전부 WRITE 도구 0 · 모든 `actionClass` READ · nextAction 전부 READ 링크 · 마켓 접촉
0. 실행 창(16:53–16:55) 동안 org 데이터 변경 0건이며, 같은 시간대의 sync job 20건은 self-pilot 정기 READ
스케줄러 소관(마지막 16:48:49)으로 Agent와 무관하다.

---

## 8. 후속

이 baseline은 **고정**이다. A1/A3에 대한 수정은 `Agent Evidence Scope Integrity v1`으로 진행하며 그 결과는
§9로 append한다 — 위 §3·§4의 숫자는 수정하지 않는다. A2는 그 다음 package다.

---

## 9. Agent Evidence Scope Integrity v1 — A1/A3 수정 결과 (2026-08-23)

> §3·§4의 baseline 숫자는 이 절로 바뀌지 않는다. 여기 있는 것은 **같은 질문을 같은 문장으로 다시 물었을
> 때의 결과**다.

### 9.1 무엇을 바꿨나

한 가지 계약만 추가했다 — **need가 요구한 범위와 evidence가 증명하는 범위가 다르면 finding을 만들지 않고
need를 SATISFIED로 기록하지 않는다.** 새 tool 0 · 새 retrieval 0 · planner 프롬프트 변경 0 · 기간 기본값
0 · dead tool routing 변경 0 · A2 미수정 · UI 변경 0.

구현: `agent-runtime/src/operator/scope/EvidenceScope.ts` (계약) ·
`operatorGraph.applyScopeGate` (run의 finding 집합이 조립되는 단일 지점) ·
`RuleEvidenceJudge` (같은 검사를 독립적인 safety floor로).

**검증 축 4개**

| 축 | 규칙 | mismatch 코드 |
|---|---|---|
| entity | ORG / PRODUCT / ITEM | `NO_RESOLVED_PRODUCT` · `ORG_EVIDENCE_FOR_PRODUCT_NEED` · `PRODUCT_MISMATCH` |
| channel | 셀러가 채널을 지목했을 때만 | `CHANNEL_MISMATCH` · `CHANNEL_UNPROVEN` |
| temporal | 셀러가 기간을 지목했을 때, 자기 날짜 없는 총계는 그 기간을 증명하지 못한다 | `TEMPORAL_UNPROVEN` |
| granularity | COUNT / LIST / DETAIL / ISSUE_SIGNAL / GAP | `GRANULARITY_MISMATCH` |

**불변식**

1. PRODUCT-scoped need는 resolved canonical product가 없으면 SATISFIED가 될 수 없다 — **product-scoped
   evidence조차 통과하지 못한다.** 어느 상품을 말한 것인지 확정되지 않았으면 대조할 기준이 없고, "우리가
   읽은 유일한 상품"이 "당신이 물은 상품"으로 조용히 바뀌는 경로가 바로 그것이다.
2. product-scoped need는 org-wide evidence로 만족되지 않는다. **`locator.productId` 부재는 "모르는 상품"이
   아니라 "org 전체"로 읽는다** — Q4의 이슈 3행이 한 상품의 주장이 된 경로가 정확히 그 반대 해석이었다.
3. 다른 product / 다른 channel의 evidence는 붙지 않는다.
4. count evidence는 item/detail/list need를 자동으로 만족시키지 못한다. 판정 근거는 **planner 자신이
   내보내던 `evidenceRequirements.acceptableKinds`** — v2 이후 계속 전송돼 왔으나 런타임에서 아무도 읽지
   않던 필드다. 선언이 없으면 need kind의 floor만 적용된다(선언 없음을 추측으로 메우지 않는다).
5. compatibility를 통과한 evidence만 남긴 뒤에 finding이 run에 조립된다. 강등이 아니라 **미조립**이다.
6. rule judge에도 같은 검사가 들어가되, judge는 floor다. graph gate와 judge는 서로 독립이며 어느 쪽도
   유일한 검사가 되지 않는다. `claimsCoverageLimit` finding은 양쪽 모두에서 면제된다 — "데이터가 없어
   판단할 수 없습니다"는 부재가 곧 근거이고, 그것까지 지우면 false calm만 남는다.

mismatch 시: unsupported finding 생성 금지 · 다른 evidence가 없으면 need는 `UNSATISFIABLE`(사유 포함) ·
최종 답에 근거 범위 제한을 정직하게 표시.

### 9.2 회귀 (offline)

`agent-runtime/test/operator/evidenceScopeIntegrity.test.ts` — **24 tests**.
canonical red test는 **2026-08-23 라이브 모델이 실제로 낸 Q4 plan을 그대로 재생**한다
(`PRODUCT_COMPLAINT_ORGWIDE_PLAN`: PRODUCT 멘션 있음 · `PRODUCT_OPS` 미배치). planner가 같은 실수를
계속해도 계약이 버티는지가 판정 기준이다. Q1 shape는 `INBOX_LIST_NEEDS_ROWS_PLAN`(planner의
`acceptableKinds` 선언 포함)으로 고정했다.

agent-runtime 전체 **260 passed · 23 skipped · 0 failed**.

### 9.3 라이브 재실행 (같은 prompt, 각 2회)

REAL Demo Org · 마켓 접촉 0 · WRITE 0.

**Q4 — 「판도리 일체형 종이컵 수거함 …」** (2회 모두 동일)

| 항목 | 결과 |
|---|---|
| planner | LLM · specialists `PRODUCT_OPS`+`REVIEW_OPS`+`INQUIRY_OPS` (1회차는 1회 re-plan 포함) |
| resolved entities | **없음** — `resolve_product`가 "판도리 일체형 종이컵 수거함"을 찾지 못함 (canonical `products.name`이 SKU `15223228019`이라서 — baseline C1) |
| tools | `resolve_product` → `search_review_issues` → `get_today_inbox` |
| evidence scopes | 4건(재실행 1회차는 re-plan 포함 8건) — `REVIEW_ISSUE` ×3 전부 **ORG**(productId 없음), `INBOX_COUNT` ×1 **ORG** |
| **rejected evidence** | **전건 거절** — `NO_RESOLVED_PRODUCT` |
| findings | **0** |
| needs | 2건 모두 `UNSATISFIABLE`, 사유: 「판도리 일체형 종이컵 수거함」에 해당하는 상품을 찾지 못해, 상품 단위로 확인할 수 있는 근거가 없습니다. |
| final answer | 위 사유 + "…에 해당하는 상품을 찾지 못했습니다" |
| unsupported claims | **0** |
| nextActions | **0** — 다른 상품의 `/memory/{issueId}` 링크 3개가 사라졌다 |
| WRITE | **0** |

**baseline 대비:** HIGH 이슈 3건의 잘못된 상품 귀속 **소멸**. org 전체 미답변 69건을 이 상품의 문의로
말하던 문장 **소멸**. 대신 "상품을 찾지 못했다"는 정직한 진술. DB 진실(리뷰 8 · 부정 0 · issue evidence
0 · 문의 1건 답변완료) 중 현재 tool이 증명할 수 있는 것은 아무것도 없었고, **그래서 아무 주장도 하지
않았다.** 이것이 의도한 결과다.

**Q1 — 「오늘 내가 먼저 확인해야 할 게 뭐야?」** (2회)

| 항목 | 1회차 | 2회차 |
|---|---|---|
| specialists | `INQUIRY_OPS`+`REVIEW_OPS`+`REPORT_OPS` | `INQUIRY_OPS`+`REVIEW_OPS` |
| needs | 3 (2 SATISFIED / 1 UNSATISFIABLE) | 2 (2 SATISFIED) |
| rejected evidence | **0** | **0** |
| findings | 6 | 4 |
| WRITE | 0 | 0 |

**과차단 없음이 확인됐다** — 상품·채널·기간을 지목하지 않은 org 질문은 전과 동일하게 답한다.

### 9.4 A3에 대한 정직한 한계

**두 번의 Q1 재실행 모두 baseline의 mismatch 형태를 재현하지 않았다.** planner가 이번에는 "가장 오래된
미답변 문의는 무엇인가? (첫 페이지 목록)"라는 need를 만들지 않았다(계획 변동). 따라서 **granularity 축이
라이브에서 발화한 적은 아직 없다.** A3의 폐쇄 근거는 결정론적 회귀(§9.2)이며, 라이브 확인은 planner가
같은 형태의 need를 다시 낼 때 이루어진다. 이것을 "라이브에서 증명됐다"고 적지 않는다.

### 9.5 판정

| 결함 | 상태 |
|---|---|
| **A1** — 상품 미해결 상태에서 org-scope 증거로 상품 질문에 단정 | **CLOSED** — 라이브 2회 + 회귀 24건 |
| **A3** — need 질문과 evidence kind 불일치를 SATISFIED로 기록 | **CLOSED (회귀 기준)** — 라이브 재현 미발생, §9.4 |
| A2 — anchor 없는 `search_customer_memory` crash | **미수정, 다음 package** |
| A4·A5·A6 · B · C · D | backlog 유지 |

부수적으로 확인된 것, 수정하지 않음: Q4의 상품 미해결 원인은 **C1**(`products.name`이 SKU 숫자)이다.
사람이 읽는 이름은 `channel_products.channel_product_name`에만 있고 `resolve_product`는 그것을 보지
않는다. 지금은 정직한 "찾지 못했습니다"로 끝나며, 이름 해석을 넓히는 것은 별도 결정이다.

---

## 10. Agent Specialist Failure Semantics v1 — A2 수정 결과 (2026-08-23)

> §3·§4의 baseline 숫자는 이 절로도 바뀌지 않는다.

### 10.1 무엇을 바꿨나

세 가지가 각각 틀렸으므로 각각 고쳤다. 새 retrieval tool 0 · 새 capability 0 · **백엔드 완화 0** ·
C1 미수정 · 기간 기본값 0 · dead tool routing 0 · planner 프롬프트 0 · UI 0.

**① tool 실행 격리** — `agent-runtime/src/operator/failure/SpecialistOutcome.ts`.
`attemptTool()`은 예외를 던지지 않고 결과를 돌려준다. 실패는 **닫힌 어휘의 행**이다:

| 필드 | 값 |
|---|---|
| `specialist` · `tool` · `needId` | 무엇이 무엇을 하다 실패했는가 |
| `category` | `ANCHOR_UNAVAILABLE` · `BAD_REQUEST` · `NOT_FOUND` · `UNAUTHORIZED` · `RATE_LIMITED` · `UPSTREAM_ERROR` · `TRANSPORT` · `TOOL_NOT_ALLOWED` · `BUDGET` · `UNKNOWN` |
| `statusCategory` | `NONE` · `CLIENT_4XX` · `AUTH` · `SERVER_5XX` · `TRANSPORT` — **숫자가 아니라 등급** |
| `recoverable` | 같은 호출이 나중에 성공할 수 있는가 (5xx·transport·429 = 예, 4xx·anchor·tool refusal = 아니오) |

분류는 예외의 **형태만** 읽는다(`status`, `name`). **`message`는 읽지도 기록하지도 않는다** — 백엔드
오류 메시지는 보낸 것을 되뱉을 가능성이 가장 큰 필드다. 적용: `INQUIRY_OPS`의 네 갈래 전부,
`REVIEW_OPS`의 단일 read. `PRODUCT_OPS`는 `resolve_product → 나머지`라는 **선언된 의존**을 이미 자체
처리하므로 그대로 두고, graph의 catch가 backstop으로 같은 구조화 행을 남긴다.

**② anchor 없는 `search_customer_memory`는 호출하지 않는다** — 응답에서 배우지 않고 **호출 전에**
확인한다. 백엔드 `CustomerMemoryController.search`는 그대로 엄격하다(anchor 없는 전역 검색 여전히 400).
도달 가능한 anchor는 오늘 기준 **resolved product 하나뿐**이며, 셀러의 문장은 anchor가 아니다 — 고객
문장은 질의어가 될 수 없고, 그래서 그 엔드포인트에는 자유텍스트 파라미터가 없다. 없으면 need는
`UNSATISFIABLE` + 사유, 실패는 `ANCHOR_UNAVAILABLE`로 기록된다. **예산은 실제로 일어난 호출에만
청구한다**(라이브에서 하지 않은 호출 3건을 청구하던 것을 같이 고쳤다).

**③ failure semantics**

| 상황 | specialist | run |
|---|---|---|
| 실패 0 | `OK` | — |
| 일부 성공 + 일부 실패 | **`PARTIAL`** — 성공 evidence/finding 유지, 실패 사유 노출 | — |
| 성공 0 + 실패 있음 | `FAILED` | — |
| findings 0 **+ ANCHOR_UNAVAILABLE 아닌 실패 존재** | — | **`FAILED` / `EVIDENCE_UNAVAILABLE`** |
| findings 0 + 의도적 skip만 | — | `DONE` (사유는 답에 표시) |

**의도적 skip은 시스템 실패가 아니다.** "조회할 수 없다는 것을 알고 말했다"와 "답했어야 할 조회가
실패했다"는 반대 사실이고, 빈 답 카드로는 구분되지 않는다. 읽기가 **성공하고 비어 있던** run은 여전히
`DONE`이다 — 조용한 받은편지함은 참인 답이기 때문이다.

**④ observability** — `operator_specialist_failed`가 이름만이 아니라
`specialist · tool · category · statusCategory · recoverable`를 남긴다. `inquiry_ops`는
`succeeded · failed · terminal`을, `operator_compose`는 `specialistsFailed · specialistsPartial`을 남긴다.
**raw payload · credential · 고객 문장 · HTTP 숫자 · id는 로그에 없다.**

**⑤ 초안 capability 한계 표시** — Operator 카탈로그는 구조적으로 READ 전용이므로 이 레인에서 답변
초안은 만들 수 없다(초안은 `intent` 레인의 `INQUIRY_DRAFT` 서브그래프 소관). 그 사실을 최종 답에 한
문장으로 적는다. 이것은 **capability 고지이지 routing이 아니다** — plan·tool·specialist·status 어느 것도
선택하지 않으며, 자유문장 해석을 금지하는 fence의 대상(`parseGoal`)이 아니다. **초안 capability 자체는
만들지 않았다.**

### 10.2 회귀 (offline)

`agent-runtime/test/operator/specialistFailureSemantics.test.ts` — **18 tests**.
red test는 **2026-08-23 라이브 plan(`PRIORITIZE_AND_DRAFT_PLAN`)을 재생**하고,
`FakeOperatorSpringClient`가 **실제 백엔드와 같은 precondition을 강제**한다(anchor 없으면 400). 즉 이
suite는 옛 코드에서 라이브와 **같은 이유로** 빨개진다 — double에게 실패하라고 시켜서가 아니다.

agent-runtime 전체 **278 passed · 23 skipped · 0 failed**.

### 10.3 라이브 재실행 — 같은 prompt 2회

「답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘.」 · 마켓 접촉 0 · WRITE 0.

| 항목 | run c | run d |
|---|---|---|
| plan | LLM · needs 5 · `INQUIRY_OPS` | LLM · needs 4 · `INQUIRY_OPS` |
| tool 실행 | `get_today_inbox` ×2 **성공** | `get_today_inbox` ×1 **성공** |
| **skipped tool** | `search_customer_memory` ×3 — `ANCHOR_UNAVAILABLE` | `search_customer_memory` ×3 — `ANCHOR_UNAVAILABLE` |
| tool failures | 0 (hard) | 0 (hard) |
| **preserved evidence** | `INBOX_COUNT` ×2 | `INBOX_COUNT` ×1 |
| specialist terminal | **`PARTIAL`** | **`PARTIAL`** |
| run terminal | `DONE` | `DONE` |
| findings | 1 — "답변이 필요한 문의가 69건 있습니다." | 0 |
| needs | 2 `SATISFIED` / 3 `UNSATISFIABLE`+사유 | 4 `UNSATISFIABLE`+사유 |
| unsupported claims | 0 | 0 |
| WRITE | 0 | 0 |
| budget toolCalls | 2 | 1 |

**백엔드 `/api/customer-memory/search` 요청 0건** — 400이 발생한 것이 아니라 애초에 부르지 않았다.

두 run 모두 최종 답에 세 문장이 함께 나온다: 과거 사례는 대상을 특정해야 찾을 수 있다는 사실 · 초안은
이 창구에서 만들지 않는다는 lane 한계 · (run c) 근거 미확인 1건 제외.

**baseline 대비:** 성공한 read가 예외에 딸려 사라지는 일 **소멸**. `DONE`+findings 0에 숨어 있던
specialist 예외 **소멸** — 이제 `specialistOutcomes`가 항상 terminal을 보고한다. 요청의 절반(초안)이
조용히 누락되던 것도 **명시**된다.

### 10.4 이번 회차에서 새로 관측된 것 (수정하지 않음)

**run d에서 §9의 temporal 축이 라이브에서 처음 발화했다.** planner가 "오늘"을 `PERIOD`로 선언했고,
`INBOX_COUNT`는 `observedOn`이 `null`이라 `TEMPORAL_UNPROVEN`으로 거절돼 finding이 0이 됐다. 계약대로
동작한 것이지만, **미답변 총계는 실제로 "지금" 값이므로 참인 문장이 보류된 false negative**다. 원인은
`get_today_inbox` evidence에 자기 시각이 찍히지 않는 것이고, 고치는 방법은 기간 기본값을 만드는 것이
아니라 그 evidence에 관측 시각을 기록하는 것이다. **이번 package 범위 밖이라 손대지 않고 기록만 한다.**
같은 질문이 run c에서는 finding 1건을 냈다 — 즉 plan 변동에 따라 답이 갈린다.

### 10.5 판정

| 결함 | 상태 |
|---|---|
| **A2** — anchor 없는 호출로 `INQUIRY_OPS` 전체 소실 + `DONE`/0 | **CLOSED** — 라이브 2회 + 회귀 18건 |
| A1 · A3 | CLOSED (§9) |
| A4 · A5 · A6 · B · C · D | backlog 유지 |
| **신규** — `INBOX_COUNT`에 관측 시각 부재로 인한 temporal false negative | backlog (§10.4) |

---

## 11. Agent Temporal Evidence Semantics v1 — §10.4 관측 수정 (2026-08-23)

> §3·§4의 baseline 숫자는 이 절로도 바뀌지 않는다.

### 11.1 무엇이 틀렸나

§9의 temporal 축에는 **시간이 한 종류뿐이었다.** `EvidenceRef.observedOn` 하나가 "언제 봤는가"와
"언제 일어났는가"를 동시에 의미했고, 축은 그 필드가 비었는지만 물었다. 그래서 §10.3의 두 라이브 run이
갈렸다 — 같은 문장, 같은 데이터, planner가 "오늘"을 `PERIOD`로 선언했는지에 따라 **참인 총계가 나오거나
근거 없음이 나왔다**.

**날짜를 찍는 것은 해결이 아니다.** 받은편지함 count에 오늘 날짜를 찍으면 두 run 모두 답은 하지만,
"현재 미답변 69건"이 "오늘 들어온 문의 69건"이 된다. false negative를 **거짓 주장으로** 바꾸는 거래다.

### 11.2 무엇을 바꿨나

새 tool 0 · planner 프롬프트 0 · 기간 기본값 0 · C1 미수정 · dead tool routing 0.

**① evidence가 두 개의 시간을 따로 갖는다** — `agent-runtime/src/operator/scope/EvidenceTime.ts`.

| 필드 | 의미 | 언제 있는가 |
|---|---|---|
| `asOf` | **SellerOps가 언제 봤는가.** 신선도, 그 이상 아무것도 | 모든 live read — 읽는 행위는 언제나 시각을 갖는다 |
| `events` | **밑의 행이 언제 일어났는가** (`from`~`to`, 한쪽만 알아도 range) | 출처가 말할 수 있을 때만. `null` = 모름, 결코 "지금"이 아님 |

`EvidenceBuilder`가 `asOf`는 항상 채우고 `events`는 **절대 채우지 않는다** — 호출부가 데이터에서
읽어 넘길 때만 생긴다. 질의 window에서도 만들지 않는다: 30일을 물었다는 사실은 어떤 행도 그 안에
있었음을 증명하지 않는다.

**② need가 둘 중 하나를 요구한다** — 판정은 **planner가 이미 보내는 need `kind`**에서 나온다.

| demand | need kind | 무엇으로 충족되는가 |
|---|---|---|
| `NONE` | 기간을 말하지 않은 모든 need | 시간을 묻지 않았다 |
| `CURRENT_STATE` | `INQUIRY_VOLUME` · `PRODUCT_FACT` · `PRODUCT_LISTING` · `PRODUCT_VARIANT` · `POLICY` | 신선한 관측(`asOf`) |
| `PERIOD_EVENTS` | `REPEAT_PATTERN` · `REVIEW_SIGNAL` · `CUSTOMER_HISTORY` · `ORDER_HISTORY` | **`events` 필수.** `asOf`는 대체하지 못한다 |

한국어 산문을 읽지 않으므로 **planner가 같은 질문을 다르게 써도 답이 움직이지 않는다.**

**③ 장치는 둘이고, 둘은 다른 것을 본다.** scope gate는 **need가 무엇을 물었는지**를, rule judge는
**문장이 무엇을 주장하는지**를 읽는다. 후자가 없으면 "현재 미답변 69건"과 "오늘 들어온 문의 69건"을
구분할 수 없다 — 둘은 같은 근거를 인용하고 하나만 증명된다. 기간어 + 발생어가 함께 있는 문장이 행의
날짜를 모르는 근거에만 기대면 `unsafeAssertion`("관측 시점을 발생 기간의 근거로 사용")이다. plan이
`CURRENT_STATE`라고 했어도 거절된다.

**④ `INBOX_COUNT`는 현재 상태의 snapshot으로 명시됐다** — 이름과 달리 "오늘 들어온 문의"가 아니다.
문장도 「**현재** 답변이 필요한 문의가 N건 있습니다」로 바뀌었다. "현재"는 예의가 아니라 근거가
증명하는 범위다.

**⑤ observability** — `operator_plan`이 `periodNamed`를 남긴다. **어느 기간인지가 아니라 기간을
말했는지만** — mention은 판매자 자신의 문장이다. 이 boolean 하나가 없어서 §10.4의 갈림을 로그로
진단할 수 없었다.

### 11.3 회귀 (offline)

`agent-runtime/test/operator/temporalEvidenceSemantics.test.ts` — **21 tests.** red test는 §10.3의
divergence를 재현한다: 같은 goal, `PERIOD` mention만 다른 두 plan. 옛 규칙으로 되돌리면 **5건이 빨개진다**
(확인함). 요청된 세 가지 회귀는 모두 포함됐다 — 현재 backlog 허용 / 기간 주장 거부 / `PERIOD` need +
관측 시각만 = `TEMPORAL_UNPROVEN`.

agent-runtime 전체 **300 passed · 23 skipped · 0 failed** (이전 278 → +21 신규, +1 judge).

### 11.4 라이브 재실행 — Q1 ×2, Q5 ×2

마켓 접촉 0 · WRITE 0 · 모든 `nextAction` = `READ`.

**Q1 「오늘 내가 먼저 확인해야 할 게 뭐야?」 — planner가 실제로 갈렸고, 답은 갈리지 않았다.**

| | run g | run h |
|---|---|---|
| `periodNamed` (plan 로그) | **`true`** | **`false`** |
| needs | 2 | 2 |
| findings | **4** | **4** |
| 문장 | 「현재 답변이 필요한 문의가 69건 있습니다」 + 리뷰 이슈 3건 | **동일** |
| evidence | `INBOX_COUNT` ×1 + `REVIEW_ISSUE` ×3 | 동일 |
| scope 거절 | 0 | 0 |

**이것이 이번 package의 증명이다.** 수정 전 규칙이었다면 run g의 `INBOX_COUNT`는 `TEMPORAL_UNPROVEN`으로
거절돼 "69건"이 사라졌을 것이다. 두 축이 모두 라이브에서 발화했고 둘 다 참을 통과시켰다:
`INQUIRY_VOLUME` → `CURRENT_STATE` → `asOf=2026-08-23` 통과, `REVIEW_SIGNAL` → `PERIOD_EVENTS` →
`events` 보유 통과.

**두 시간이 라이브에서 실제로 다르다** — 리뷰 이슈 evidence는 `asOf=2026-08-23`이면서
`events=2025-08-29~2026-06-16`이다. 즉 "지금 확인했고, 일어난 것은 작년부터"가 한 행에 구분돼 있다.

**Q5 「답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘.」**

| | run g | run h |
|---|---|---|
| plan | LLM · needs 5 · `INQUIRY_OPS` | LLM · needs 7 · `INQUIRY_OPS`+`PRODUCT_OPS` |
| findings | **1** — 「현재 답변이 필요한 문의가 69건 있습니다」 | **1** — 동일 |
| specialist terminal | `INQUIRY_OPS` `PARTIAL` | `INQUIRY_OPS` `PARTIAL` · `PRODUCT_OPS` `OK` |
| skipped tool | `search_customer_memory` ×3 `ANCHOR_UNAVAILABLE` | ×2 동일 |
| 백엔드 `/api/customer-memory/search` | **0건** | **0건** |
| 초안 lane 한계 문장 | 있음 | 있음 |
| WRITE | 0 | 0 |

§10.3의 run d는 findings 0이었다. **두 run 모두 참인 총계를 말한다.**

### 11.5 이번 회차에서 새로 관측된 것 (수정하지 않음)

- **compose의 dedupe 메시지가 부정확하다.** 같은 문장 2건이 중복 제거될 때 「근거가 확인되지 않아 1건은
  답에서 제외했습니다」라고 말한다. 실제 이유는 중복이고 근거는 있었다. baseline부터 있던 C급 문구
  결함이며 temporal과 무관해 손대지 않았다.
- **`asOf`는 신선도를 증명하지만 staleness 정책은 없다.** 오래된 관측도 `CURRENT_STATE`를 통과한다.
  임계값을 넣는 것은 기간 기본값을 발명하는 것이므로 하지 않았다.

### 11.6 판정

| 결함 | 상태 |
|---|---|
| **§10.4 신규** — `INBOX_COUNT` 관측 시각 부재로 인한 temporal false negative / planner 표현에 따른 답 갈림 | **CLOSED** — 라이브 4회(그중 실제 `periodNamed` 갈림 1쌍) + 회귀 21건 |
| A1 · A2 · A3 | CLOSED (§9 · §10) |
| A4 · A5 · A6 · B · C · D | backlog 유지 |
| **신규** — compose dedupe 문구 · staleness 정책 부재 | backlog (§11.5) |

---

## 12. Agent Operational Defaults v1 — A4 수정 (2026-08-23)

> §3·§4의 baseline 숫자는 이 절로도 바뀌지 않는다.

### 12.1 무엇이 틀렸나

baseline 6건 중 **3건이 질문에 질문으로 답했다.** Q2·Q3·Q6 모두 "기간을 정해달라"고 되물었고, 셋 다
**tool 0회 · evidence 0 · findings 0**이었다. 그런데 `list_repeated_inquiries`에는 28일 기본 창이 처음부터
선언돼 있었다. 판매자에게 **백엔드가 곧 스스로 채울 파라미터를 물은 것**이다.

### 12.2 감사 결과 — 각 capability가 이미 선언하고 있는 범위

**여기서 정한 것은 하나도 없다.** 아래는 전부 기존 코드를 읽은 결과다.

| need kind | tool | 선언된 범위 | 어디에 선언돼 있나 |
|---|---|---|---|
| `INQUIRY_VOLUME` | `get_today_inbox` | **현재 시점 snapshot** (기간 개념 없음) | `inquiries/inbox:unansweredInquiries` |
| `REVIEW_SIGNAL` | `search_review_issues` | **기간 필터 없음** — 미해제 이슈 전체를 심각도·최신순으로 | `ReviewIssueQueryService.list(dismissed=false)` |
| `REPEAT_PATTERN` | `list_repeated_inquiries` | **최근 28일 trailing** | `RepeatedInquiryService.DEFAULT_WINDOW_DAYS` |
| `CUSTOMER_HISTORY` | `search_customer_memory` | 기간이 아니라 **anchor**로 범위가 정해짐 | `customer-memory/search` (§10 A2) |
| `PRODUCT_FACT/LISTING/VARIANT` | `get_product_knowledge` · `search_product_facts` | 현재 시점 | `product-knowledge:current` |
| `POLICY` | — | 저장소 없음 — 그 사실이 완결된 답 | `policy-store:UNAVAILABLE` |
| **`ORDER_HISTORY`** | **없음** | **선언된 범위 없음** | 도달 가능한 tool이 하나도 없다 |

**`REVIEW_SIGNAL` 행이 이번 감사에서 가장 중요하다.** 「최근 부정적인 리뷰」의 정직한 기본값은 *창*이
아니라 **현재 열려 있는 이슈 목록**이다. 판매자가 물은 최신성은 질의가 아니라 **행 자신의 날짜**에 있다.
"기본값이 없으니 물어야 한다"는 틀린 감사 결과였을 것이고, 빈칸을 창으로 채우는 것은 더 나빴을 것이다.

### 12.3 감사에서 나온 불편한 결과 — 우선순위 1이 현재 도달하지 않는다

**어떤 READ tool도 판매자가 쓴 범위를 받지 않는다.** `list_repeated_inquiries`는 `windowDays` — **숫자**를
받는다. 「최근」이나 「요즘」을 숫자로 바꾸는 것은 누가 하든 추측이다. 그래서 오늘 판매자가 말한 기간은
**무엇을 조회할지를 바꾸지 못하고, 무엇을 말해야 하는지를 바꾼다.** 범위를 말했는데 capability가 적용할
수 없으면, run은 선언된 기본값으로 진행하고 **그 차이를 답에 표시한다.**
`ScopeSource`의 `"USER"` 값은 코드에 남아 있고 오늘 아무도 도달하지 않는다 — 도달할 수 없는 값을
이름으로 남기는 것이 그 공백을 표시하는 방법이다.

### 12.4 무엇을 바꿨나

새 tool 0 · 새 retrieval 0 · 백엔드 검색 완화 0 · staleness 정책 0 · C1 미수정 · A5 미수정 · UI 0.
**"최근=28일" 같은 전역 정책은 만들지 않았다.**

**① 우선순위**: 판매자가 말한 범위 → capability가 선언한 범위 → 둘 다 없을 때만 되묻기.

**② 되묻기 규칙** — **시스템이 이미 답을 갖고 있는 되묻기는 되묻기가 아니라 실행되지 않은 run이다.**
planner의 `clarificationNeeded`는 **required need 중 어느 것도 수행 불가일 때만** 판매자에게 전달된다.
일부라도 수행 가능하면 run은 그 일을 하고 못 채운 need를 사유와 함께 표시한다. 수행 불가는 두 가지뿐이다
— 선언된 범위가 없거나(`ORDER_HISTORY`), plan이 해결하지도 언급하지도 않은 anchor가 필요하거나
(「상품에 문제 있어?」). **둘 다 회귀로 고정돼 있다.**

**③ 순서가 중요하다** — 감사는 `validatePlan` **앞에서** 돈다. V8이 "되묻는 plan은 specialist를 갖지
않는다"로 specialist를 모두 지우기 때문에, 계약이 이미 답한 되묻기는 plan이 아직 무엇을 하려 했는지
알고 있을 때 해소돼야 한다.

**④ plan에 구조적으로 남는다** — `appliedDefaults[]`: `needId` · `needKind` · `userNamed`(판매자의 말) ·
`source`(`USER`/`CAPABILITY`/`NONE`) · `contract`(선언 위치) · `scope`(닫힌 토큰) ·
`honoursUserScope`. **자유 텍스트 추론이 아니다.** 런타임이 계약에서 계산하며 planner는 이 필드를 갖지
않는다 — 모델에게 기본값을 물으면 그럴듯한 숫자를 말할 것이기 때문이다.

**⑤ 답에 근거 범위를 표시한다** — 말할 가치가 있는 두 가지만: 판매자가 고르지 않은 trailing 창, 그리고
판매자가 골랐지만 적용할 수 없었던 기간. 기간을 말하지 않은 질문에 "현재 시점 기준"을 붙이는 것은 소음이다.

**⑥ 숫자는 백엔드 것이다** — 문장의 28은 반환된 행이 echo한 `windowDays`에서 온다. TS 상수는 행이 하나도
없을 때만 쓰이고, echo와 다르면 `operator_default_drift`를 남긴다. **거울이 이길 수 있으면 아무도 적용하지
않은 창을 답이 설명하게 된다.**

**⑦ 「최근」을 답할 수 있는 유일한 방법** — 리뷰 이슈 문장에 그 행 자신의 마지막 근거 날짜를 붙였다
(`(최근 근거 2026-06-16)`). 관측 시각이 아니라 **event time**이다.

**§11과 충돌하지 않는다.** 기본 질의 창은 **retrieval scope**이고 `EvidenceTime`은 **evidence time**이다.
28일을 요청했다는 사실은 어떤 행도 날짜 짓지 않는다. 기본값 적용이 `asOf`를 움직이지 않고 `events`를
만들지 않는다는 것이 회귀로 고정돼 있다.

### 12.5 회귀 (offline)

`agent-runtime/test/operator/operationalDefaults.test.ts` — **20 tests.** 되묻기를 그대로 통과시키도록
되돌리면 **9건이 빨개진다**(확인함). 음성 대조군 — 주문 이력(선언된 범위 없음)과 이름 없는 상품(anchor
없음) — 은 두 버전 모두에서 초록이다. **모든 되묻기를 지우는 스위치가 아니라 규칙이라는 증거다.**

agent-runtime 전체 **319 passed · 23 skipped · 0 failed**.

### 12.6 라이브 재실행 — Q2 ×2, Q3 ×2, Q6 ×2

마켓 접촉 0 · WRITE 0 · 모든 `nextAction` = `READ` · **되묻기 6/6에서 0회**(baseline 3/3 되묻음).
plan 로그 기준 모델은 이 12회 중 **7회 되묻기를 요청했고, 감사가 7회 모두 해소**했다.

| | Q2 (e/f) | Q3 (e/f) | Q6 (e/f) |
|---|---|---|---|
| clarification | **없음** / 없음 | **없음** / 없음 | **없음** / 없음 |
| specialists | `REVIEW_OPS` | `INQUIRY_OPS` | `INQUIRY_OPS`+`REVIEW_OPS`+`PRODUCT_OPS`/`REPORT_OPS` |
| tool 호출 | 1 / 1 | 2 / 1 | 5 / 4 |
| findings | **3 / 3** | 0 / 0 | **4 / 6** |
| 적용된 범위 | `SNAPSHOT_NOW` ×2 | `TRAILING_28D` | `SNAPSHOT_NOW` ×2 + `TRAILING_28D` ×2~3 |
| unsupported claims | 0 | 0 | 0 |

baseline은 셋 다 tool 0 · findings 0 · 되묻음이었다.

**Q3의 findings 0은 정직한 답이고, DB로 확인했다.** 데모 org의 최근 28일 `customer_memory_entries`는
282건이지만 그중 **`INQUIRY`는 2건**뿐이고(280건은 `REVIEW`), 주제 필터·`기타` 제외·`MIN_OCCURRENCES=2`를
지나면 **반복 후보가 0**이다. 답은 「반복해서 들어온 문의는 확인되지 않았습니다. **반복 문의는 최근 28일
기준으로 확인했습니다.**」 — 판매자는 "없음"이 어느 창에서의 없음인지 안다. **A4의 목표는 findings를
늘리는 것이 아니라 되묻기를 없애는 것이었고, 그것은 달성됐다.**

**Q6은 하나의 기간을 모든 need에 강요하지 않는다.** 미답변은 현재 snapshot, 반복은 28일, 리뷰 이슈는 열린
목록 — 한 답 안에서 세 범위가 각각의 계약대로 적용되고 각각 표시된다.

### 12.7 이번 회차에서 발견해 같이 고친 것

- **planner가 지어낸 기간을 판매자의 말로 인용하고 있었다.** 라이브에서 planner가 「분석 기간 미지정」을
  `PERIOD` mention으로 내보냈고, 답이 「분석 기간 미지정」은 …이라고 판매자가 쓴 적 없는 말을 인용했다.
  이제 **goal 문장에 실제로 있는 mention만 인용한다.** 없으면 근거 범위는 그대로 말하되 인용을 붙이지
  않는다. 회귀 고정.
- **같은 문장이 need 수만큼 반복됐다.** 「반복해서 들어온 문의는 확인되지 않았습니다」가 Q6에서 3번 나왔다.
  read 하나가 그 종류의 need 전부를 답하므로 사실은 하나다. `inquiryOps` 노트 dedupe.

### 12.8 이번 회차에서 새로 관측된 것 (수정하지 않음)

- **Q2는 "상품을 알려줘"에 상품을 대지 못한다.** 이슈 3건 모두 `dominantProductId`가 없어 §9의 scope
  게이트가 상품 귀속을 정확히 막는다. 답은 이슈와 근거 날짜까지만 말한다 — 이는 **B1**(`search_review_issues`에
  상품 파라미터 없음)이고 이번 package 범위 밖이다.
- §11.5의 두 backlog(compose dedupe 문구 · staleness 정책 부재)는 그대로 열려 있다.

### 12.9 판정

| 결함 | 상태 |
|---|---|
| **A4** — 시스템이 이미 답을 가진 것을 되묻고 tool 0회로 종료 | **CLOSED** — 라이브 6회 되묻기 0(모델 요청 7회 전부 해소) + 회귀 20건 |
| A1 · A2 · A3 · §10.4 temporal | CLOSED (§9 · §10 · §11) |
| A5 · A6 · B · C · D | backlog 유지 |
| 신규 — Q2 상품 귀속(B1 하위) | backlog (§12.8) |

---

## 13. Human Product Name Resolution v1 — C1 수정 (2026-08-23)

> §3·§4의 baseline 숫자는 이 절로도 바뀌지 않는다.

### 13.1 무엇이 틀렸나

§9.3에서 A1을 닫은 뒤 Q4는 **정직하게 틀렸다**: "「판도리 일체형 종이컵 수거함」에 해당하는 상품을 찾지
못했습니다." 2회 모두 같았다. 그런데 그 상품은 **존재하고**, REAL 리뷰 7건과 REAL 문의 1건을 갖고 있으며,
셀러가 자기 쿠팡 리스팅에서 읽는 이름이 정확히 그 문장이었다.

`products.name`이 **`15223228019`** — 즉 SKU 숫자였고, `resolve_product`는 그 필드만 읽었다.
사람이 읽는 이름은 `channel_products.channel_product_name`에만 있었다.

**셀러가 자기 상품을 자기 상품 이름으로 부르지 못하는 상태**였다.

### 13.2 무엇을 바꿨나

`channel_products.channel_product_name`을 **canonical product resolution alias**로 쓴다.

| 순위 | surface | 규칙 |
|---|---|---|
| 0 | `SKU_EXACT` | `products.sku` 완전 일치 |
| 1 | `CANONICAL_NAME_EXACT` | `products.name` 완전 일치 |
| 2 | **`CHANNEL_PRODUCT_NAME_EXACT`** | **리스팅 제목 완전 일치 → 그 리스팅이 이미 연결된 canonical product** |
| 3 | `CANONICAL_NAME_PARTIAL` | `products.name` 부분 일치 (유일한 비정확 surface) |

**alias는 완전 일치만 한다.** normalize는 화면에서 보이지 않는 차이만 지운다 — NFC · trim · lowercase ·
연속 공백 축약, 4단계. 이는 `ContentHash.normalize`가 이미 쓰는 규칙과 같은 것이며, 하나의 정의로
`ProductNameKey`에 모았다. **유사도 점수도, 모델 추측도, 상품 병합도 없다** — 데모 org에는
「선바로 2p」와 「선바로 4p」처럼 한 글자 차이의 별개 상품이 실제로 있고, 그 둘을 구분하지 못하는 해석기는
답이 아니라 사고다.

**리스팅을 찾고, 그 리스팅이 이미 붙어 있는 canonical product를 돌려준다.** 생성 0, 병합 0
(`resolvingCreatesNothing` 회귀).

**범위는 org × REAL, 두 겹으로.** 두 read 모두 org-scoped이고, 자동 활성화된 `realDataOnly` 필터가
양쪽에서 seeded row를 제외한다 — 합성 리스팅이 실제 상품의 이름이 될 수 없고, 다른 테넌트의 리스팅에는
닿지 않는다.

### 13.3 같은 이름이 여러 상품에 붙어 있을 때 — 임의 선택 금지

**exact surface에서의 동점은 해결 불가이며, 해결하지 않는다.** 후보 목록에 각 행이 어느 surface에서
맞았는지(`matchedOn`)가 실려 오므로, "후보가 여럿"과 "**똑같이 좋은** 후보가 여럿"이 구별된다. 정확한 SKU
하나 + 부분 일치 셋은 해결된 것이고, 같은 제목의 리스팅 둘은 해결되지 않은 것이다.

동점이면 run은 고르지 않고 **무엇이 있으면 정해지는지**를 말한다:
「"스노우 누리젠"이라는 이름으로 등록된 상품이 4개 있어 어느 쪽을 말씀하시는지 정하지 못했습니다.
상품코드(SKU)나 채널을 함께 알려주세요.」

**부분 일치의 동점은 다른 상황이라 그대로 둔다.** 셀러가 조각을 말했으므로 그중 하나가 정말 그 상품일 수
있다 — run은 진행하고 어느 쪽을 택했는지 밝힌다(기존 동작).

> **범위를 넓힌 판단, 명시.** 요구는 alias 동점에 대한 것이었으나, 같은 규칙을 `CANONICAL_NAME_EXACT`
> 동점에도 적용했다. 데모 org에서 「스노우 누리젠」은 **canonical name이 4개 상품에 그대로 중복**돼 있고
> (라이브 확인), 이전에는 그 4개 중 첫 번째를 조용히 골랐다. 같은 증거·같은 실패 형태이므로 같은 규칙을
> 적용했다. 되돌리려면 `EXACT_SURFACES`에서 `CANONICAL_NAME_EXACT`를 빼면 된다.

### 13.4 답이 부르는 이름

alias로 맞았을 때는 **그 리스팅 제목이 답의 상품 이름**이 된다(`matchedName`). 셀러가 상품 제목을 쳤는데
`15223228019`를 읽어주는 것은 그 셀러의 상품에 대한 답이 아니다. SKU 숫자는 카탈로그에 남는다.

### 13.5 회귀 (백엔드 10 · agent-runtime 9)

**red 증명.**

| 되돌린 것 | 빨개지는 테스트 |
|---|---|
| alias surface 제거 (백엔드) | **10건 중 5건** |
| alias surface 제거 (agent-runtime fake) | **9건 중 3건** |
| 동점 거부 + 사람 이름 label 제거 | **9건 중 2건** |

**세 fence는 양쪽 모두 초록으로 남는다** — 타 org alias, DEMO_SEED alias, 없는 이름. 기능을 끄면 통과하는
테스트이므로 대조군이며, 규칙이 "찾기를 넓히는 스위치"가 아니라는 증거다.

전체: 백엔드 **2736 passed · 0 failed**, agent-runtime **329 passed · 23 skipped · 0 failed**.

### 13.6 라이브 재실행 (REAL Demo Org · 마켓 접촉 0 · WRITE 0)

**resolve 확인 (`GET /api/products?q=…`)**

```
q=판도리 일체형 종이컵 수거함
→ 1건 · CHANNEL_PRODUCT_NAME_EXACT · id 800d396a… · name "15223228019"
       · matchedName "판도리 일체형 종이컵 수거함"
```

**Q4 — 「판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 …」 (2회, 결과 동일)**

| 항목 | 결과 |
|---|---|
| planner | LLM · `PRODUCT_OPS`+`REVIEW_OPS`+`INQUIRY_OPS` · needs 3 |
| **resolved entity** | **`800d396a-eecb-4b78-b227-18c36db080b5` — 2회 동일** (`product_ops resolved:true, ambiguous:false`) |
| tool 호출 | 5 / 5 |
| evidence | `REVIEW_ISSUE` ×3 (ORG) · `INBOX_COUNT` ×1 (ORG) |
| **rejected** | **4건 전부 — 사유가 `NO_RESOLVED_PRODUCT`에서 `ORG_EVIDENCE_FOR_PRODUCT_NEED`로 바뀌었다** |
| findings | 0 |
| unsupported claims | **0** |
| nextActions | 0 |
| WRITE | **0** — 모든 도구 READ |

**baseline 대비.** §3 Q4는 다른 상품의 HIGH 이슈 3건을 이 상품의 것으로 단정했다. §9.3은 상품을 찾지
못했다. 지금은 **상품을 찾고, 그 상품으로는 말할 수 있는 것이 없다는 것을 안다.**

**상품 단위 진실 대조** (`/api/products/{id}/knowledge`): 리뷰 7 · 문의 1(미답변 0) · **이슈 0** ·
issue evidence 0 · 리스팅 `COUPANG "판도리 일체형 종이컵 수거함"` · 모든 신호 coverage `COVERED`.
**즉 "불만 신호 없음"이 정답이고, run은 아무것도 주장하지 않았다.**

**동점 거부 (라이브 확인, 1회)** — 「스노우 누리젠 상품의 리뷰와 문의를 …」
→ `PRODUCT_OPS` 진입, 4개 동점, **선택 없음**, note에 SKU/채널 요청. findings 0 · WRITE 0.
(같은 run의 2회차 re-plan은 mention을 「스노우 누리젠 상품」으로 바꿔 내보내 "찾지 못했습니다"로 끝났다 —
bounded re-plan의 정상 동작이며 두 문장 모두 각자의 pass에 대해 참이다.)

### 13.7 이번 회차에서 새로 관측된 것 (수정하지 않음)

- **C3(신규) — 상품을 읽고 "신호 없음"을 확인했는데 그 문장이 셀러에게 도달하지 않는다.** `PRODUCT_OPS`는
  need를 `UNSATISFIABLE / "이 상품에 기록된 신호가 없습니다."`로 적지만, 뒤이어 도는 `REVIEW_OPS`가
  같은 need를 `UNSATISFIABLE / "…전체 집계뿐이라…"`로 덮는다(need reducer는 UNSATISFIABLE→UNSATISFIABLE
  덮어쓰기를 허용한다). 결과적으로 답은 **"org 집계만 봤다"**고 말하지만 실제로는 **coverage `COVERED`로
  상품을 읽고 깨끗했다.** 사실보다 약한 진술이며, 이번 package 범위 밖이다.
- **B1은 그대로다** — `search_review_issues`에 상품 파라미터가 없어 REVIEW_OPS는 계속 org 전체를 읽고,
  A1 게이트가 계속 거절한다. C1이 닫혀도 이 경로는 변하지 않는다.
- §11.5 · §12.8의 backlog는 그대로 열려 있다.

### 13.8 판정

| 결함 | 상태 |
|---|---|
| **C1** — 사람이 읽는 상품명으로 canonical product가 해결되지 않음 | **CLOSED** — 라이브 2회 동일 resolve + 회귀 19건 |
| A1 · A2 · A3 · A4 · §10.4 temporal | CLOSED (§9~§12) |
| A5 · A6 · B · C2 · D | backlog 유지 |
| 신규 — C3 상품 read 결과가 뒤 specialist에 덮임 | backlog (§13.7) |
