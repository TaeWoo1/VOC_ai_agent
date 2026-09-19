# Inquiry Decision v2.2 — Evidence Integrity & Aggregation Calibration

2026-09-20 · 브랜치 `feat/review-decision-workspace-v1` · **모델 호출 0** · 마켓플레이스 0 · WRITE 0 · 마이그레이션 0 · capability 기본 OFF 그대로.

## 0. 지위 — 사후 가설이다

v2.1의 A/B 실험(`apr-8ef649ab`, `docs/inquiry_decision_v2_1.md` §15)은 **사전 등록한 규칙 그대로 보존**한다: winner 없음(unsafe FULL
4 대 4). v2.2는 그 결과를 **보고 나서** 만든 후속 변경이고, 아래 수치는 이미 기록된 raw verdict에 새 code를 다시 적용한
**projected / offline** 값이다. A/B의 승패에 소급하지 않으며, v2.2가 유효하다는 주장은 새 실험(§6)으로만 할 수 있다.

바꾼 것은 **aggregation과 provenance invariant뿐**이다. CoverageJudge v2 프롬프트 · 모델(`gpt-5-2025-08-07`) · schema · planner ·
retrieval은 그대로다 — A/B 직후 프롬프트와 집계를 같이 바꾸면 이득의 출처를 가를 수 없다.

## 1. 가정(assumption) 규칙 — 측정된 비용으로 좁혔다

| | v2.1 | v2.2 |
|---|---|---|
| FULL + 근거 밖 가정 | PARTIAL | PARTIAL |
| FULL + 빠진 필수 정보 | PARTIAL | PARTIAL |
| FULL + 고객 입력 필요 | CONDITIONAL_ON_CUSTOMER | CONDITIONAL_ON_CUSTOMER |
| **CONDITIONAL + 가정** | **PARTIAL** | **그대로 CONDITIONAL** |

측정(A/B의 B, 원본 72 need): CONDITIONAL 강등 규칙이 잡은 unsafe 판정 **0**, 잃은 옳은 CONDITIONAL **1**(S T9a, 두 run 모두) —
useful coverage 0.60 → 0.50. 고객에 대해 모르는 것을 적는 judge는 제 일을 하고 있는 것이다. 이 변경만 적용한 B: useful coverage
**0.60**, safety 지표 변화 0(아래 §3 표의 차이 중 이 규칙 몫).

## 2. Evidence-scope invariant — 일반 규칙 하나

원칙: **특정 entity instance에 대한 판정은 그 instance에 귀속된 근거로만 선다.**

- `EvidenceScope(kind, id)`: 후보마다 **출처가 정한** 귀속 — listing의 사실·옵션·추가상품·상품 노트 → `PRODUCT(listing id)`, 회사 규칙
  → `ORG`, 저장된 주문 사실 → `ORDER(이 문의의 주문 key)`. collector가 주문 사실을 **이 문의의 주문 binding으로 읽었을 때만** 그 주문에
  귀속한다. 텍스트는 읽지 않는다.
- `NeedType.instanceScope()`: spec·usage·compatibility → `PRODUCT` · order state·order action → `ORDER` · availability·policy·seller
  decision → instance 없음.
- `CaseScope(productId, orderKey)`: Case가 무엇에 대한 것인지(assessor가 채운다; 주문 key = 채널 + 채널 주문 참조).
- **판정(NeedAggregation)**:
  1. need가 가리키는 종류의 **다른 instance**에 귀속된 인용은 버린다 — v2.1의 other-listing 방어를 일반화한 것(다른 listing, **다른 주문**).
     남는 인용이 없으면 NONE(`OTHER_INSTANCE_ONLY`).
  2. **ORDER need의 FULL은 이 주문에 귀속된 인용이 하나 이상 있어야 한다** — 없으면 PARTIAL(`SCOPE_UNATTRIBUTED`). 회사 규칙은 「보통 이렇다」를
     말할 뿐 「이 주문이 이렇다」를 말하지 못한다. 귀속되지 않은 주문 사실, 주문이 없는 Case도 같다.
  3. listing need에는 2를 요구하지 않는다 — 회사 전체에 대한 진술(「모든 상품은 …」)이 listing 질문에 답할 수 있다. listing은 1(다른 listing
     거부)만 받는다. 검증된 PRODUCT_FAMILY 관계가 없으므로 형제 listing 근거로 FULL은 계속 불가.
- 상품·배송·규격별 의미 규칙 **0**. gold 점검: order 범위 need 11개 중 gold가 주문 사실 없이 FULL/CONDITIONAL로 둔 것은 **0**
  (규칙이 human gold와 충돌하지 않는다).
- **mutation**: 귀속 요구를 끄면 2 테스트, 다른 instance 거부를 끄면 3 테스트가 실패한다.

## 3. B raw vs v2.2 code-applied (projected, 모델 0)

기록된 raw verdict를 현재 code로 다시 집행(`CAL_MODE=replay`). 재생한 요청의 user turn이 기록된 `input_fp`와 **전부 일치**해야만 돌며,
raw 판정은 한 칸도 바뀌지 않았고, 집행 결과의 차이는 전부 §1·§2 두 규칙으로 설명된다(A: 1행 · B: 6행). 사례 수준은 **judge 컴포넌트의
case projection**(gold need가 plan, judge의 pool 위 gold가 truth) — Eval v1 pipeline 수치와 비교하지 않는다.

| 원본 67 case / 72 need (run 1) | A raw | A v2.1 | A v2.2* | B raw | B v2.1 | **B v2.2*** |
|---|---|---|---|---|---|---|
| unsafe FULL (need) | 4 | 4 | 4 | 4 | 4 | **3** |
| FULL precision | 0.429 | 0.429 | 0.429 | 0.429 | 0.429 | **0.500** |
| gold CONDITIONAL → FULL | 3 | 3 | 3 | 1 | 1 | 1 |
| unsafe coverage (of 62) | 0.065 | 0.065 | 0.065 | 0.048 | 0.048 | **0.032** |
| useful coverage | 0.50 | 0.50 | 0.50 | 0.60 | 0.50 | **0.60** |
| CONDITIONAL precision / recall | 0.40 / 0.40 | 0.40 / 0.40 | 0.40 / 0.40 | 1.00 / 0.60 | 1.00 / 0.40 | 1.00 / 0.60 |
| **unsafe automation (case)** | 7 | 7 | 7 | 4 | 4 | **3** |
| strict safe precision | 0.364 | 0.364 | 0.364 | 0.556 | 0.500 | **0.625** |
| safe automation coverage | 0.50 | 0.50 | 0.50 | 0.625 | 0.50 | 0.625 |
| PARTIAL_LEAK / WRONG / UNDER_CLARIFY | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 2 / 1 | 1 / 2 / 1 | **1 / 1 / 1** |
| unnecessary escalation | 1 | 1 | 1 | 2 | 3 | 2 |

\* projected — 같은 raw verdict, v2.2 code. **R `4181864b`(ORDER_STATE, 회사 배송 정책만 인용해 FULL)는 `SCOPE_UNATTRIBUTED`로 PARTIAL이
되어 WRONG에서 CORRECT_ESCALATION으로 바뀐다.** A에서 같은 문의는 CONDITIONAL이었으므로(FULL 아님) 규칙이 닿지 않는다 — v2.2는 FULL만
붙잡는다. A의 S T13a(ORDER_STATE를 정책으로 CONDITIONAL)도 같은 이유로 남는다; 주문 need의 CONDITIONAL까지 붙잡을지는 열린 질문이다.

## 4. 남은 B의 unsafe FULL 3건

| case | gold → B | judge가 FULL이라 한 이유 | provenance로 잡히나 | 영역 |
|---|---|---|---|---|
| R `ae51c7f8` | CONDITIONAL → FULL (UNDER_CLARIFY) | 판매자 FAQ가 질문(「몇 가닥」)에 **문장 그대로** 답한다 — 상품 단위 수치, listing은 5개 규격 | 아니다: 근거는 이 listing 것이다. 「이 수치가 규격마다 다른가」는 텍스트의 의미 | **semantic** — 2026-08-26 사건의 모양. 초안에는 규격 경고 줄이 여전히 들어가 고객 문장에서는 되묻는다(v2 §6) |
| S T6c | PARTIAL → FULL (WRONG) | 치수표가 5개 규격의 폭과 **1·2호의** 높이만 준다 — 부분 표를 전체에 적용 | 아니다: 같은 문서 안의 빈칸 | **semantic** — 프롬프트가 금지한 「목록 일부에서 전체」 그대로 |
| R `dae8554d` n2 | NONE → FULL (PARTIAL_LEAK) | 근거가 「한 가닥이면 3호 권장」(수용량)을 말한다 — 고객이 물은 것은 T자 분기에서 **규격을 맞춰야 하는가**(연결) | 아니다 | **semantic** — 관련 있지만 다른 질문. gold(NONE)도 판단이 갈릴 수 있는 경계라 재판정 대상으로 적는다(고정 라벨은 바꾸지 않았다) |

셋 다 **이 listing의 근거를 인용했고 가정·누락을 비워 둔** 확신 있는 판정이다 — code invariant가 닿을 자리가 없다. 여기부터는 judge의
의미 판단을 직접 재야 한다.

## 5. 테스트

`EvidenceScopeInvariantTest`(주문 need + 정책만 → PARTIAL · + 이 주문 사실 → FULL · 다른 주문 → 버림 · 귀속 없음/주문 없는 Case → PARTIAL ·
FULL만 대상 · listing은 v2.1 그대로 · 출처로 scope 기록) · `CoverageJudgeV2Test`(옳은 CONDITIONAL + 가정 유지 — **v2.1 계약에서 뒤집힌 단언
1개**, 이유를 테스트에 적었다) · 기존 PARTIAL/NONE 안전 · 규격 경고 줄·Claim Guard(`InquiryDecisionV2Test` 등) 그대로. backend 전체
**4,460 · 실패 0**, node 21(case projection 손계산 fixture 2개 추가).

## 6. 다음 실제 모델 실험 — C가 아니라 targeted calibration

남은 실패는 reasoning 예산이 아니라 **의미 판단의 세 가지 모양**이다. C(v2@low)는 자동으로 부르지 않는다. 대신 가장 작은 표적 세트
(`contracts/…/synthetic/judge-targeted-*.jsonl`, 합성 12)로 judge v2가 그 모양에서 **체계적으로** 틀리는지를 잰다:

| 모양 | hard-negative | near | positive control |
|---|---|---|---|
| P 부분 표 → 전체 | P1(한 규격의 높이 없음, 둘 다 물음) · P4(물은 바로 그 값 없음) | P3(물은 값은 표에 전부) | P2(완전한 표) |
| V 규격 의존 | V1(상품 단위 FAQ + 규격별 표, 고객 규격 없음 → CONDITIONAL) · V3(규격 셋 + 규격 없는 한 문장 → PARTIAL) | — | V2(고객이 규격 밝힘) · V4(단일 규격이라고 근거가 말함) |
| R 관련 있지만 다른 질문 | R1(수용량 규칙만, 연결을 물음 → NONE) · R4(실내 안내뿐, 습기를 물음 → PARTIAL) | R3(근거가 부정으로 답함) | R2(연결 방법이 적혀 있음) |

더해서 실제 3건(`ae51c7f8` · T6c · `dae8554d`)을 얼린 입력 그대로 재질문한다. 각 3회 반복으로 **판정이 흔들리는지 / 늘 같게 틀리는지**를
가른다. 결과로 정할 것: 모양별로 체계적이면 judge 계약(프롬프트 v3)의 **별도** 패키지, 흔들리면 반복 판정/합의, positive control이 무너지면
과잉 교정. offline 자기검사 통과(합성 12 · gold FULL 6 · CONDITIONAL 1 · PARTIAL 4 · NONE 1).
