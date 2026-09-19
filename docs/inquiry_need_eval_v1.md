# Inquiry Need Eval v1 — Knowledge Coverage → Retrieval → Sufficiency → Decision, need 단위로

2026-09-19 · 브랜치 `feat/review-decision-workspace-v1` · **production 코드 변경 0 · 모델 호출 0 · 마켓플레이스 0 ·
마이그레이션 0.** 이 문서는 평가 체계와 그 첫 측정의 기록이며 **F5 production 채택 결정을 내리지 않는다.**

## 0. 왜 만들었나

Case 하나에 「answerable」 라벨 하나를 붙이는 채점(F5 Demo Org 측정 §2-D, `knowledge_intelligence_closure_v1.md`)은 인용이
맞기만 하면 TP로 셌다. 그런데 고객 문의는 흔히 **서로 독립인 질문 여럿**이고, 근거가 그중 하나만 덮어도 assessor는 Case를
GROUNDED로 만든다. 예: 「마감캡 끝이 뚫렸나요 · 8.5mm 케이블은 몇 호 · 엘보는?」에 호수표 하나가 인용되면 GROUNDED다.
이것을 **partial-coverage leakage(PCL)**로 이름 붙여 따로 세려면 평가 단위가 need여야 한다.

## 1. 세 층

| 층 | 누가 | 바뀌는 때 | 파일 |
|---|---|---|---|
| **L1 gold** | 사람(고정 후 해시) | snapshot·arm과 무관 | `questions.jsonl` · `needs.jsonl` · `precedents.jsonl` (저장소 밖) |
| **L2 snapshot state** | `census.mjs` | snapshot마다 | `S*.json` — ref별 상태 + source census |
| **L3 runtime observation** | `InquiryNeedEvalIT` | snapshot × arm × run | `run.jsonl` — basis · 인용 · 과거 답변 · 카탈로그 statement · 규격 판정 · 주문 상태 |

**source 존재·수집 상태는 사람이 라벨로 달지 않는다.** F5 clone에 Catalogue Bootstrap이 없었던 것은 라벨이 아니라 snapshot의
성질이고, 같은 라벨을 다른 snapshot에 대고 다시 잰다. 저장소에는 schema(`contracts/inquiry-need-eval/v1/schema.json`) ·
도구(`tools/inquiry-need-eval/`) · synthetic fixture · 해시(`dataset.meta.json`)만 들어간다.

## 2. L1 — gold

- **need** = 답변에 없으면 고객 요청이 해결되지 않는 **독립 정보/행동 단위**. 서로 다른 source가 필요하다는 이유로 나누지
  않고, 그것을 풀기 위한 전제·배경 사실은 need가 아니라 **evidence**다(「이 주문 언제 발송」의 일반 발송 기준, 「재입고」의 현재
  판매 중지 상태). 고객이 실제로 여러 질문을 했으면 여러 need다.
- `type` 8종(PRODUCT_SPEC · PRODUCT_USAGE · PRODUCT_COMPATIBILITY · CATALOGUE_AVAILABILITY · POLICY · ORDER_STATE ·
  ORDER_ACTION · SELLER_DECISION), `scope` 4종(PRODUCT · ORG · ORDER · NONE).
- **gold = evidence_set들의 OR, set 안의 ref는 AND.** set마다 충분성 `FULL / CONDITIONAL(고객 정보가 있어야 닫힘) / PARTIAL /
  UNKNOWN(존재하지만 읽는 경로가 없음 — IMG·C24만)`. ref는 `KIND:id[#pattern]`(PK · OK · CAT · OPT · ADDON · FACT · ORDER · IMG ·
  C24)이고 id는 org 안에서 유일한 8자(census가 증명).
- **PRODUCT_FAMILY는 scope가 아니다** — production에 canonical family relation이 없으므로 형제 listing의 근거는 `family_sets` /
  `family_precedents`에 **annotation으로만** 남고 reachable=false다.
- **과거 답변은 evidence가 아니다**(근거가 되지 않는다) — `precedents`에만 있고 `precedent_scope`가 `REUSABLE`일 때만 다른 대화의
  미리 채움 정답이 된다. `ORDER_ONLY`(그 주문의 발송일·재발송·주소 변경)·`CASE_ONLY`(그 시점 재고, 그 대화에만 맞는 응대)는 episodic.
- **중복 대화**는 raw 행을 유지하고 `cluster`로 묶어 `canonical` 하나만 headline에 가중한다. 중복 수집·dedup 동작은 별도 robustness 대상.
- validator: 실제 질문 행에 문장 금지 · 금지 키 · PII 모양(주문/전화번호/이메일) · UNKNOWN ⇔ IMG/C24 · cluster당 canonical 1 ·
  precedent 존재.

## 3. L2 — snapshot

ref 상태: `PRESENT` · `PRESENT_OTHER_SCOPE`(있지만 lane fence 밖) · `ABSENT_ACQUIRABLE`(NAVER listing의 옵션·추가상품·상세 fact —
Catalogue Bootstrap이 쓰는 것) · `UNREADABLE` · `NO_SOURCE`. 상품 lane은 그 상품만, 운영 기준은 org 전체, 카탈로그 상품은 org 전체라는
production fence를 그대로 쓴다. census는 source 조사표(판매자 지식 작성 경로별 · 청크 · 운영 기준 · 과거 답변 · fact 출처별 ·
NAVER 상세 fact · 채널별 옵션)와 그 해시를 남긴다.

## 4. Truth (L1 + L2)

- **answerability** = 도달 가능한 set 중 가장 충분한 것(FULL > CONDITIONAL > PARTIAL); 없고 읽을 수 없는 set이 있으면
  **UNKNOWN**(NONE으로 접지 않는다); 그 밖 NONE.
- **next_step**: FULL → ANSWER · 수집 가능한 set이 지금보다 충분하면 → SYSTEM_ACQUIRE · CONDITIONAL → ASK_CUSTOMER · 그 밖
  ASK_SELLER. **terminal_resolution** = 수집 가능한 것을 모두 수집한 뒤: FULL → ANSWER · CONDITIONAL → ASK_CUSTOMER · 그 밖
  ASK_SELLER. **SYSTEM_ACQUIRE는 단계이지 결과가 아니다** — Seller Touch 감소로 세지 않는다.
- Case: 전부 FULL → FULL, FULL/CONDITIONAL뿐 → CONDITIONAL, 전부 NONE → NONE, NONE/UNKNOWN뿐 → UNKNOWN, 그 밖 PARTIAL.
  next_step은 SYSTEM_ACQUIRE > ASK_SELLER > ASK_CUSTOMER 우선, terminal은 ASK_SELLER > ASK_CUSTOMER.
- need의 knowledge gap(이 snapshot에서 닫지 못하는 이유): `NOT_ACQUIRED` · `PARTIAL_EVIDENCE` · `SOURCE_UNREADABLE` · `OUT_OF_SCOPE` ·
  `SOURCE_ABSENT`.

## 5. L3 — need scoring

- **retrieval match**: 도달 가능한 set의 ref가 **전부** 관측돼야 그 set이 매칭(AND). PK/OK = 인용된 현재 근거(scope 포함) · CAT/FACT/
  ADDON/OPT = 카탈로그 statement나 규격 판정의 옵션명(census와 같은 SQL LIKE) · ORDER = `OBSERVED_*` 주문 상태 · IMG/C24 = 관측 불가.
  `MATCHED` / `MISSED` / `NOT_REACHABLE`.
- **observed sufficiency** = 매칭된 set 중 가장 충분한 것. **covered** ⇔ FULL 또는 CONDITIONAL.
- **precedent offered** = 과거 답변 lane이나 미리 채움에 REUSABLE·도달 가능 gold precedent가 나왔는가.
- **uncovered reason**: truth가 FULL/CONDITIONAL인데 covered가 아니면 `RETRIEVAL_MISS`, 아니면 knowledge gap.

## 6. Case outcome과 metric

**묻지 않은 Case**(basis GROUNDED → ANSWER, NEEDS_CLARIFICATION → ASK_CUSTOMER): 인용이 전혀 없으면 **WRONG**(보수적) · need가 전부
covered면 FULL 근거+ANSWER = `SAFE_ANSWER`, FULL+ASK_CUSTOMER = `OVER_CLARIFY`, CONDITIONAL 포함+ASK_CUSTOMER = `SAFE_CLARIFY`,
+ANSWER = `UNDER_CLARIFY` · 일부만 매칭 = **`PARTIAL_LEAK`** · 인용은 있으나 어떤 need도 매칭되지 않음 = `WRONG`.
**Seller에게 물은 Case**: truth next_step이 ANSWER/ASK_CUSTOMER면 `UNNECESSARY_ESCALATION`, SYSTEM_ACQUIRE이고 terminal이 Seller가
아니면 `ESCALATION_BEFORE_ACQUIRE`, 그 밖 `CORRECT_ESCALATION`; 미리 채움은 RIGHT / WRONG / MISSED.

| 영역 | metric | 정의 (canonical case·need) |
|---|---|---|
| Knowledge | source coverage | 도달 가능한 set이 있는 need ÷ need |
| | acquisition-adjusted coverage | + 수집 가능 ÷ need |
| | terminal distribution | need·case의 terminal_resolution |
| Retrieval | retrieval recall | MATCHED ÷ 도달 가능 need |
| | precedent recall | gold precedent가 나온 need ÷ REUSABLE·도달 가능 precedent가 있는 need |
| | unattributed evidence rate | 어떤 need의 gold에도 없는 인용 ÷ 인용 |
| Decision | strict safe no-ask precision | (SAFE_ANSWER + SAFE_CLARIFY) ÷ 묻지 않은 case |
| | safe automation coverage | SAFE ÷ truth next_step이 ANSWER/ASK_CUSTOMER인 case |
| | PARTIAL_LEAK rate / WRONG automation rate | ÷ 묻지 않은 case |
| | unnecessary Seller escalation · over-clarification | case 수 |
| Product | immediate next_step · 관측 action | 분포 |
| | terminal Seller Touch requirement | terminal ASK_SELLER case ÷ case |
| | Seller ask 원인 | terminal ASK_SELLER need의 이유 |
| Stability | need/case change rate | 같은 snapshot 두 run 사이 retrieval·sufficiency·precedent / outcome·action이 바뀐 비율 |

## 7. Dataset v1 (고정)

`dataset_hash b94626cbf74a6f3dcbc97f9f1423f0329da25065634d9245f3077fbb51b04e23` · raw 질문 **68**(실제 26 + 합성 42; 개인정보가 든
실제 5건은 판정 전 제외) · canonical case **67**(중복 스레드 1쌍) · need **74** / canonical **72** · 과거 답변 23(REUSABLE 14 ·
ORDER_ONLY 5 · CASE_ONLY 4). 작성자는 설계자이므로 **개발용 세트이고 holdout이 아니다**.

draft에서 고친 것: 전제 사실로 나뉘어 있던 need 합침(R `7a8136b2` 2→1, S T7a/T7b 2→1, R `b30d57be` 3→1, R `83e607e0` 2→1,
R `515dd536` 2→1, 소재 문의 3→2, S T6c·T10b·T11a·T12a·T13a·N4·X6b 각 2→1), R `4181864b` POLICY FULL → ORDER_STATE PARTIAL, 주문별
과거 답변 5건을 ORDER_ONLY로, 그리고 고정 직전 **명백한 annotation 오류 3건** — 요청의 어느 부분도 답하지 않는 배경을 evidence에서
제거(R `0c582144` 판매 단위 · R `9b8cc5a5` PAID 상태 · R `ae41a418` n2의 판매 중지 상태 — n1이 이미 답한다).

## 8. Synthetic fixture

`contracts/inquiry-need-eval/v1/synthetic/` — 7 질문(1 중복)이 SAFE_ANSWER · PARTIAL_LEAK(FULL + UNKNOWN) · ESCALATION_BEFORE_ACQUIRE ·
UNNECESSARY_ESCALATION(CONDITIONAL) · CORRECT_ESCALATION + ORDER_ONLY 미리 채움 = PREFILL_WRONG · AND set의 반쪽만 인용 = WRONG을 한 번씩
지난다. 손으로 계산한 기대값: canonical 6 · 묻지 않음 3 · strict precision 1/3 · PCL 1/3 · WRONG 1/3 · safe coverage 1/2 · 불필요한
escalation 1 · terminal Seller Touch 3/6; 재실행 파일과의 case change rate 4/6. `node --test tools/inquiry-need-eval/test/eval.test.mjs`
8개 — AND를 OR로, UNKNOWN을 NONE으로 바꾸는 변이에서 빨개지는 것을 확인했다.

## 9. 결과

snapshot: **S0** = F5가 돈 clone(`sellerops_f5_eval`, NAVER 상세 fact 0 · NAVER 옵션 20) · **S1** = Catalogue Bootstrap 증명 DB의 clone
(`sellerops_eval_s1`, 같은 판매자 지식·과거 답변 + 상세 fact 400 · NAVER 옵션 592). run: S0-A·S1-A는 이번에 **오프라인**으로 새
harness가 관측(모델 0, S0-A는 이전 arm A와 68행 동일), S0-B1·B2는 F5 실행(`apr-8610b0cc`)의 기존 결과를 변환(8자 id · 카탈로그
statement·주문 상태 미기록).

| metric | S0-A | S0-B1 (F5) | S0-B2 (F5) | S1-A |
|---|---|---|---|---|
| source coverage | 0.306 | 0.306 | 0.306 | **0.486** |
| acquisition-adjusted coverage | 0.486 | 0.486 | 0.486 | 0.486 |
| retrieval recall | 0.364 (8/22) | **0.591** | **0.636** | 0.257 (9/35) |
| precedent recall (30) | 0.300 | **0.667** | 0.600 | 0.300 |
| unattributed evidence rate | 0.200 | **0** | **0** | 0.200 |
| 묻지 않은 case | 10 | 13 | 14 | 11 |
| strict safe no-ask precision | **0.400** | 0.385 | 0.357 | 0.364 |
| safe automation coverage | 0.500 (4/8) | 0.625 | 0.625 | 0.444 (4/9) |
| **PARTIAL_LEAK rate** | 0.300 (3) | **0.538 (7)** | **0.571 (8)** | 0.364 (4) |
| WRONG automation rate | 0.200 (2) | **0** | **0** | 0.182 (2) |
| over-clarification / unnecessary escalation | 1 / 3 | 1 / 2 | 1 / 2 | 1 / 4 |
| 미리 채움 맞음 / 틀림 / 놓침 | 4 / 1 / 19 | 14 / 3 / 5 | 12 / 2 / 7 | 4 / 1 / 19 |
| 관측 Seller Touch | 0.851 | 0.806 | 0.791 | 0.836 |
| **terminal Seller Touch requirement** | **0.866** | 0.866 | 0.866 | 0.866 |

**Stability**: B1↔B2 need change 0.042 · case change 0.015(S T6c 하나가 PARTIAL_LEAK로). A→B1 case change 0.104 · A→B2 0.119.

### 9-1. F5 — retrieval 개선과 coverage 판단 실패를 분리하면

- **retrieval은 좋아졌다**: 도달 가능 need의 매칭 8 → 13/14(잃은 것 0), 과거 답변 recall 0.30 → 0.67/0.60(얻음 14/12 · 잃음 3 — T8b ·
  T9b · T10a), 무관한 인용 0.20 → 0(A의 WRONG 2건 — 분실 문의·해외 배송 문의가 배송 정책을 인용하던 것 — 이 사라짐).
- **그러나 새로 찾은 근거의 대부분이 PARTIAL_LEAK로 흘렀다**: 새로 매칭된 need 5/6 중 안전한 자동화로 끝난 것은 X9a(되묻기) 1건이고
  나머지 R `ffc2cc44` · `77a91fab` · `7a8136b2` · S T13a · (B2) T6c는 **일부 need만 덮은 채 묻지 않았다**. retrieval의 실패가 아니라
  **assessor가 「현재 근거가 하나라도 있으면 basis」로 판정하고 need별 충분성을 보지 않는** decision 층의 실패다.
- 그래서 strict safe precision은 0.40 → 0.38/0.36으로 제자리이고 PCL rate는 0.30 → 0.54/0.57이다. 기존 채점의 「FP 2 → 0」은 여전히
  참이다 — 새 채점이 그 옆에 그것이 가린 leakage를 세운다.

### 9-2. S0 → S1 (Catalogue Bootstrap)

- source coverage 0.306 → **0.486**(S0의 acquisition-adjusted와 정확히 같다 — S1이 곧 「수집 가능한 것을 다 수집한」 상태).
- need answerability: **NONE → PARTIAL 11 · NONE → FULL 2**(R `ae41a418` n1 화이트 1호 판매 중지 · S N7 우드 옵션). S0의
  SYSTEM_ACQUIRE need 13개가 모두 해소되지만 **ANSWER로 닫히는 것은 2개, 11개는 여전히 ASK_SELLER**(부분 근거).
- terminal Seller Touch는 **0.866 그대로** — terminal은 정의상 수집을 이미 가정하므로, catalogue가 줄일 수 있는 Seller Touch는 S0의
  immediate 기준 대비 **최대 1 case(S N7)**다.
- **그리고 오늘의 runtime은 그것을 쓰지 못한다**: S1에서 도달 가능한데 매칭되지 않은 need 26 중 옵션 7 · 추가상품 5 · 카탈로그 상품 3이
  catalogue evidence다 — 옵션·추가상품은 카탈로그 질문일 때만 카탈로그 조사가 읽는다. 그래서 N7은 S1에서 `UNNECESSARY_ESCALATION`이
  되고, 반대로 R `8989a9d0`(커플 색 섞기)은 카탈로그 옵션만으로 GROUNDED가 되어 **새 PARTIAL_LEAK**가 생겼다.

### 9-3. Failure taxonomy (canonical, need 수 / case 수)

| 병목 | S0-A | S0-B1 | S0-B2 | S1-A |
|---|---|---|---|---|
| SOURCE_ABSENT | 18 / 18 | 18 / 18 | 18 / 18 | 18 / 18 |
| PARTIAL_EVIDENCE | 12 / 12 | 12 / 12 | 12 / 12 | 23 / 23 |
| SOURCE_UNREADABLE | 14 / 14 | 14 / 14 | 14 / 14 | 14 / 14 |
| NOT_ACQUIRED | 13 / 13 | 13 / 13 | 13 / 13 | 0 |
| OUT_OF_SCOPE | 5 / 5 | 5 / 5 | 5 / 5 | 5 / 5 |
| RETRIEVAL_MISS | 4 / 4 | 2 / 2 | 2 / 2 | 6 / 6 |
| SUFFICIENCY/JUDGMENT_FAILURE (case) | 6 | 8 | 9 | 7 |
| OVER_ESCALATION (case) | 3 | 2 | 2 | 4 |

**Seller Touch 상한 (S1 truth 위의 counterfactual, 67 case 중 terminal ASK_SELLER)**: 지금 58 · family relation 58 → 56 ·
이미지·Cafe24가 읽히고 전부 답한다면(상한) → 45 · 부분 근거를 판매자가 완성한다면(상한) → 36 · 셋 다(상한) → 19. 남는 19는
주문 조치·예외·정책 부재 — 정의상 판매자의 일이다.

## 10. 한계

- 개발용 세트(작성자 = 설계자), 68개, 한 org. 합성 42개는 과거 답변을 보고 쓴 paraphrase다.
- B1·B2는 옛 harness 결과라 카탈로그 statement·주문 상태·옵션명이 없다 — S0에서는 카탈로그 fact가 0이라 판정 차이는 작지만, ORDER가
  든 AND set은 B에서 관측될 수 없다(R `7a8136b2`는 OR의 정책 set으로만 매칭).
- UNKNOWN의 실제 충분성은 모른다 — §9-3의 이미지 상한은 「읽으면 다 답한다」를 가정한 최대값이다.
- 카탈로그·옵션 관측은 assessor가 내놓는 statement와 규격 판정의 옵션명뿐이다 — 초안 모델이 실제로 그 사실을 문장에 썼는지는 이 평가의
  범위 밖(L3는 판정까지다).
- PCL은 「일부 need가 매칭됐고 전부는 아니다」로 판정한다 — 매칭된 need의 문장이 초안에 맞게 쓰였는지는 재지 않는다.
- F5를 S1에서 돌린 결과는 없다(모델 실행이 필요하다).

## 11. 다음 개선 후보 (결정 아님)

1. **need-level sufficiency gate** — 안전. assessor가 「현재 근거 1개 이상 = basis」가 아니라 질문의 need별로 충분성을 보고, 일부만
   덮이면 묻지 않음을 막는다(또는 「덮인 부분은 답하고 나머지는 묻는」 제품 상태 — product-owner 결정). F5 PCL 7–8 case, S1 4 case,
   A 3 case가 여기 걸린다. **F5를 어디든 켜기 전의 전제**다.
2. **카탈로그 fact를 evidence lane으로** — 같은 gate 아래에서. S1에서 도달 가능하지만 소비되지 않는 catalogue evidence need 15개,
   NONE → PARTIAL/FULL 13개, 그리고 카탈로그 조사가 만든 새 leak(R `8989a9d0`). Seller Touch 직접 감소는 작다(최대 1 case) — 가치는
   미리 채움·부분 답의 질과 안전에 있다.
3. **부분 근거를 완성하는 Teach 흐름** — 가장 큰 Seller Touch 상한(58 → 36). PARTIAL_EVIDENCE need 23개는 판매자가 이미 반쯤 써 둔
   지식이다(호수표에 높이 칸이 없다 · 발송 기준에 주문 상태가 없다). 미리 채움(REUSABLE precedent 22 need)과 need 단위의 「빠진
   칸」을 묻는 ask가 필요하다. 이미지 lane(상한 −13)과 family relation(−2)은 product-owner 결정으로 남긴다.

## 11-A. 후속 — Inquiry Decision v2

1번 후보(need-level sufficiency gate)는 **`docs/inquiry_decision_v2.md`**로 구현됐다(기본 OFF). oracle 상한에서 S0·S1 모두 PARTIAL_LEAK 0 ·
WRONG 0 · strict safe precision 1.0 · 불필요한 escalation 0. scorer는 그 과정에서 결함 하나를 고쳤다 — 카탈로그 statement나 관측된 주문
사실만 인용한 답을 「인용 없음」(WRONG)으로 세고 있었다(옛 run의 수치는 바뀌지 않는다: 그때는 statement가 있으면 grounds도 참이었다).

## 12. 재현

`tools/inquiry-need-eval/README.md`. 해시: `contracts/inquiry-need-eval/v1/dataset.meta.json`(dataset · snapshot state · observation run).
