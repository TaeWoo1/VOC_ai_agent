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
