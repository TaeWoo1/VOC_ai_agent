# Inquiry Decision v2 — 「관련 근거가 있다」와 「고객 요청 전체를 답할 수 있다」를 가른다

2026-09-19 · 브랜치 `feat/review-decision-workspace-v1` · **기본값 OFF**(자기 flag·key·org 목록) · 마켓플레이스 0 · WRITE 0 ·
마이그레이션 0 · 이 문서의 모든 수치는 **모델 호출 0**으로 얻었다(실제 모델 arm은 §10의 승인이 필요하다).

## 0. 무엇을 고쳤나

Inquiry Need Eval v1(`docs/inquiry_need_eval_v1.md` §9)이 보여 준 것: assessor의 basis는 「현재 근거가 하나라도 있는가」였고,
그래서 고객 문의의 **일부 need만** 근거가 있어도 Case 전체가 GROUNDED/NEEDS_CLARIFICATION이 됐다(partial-coverage leakage).
F5는 retrieval을 개선했지만 새로 찾은 근거 대부분이 그대로 leakage로 흘렀다(PCL 3 → 7/8). 원인은 retrieval이 아니라 **판정의 단위**다.

## 1. Architecture — before / after

**before**: 문의 1건 → 전체 질문 retrieval(lexical, F5 on이면 semantic) → `AnswerBasisState.of(lanes.state, 규격 판정)` — 「현재
passage가 있으면 grounded」, 규격이 미확정이면 되묻기.

**after (capability on인 org)**:
1. **NeedPlanner — 모델 1회**: 고객 문의를 「답변에 없으면 요청이 해결되지 않는 독립 정보/행동 단위」로 나눈다. 전제·배경 사실은
   need가 아니다. 닫힌 type 8종(Eval v1과 같은 낱말).
2. **Evidence collection — 모델 0**(F5 on이면 lane의 기존 임베딩만): 전체 질문 lane + **need마다 같은 lane**(planner의 검색 문구) +
   작은 라이브러리 통째(≤12 passage) + **저장된 카탈로그**(이 listing의 fact · 옵션과 판매 상태 · 추가상품) + 카탈로그 조사가 찾은
   다른 listing statement + 관측된 주문 사실. 과거 답변은 **precedent 목록**으로 따로.
3. **CoverageJudge — 모델 1회**: 모든 need × 하나의 후보 목록 → need마다 `FULL / CONDITIONAL_ON_CUSTOMER / PARTIAL / NONE` +
   지지하는 evidence id + 부족한 것 + 고객에게 물을 것 + 재사용 가능한 precedent id.
4. **Code — 결정론**(`NeedAggregation`): invariant 적용과 basis 파생.

모델 호출은 **need 수와 무관하게 2회**다(need마다 부르지 않는다 — 같은 근거 목록 위에서 같이 판정되고, 비용이 질문 개수로 늘지 않는다).
결과(`NeedDecision`)는 `InquiryKnowledgeAssessor.Assessment`에 실려 조사와 초안이 **같은 판정**을 읽는다. legacy lane은 계속 돌고
초안 인용도 그것을 쓴다 — 바뀐 것은 **누가 basis를 정하는가**다.

## 2. Production semantics (code가 소유)

| need 결과 | Case basis | 제품 행동 |
|---|---|---|
| 전부 FULL | **GROUNDED** | 초안 — 덮인 need의 근거만, 「이번 답변이 다룰 내용」 목록과 함께 |
| FULL + CONDITIONAL_ON_CUSTOMER만 | **NEEDS_CLARIFICATION** | 초안 — 조건부 need는 고객에게 묻는다 |
| **하나라도 PARTIAL / NONE / UNKNOWN** | **NO_ANSWER_BASIS** | 초안 없음 · Seller path(부분 Teach) |
| planner/judge 무응답 · need 7개 이상 | NO_ANSWER_BASIS | 「기준 없음」이 아니라 운영 사유(`DECISION_UNAVAILABLE`) |

judge에 대해 code가 강제하는 invariant: 존재하지 않는 evidence id는 버린다 · **근거를 하나도 인용하지 않은 FULL/CONDITIONAL/PARTIAL은
NONE** · precedent id를 evidence로 인용하면 버린다(과거 답변은 근거가 되지 않는다) · judge가 답하지 않은 need는 NONE · precedent는
**덮이지 않은 need에만, 후보 목록 안에서만** · **UNKNOWN은 judge의 단어가 아니다** — listing need가 짧게 끝났는데 그 listing의 상세가
`IMAGE_ONLY`이거나 Cafe24(미수집)면 code가 UNKNOWN으로 바꾼다; NAVER listing인데 상세를 읽은 적 없으면 status는 그대로 두고
`acquirable`(SYSTEM_ACQUIRE 계획만, **자동 수집 0**). **부분 답변은 고객에게 나가지 않는다** — 이 제품에 「답할 수 있는 부분만 답하는」
상태는 없다.

## 3. NeedPlanner / CoverageJudge contract

- 파일: `inquiry/decision/` — `InquiryDecisionModel`(interface: `plan`, `judge`, 비용은 결과와 함께 반환) · `InquiryDecisionService`
  (**유일한 door**, org gate, 5분 in-memory memo — 키는 **요청 바이트 전체**) · `InquiryDecisionGenerator`(transport를 쥐는 유일한 클래스) ·
  `InquiryDecisionPrompt`(`inquiry-decision/v1`) · `InquiryDecisionEngine`(topology) · `NeedAggregation`(policy) ·
  `InquiryEvidenceCollector`(후보 수집, 모델 0).
- plan 출력 `{"needs":[{id, ask(≤120자, 개인정보 금지), type, search}]}` — **알 수 없는 type이 하나라도 있으면 plan 전체 실패**(need 하나를
  버리면 판정되지 않은 need가 생긴다). id는 위치로 다시 매긴다.
- judge 출력 `{"verdicts":[{need, status, evidence[E…], missing, ask_customer, precedents[P…]}]}`.
- **payload floor**: 고객 문의 · need · 후보 근거 텍스트와 제목 · 과거 답변 텍스트 — 전부 **위치 id**(N1/E1/P1). source·product·memory·org
  id 0(`InquiryDecisionPayloadFloorTest`가 직렬화 바이트로 단언). 두 프롬프트에 상품 도메인 낱말 0(같은 테스트). **새 노출 한 가지를 이름
  붙인다**: 이 capability는 **판매자의 과거 답변**을 벤더로 보낸다(retrieval capability들은 보내지 않는다) — 그래서 자기 flag·key·org 목록이고
  `admitsPolicyWidening=false`.
- 설정: `sellerops.inquiry-decision.*` / `SELLEROPS_INQUIRY_DECISION_{ENABLED,ORG_IDS,MODEL,API_KEY,…}`(기본 OFF). 구조 테스트
  `AgentDraftBoundaryTest`에 13번째 capability로 등록, `RetrievalRuntimeClosureTest`에 need별 lane을 도는 collector를 등록(같은 work unit ·
  customer-written 아님 · stored-only 주문).

## 4. 카탈로그가 실제 assessor에 들어가는 방식

`InquiryEvidenceCollector.addCatalogue`: 이 listing의 `product_facts`(상세페이지 bookkeeping 제외) → 「상품 등록 정보」 후보 하나,
`product_variants` → 「옵션 목록」(옵션명 + 판매 중/판매 중지/품절) 후보 하나, `attr:추가상품` → 「추가상품 목록」 후보 하나, 각 1,500자 상한.
카탈로그 조사 finding의 statement는 「다른 상품」 후보로. 전부 **저장된 행**이고 채널 호출 0 — Catalogue Bootstrap을 새로 돌리지 않는다.
상세페이지를 읽은 적 없는 NAVER listing은 `DetailCapability.NOT_ACQUIRED`로 남아 need에 `acquirable` 표시만 한다.

## 5. Seller-facing partial Teach

`KnowledgeGapView.needs` → `CaseKnowledgeGap.needs`(JSON 저장; 옛 행은 null) → Case 화면 `Gap.needs`(`NeedLine`: ask · 상태 · 덮였는가 ·
근거 라벨 · 부족한 것 · 고객에게 물을 것 · precedent 미리 채움 · 시스템이 읽을 예정). Teach 카드는 **「이미 확인된 내용」과 「알려 주셔야 하는
내용」**을 나눠 보이고, 입력 상자는 **덮이지 않은 need의 REUSABLE precedent만**으로 채워진다(여럿이면 need별 머리말). 주문·시점에 묶인
과거 답변을 걸러 내는 것은 judge의 판단(「그 주문을 발송했다·주소를 바꿨다·그때 재고가 없었다」는 넣지 않는다)이고, 표시 시점의 기존
fence(org · 다른 상품 · 이 문의 자신의 답 · 빈 본문)가 한 번 더 걸린다. need 목록이 있는 gap에서는 fence 없는 legacy 「과거 답변
불러오기」 버튼을 **숨긴다**. 저장은 기존 Teach → seller-confirmed Knowledge이고, 지식 제목은 **덮이지 않은 need 문장**이다 — 다음에 같은
need를 가진 문의가 그 이름으로 찾는다.

## 6. Claim/draft safety

- 초안 모델은 decision이 있으면 **덮인 need의 근거만** 보고(`NeedDecision.passages()`), 프롬프트 **v12**의 「이번 답변이 다룰 내용」 목록을
  받는다(목록 밖 내용을 새로 답하지 말 것 · 「고객에게 확인」 항목은 답을 정하지 말고 물을 것). 리뷰 프롬프트는 무변경.
- 모든 need가 FULL이면 규칙 기반 「규격 미확정」 줄을 보내지 않는다(judge가 이미 규격 의존성을 판정했다 — S X6a 과잉 되묻기의 원인).
- **Claim Guard는 그대로 뒤에 선다**: coverage gate를 통과한 GROUNDED 초안도 근거 없는 약속·요청·수치가 있으면 거절된다(통합 테스트).

## 7. 결과 — Eval v1 (dataset `b94626cb…`, canonical 67 case)

`V2O` = Decision v2 + 현재 retrieval, **oracle planner/judge**(gold need와 gold evidence set을 production collector가 실제로 모은 후보에
적용) — **완벽한 의미 판단 층을 가정한 구조의 상한**이며 실제 모델 정확도가 아니다. 수집기·집계·Case 경로는 전부 production 코드.

| | S0-A | S0-B1 (F5) | S0-B2 (F5) | **S0-V2O** | S1-A | **S1-V2O** |
|---|---|---|---|---|---|---|
| 묻지 않은 case | 10 | 13 | 14 | 8 | 11 | 9 |
| strict safe no-ask precision | 0.400 | 0.385 | 0.357 | **1.000** | 0.364 | **1.000** |
| safe automation coverage | 0.500 | 0.625 | 0.625 | **1.000** | 0.444 | **1.000** |
| PARTIAL_LEAK | 3 | 7 | 8 | **0** | 4 | **0** |
| WRONG | 2 | 0 | 0 | **0** | 2 | **0** |
| over-clarification / unnecessary escalation | 1 / 3 | 1 / 2 | 1 / 2 | **0 / 0** | 1 / 4 | **0 / 0** |
| retrieval recall | 0.364 | 0.591 | 0.636 | **0.909** | 0.257 | **0.943** |
| 미리 채움 맞음 / 틀림 / 놓침 | 4 / 1 / 19 | 14 / 3 / 5 | 12 / 2 / 7 | 13 / **0** / 10 | 4 / 1 / 19 | 13 / **0** / 10 |
| 관측 Seller Touch | 0.851 | 0.806 | 0.791 | 0.881 | 0.836 | 0.866 |

- 옛 PCL(R `dae8554d` · `b30d57be` · `4181864b` · S1의 `8989a9d0`)과 WRONG(분실 · 해외 배송)은 전부 올바른 Seller escalation으로,
  customer clarification을 Seller에게 보내던 T6b · T9a · X9a는 SAFE_CLARIFY로, X6a 과잉 되묻기는 SAFE_ANSWER로 옮겨 갔다.
- **관측 Seller Touch가 올라간 것은 누수를 막은 값이다**: S0-V2O의 59는 terminal 최소(58) + 수집 전 escalation 1(N7)이고, 불필요한
  escalation은 0이다. S1에서는 58 = terminal 최소 그대로다.
- retrieval recall 상승은 **need별 검색 · 작은 라이브러리 통째 · 카탈로그 후보** 덕이다. 과거 답변 recall은 F5(0.60–0.67)보다 낮고
  (0.47 — precedent는 덮이지 않은 need에만 제안하며 lexical memory lane으로 모았다) 틀린 미리 채움은 0이다.
- 단위/통합: 엔진 15 · payload 5 · 통합 6(JPA · 실제 retriever/collector/composer) — 옛 leak 집계로 되돌리면 8개가 빨개진다. backend
  4,429 · frontend 3,047 · 실패 0.

## 8. 비용·지연 추정 (측정 아님)

질문당 모델 호출 **2회**(plan + judge), need 수와 무관. Demo Org 기준 need 평균 1.09(최대 3), 후보 근거 평균 4.5(S0)–6.0(S1),
최대 13, precedent 평균 0.4. 토큰(추정): plan ≈ 입력 0.9k · 출력 0.15k, judge ≈ 입력 2–4k · 출력 0.2–0.4k. 지연(추정, 같은
모델·`minimal`의 기존 측정 — intent 1.8s · eligibility 1.1s · 초안 ~5s): plan 1.5–2.5s + judge 2–5s ≈ **질문당 +4–7s**(순차 — judge는
plan 결과가 필요하다). need별 retrieval은 모델이 없으면 수 ms이고, F5가 켜져 있으면 need마다 질문 임베딩 1회(~0.2s)가 늘어난다
(현재 순차). 조사와 초안이 같은 문의를 5분 안에 판정하면 memo로 두 번째는 0회. 벤더 단가는 외부 사실이라 식으로만: `(0.9k+3k)×입력단가 +
(0.15k+0.3k)×출력단가`. **판매자 일일 AI 예산 밖**(retrieval capability들과 같은 결정 — 청구 여부는 product-owner 결정).

## 9. 남은 한계

- **기본 OFF**: capability가 꺼진 org는 legacy basis(누수 포함) 그대로다. 구조적 제거는 켠 org에서만 성립한다.
- V2O는 oracle 상한이다 — **실제 planner/judge의 정확도는 미측정**(§10 manifest). 비결정성도 미측정.
- precedent의 REUSABLE 판단은 production에 저장된 scope가 없어 **judge가 매번 한다**.
- 초안의 **인용 기록**(`inquiry_draft_evidence`)은 legacy lane passage와 카탈로그 finding만 적는다 — decision이 인용한 옵션/추가상품
  후보는 초안에 보이지만 인용 행으로 남지 않는다.
- Teach는 덮이지 않은 need 전부를 **지식 하나**로 저장한다(need별 저장 아님). investigation 프롬프트는 need 목록을 읽지 않는다(첫 need의
  문장만 gap 주제로 쓴다).
- need별 retrieval은 순차다. SYSTEM_ACQUIRE는 계획만 남긴다(자동 수집 0). `deploy/pilot` compose는 새 env 이름을 아직 통과시키지 않는다.

## 10. 실제 모델 검증

필요한 것은 한 번의 승인이다 — S0/S1 × {Decision v2 + 현재 retrieval, Decision v2 + F5}. manifest는 이 패키지의 최종 보고에 있다.
