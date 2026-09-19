# Inquiry Decision v2.1 — Judge Calibration & Memory Scope Hardening

2026-09-19 · 브랜치 `feat/review-decision-workspace-v1` · **기본값 OFF 유지**(Decision v2 capability 그대로) · 마켓플레이스 0 · WRITE 0 ·
마이그레이션 1(V114, dev/prod DB에는 적용하지 않았다) · 이 문서의 수치는 전부 **모델 호출 0**으로 얻었다. 실제 모델 비교는 §8의 승인이 필요하다.

## 0. 이 패키지가 하는 일

Decision v2 실측(`docs/inquiry_decision_v2.md` §7-A, `apr-c8715d20`)은 **기준선으로 그대로 둔다**. 거기서 집계 코드가 샌 case는 0이었고,
남은 PARTIAL_LEAK·UNDER_CLARIFY는 전부 CoverageJudge가 gold보다 너그러웠던 것이었다(근거 밖 추론을 FULL로 · 규격에 따라 달라지는 답을
FULL로). 틀린 미리 채움 1–4건은 전부 주문·대화에 묶인 과거 답변이었다.

그래서 v2.1의 목적은 **retrieval 개선이 아니다**. 목적은 둘이다.

1. **human gold와 CoverageJudge의 sufficiency calibration** — judge를 독립 컴포넌트로 떼어, production이 실제로 보내는 입력 위에서 gold와
   비교할 수 있게 한다(§4–§5). 그 위에서 judge v2 계약(§2)을 v1과 같은 입력으로 비교한다.
2. **과거 답변의 재사용 범위를 판단이 아니라 저장된 사실로** — judge가 매번 「이 답이 일반적인가」를 추측하지 않게 한다(§3).

retrieval · F5 · NeedPlanner 프롬프트는 **바꾸지 않았다**. 원인 분리를 흐리지 않기 위해서다.

## 1. 데이터셋의 지위 — DEV / CALIBRATION

Eval v1의 67 canonical case(`b94626cb…`)는 **개발·calibration 세트**다. 라벨 작성자가 설계자이고, v2와 v2.1의 모든 선택이 그 라벨을 보며
내려졌다. 따라서:

- 이 세트의 어떤 수치도 **holdout 성능이나 production readiness로 인용하지 않는다**(`dataset.meta.json`의 `role`에 적었다).
- production 기본값 ON 결정은 **새 실제 문의 holdout**(파일럿 기간의 신규 문의, 라벨을 보기 전에 고정) 없이는 내리지 않는다.
- 이 세트의 gold 분포는 얇다: pool 기준(§4) S0 **FULL 5 · CONDITIONAL 5 · PARTIAL 10 · NONE 52**, S1 **FULL 7 · CONDITIONAL 5 · PARTIAL 21 ·
  NONE 39**(need 72). FULL precision·recall은 한 자릿수 사례 위의 숫자이고 그렇게 읽어야 한다.

## 2. CoverageJudge v2 계약

**선택 가능한 instruction** — `sellerops.inquiry-decision.judge-prompt: coverage-judge/v1 | coverage-judge/v2`(기본 v2; 모르는 이름이면
기동 거부 — arm 라벨이 실제 보낸 instruction을 뜻해야 한다), `judge-reasoning-effort`(공란 = plan과 같은 값). plan은 이 knob에 움직이지
않는다. `judge-max-output-tokens` 기본 1600 → 2400(구조화 필드가 늘었다).

**status** (need마다 하나; UNKNOWN은 여전히 judge의 단어가 아니다)

| status | 뜻 |
|---|---|
| FULL | 제공된 E만으로 이 need의 답을 **추가 가정 없이 확정적으로** 말할 수 있다. 근거가 답을 직접 말하거나, 답을 정하는 **모든 전제가 명시**되어 논리적으로 하나로 정해질 때만. |
| CONDITIONAL_ON_CUSTOMER | 근거는 충분하지만 **고객만 아는 값 하나**(규격·옵션·수량·사용 환경 등)가 정해져야 답이 정해진다. 그 값만 받으면 E로 답할 수 있어야 한다. |
| PARTIAL | 관련 근거는 있으나 답을 정하는 데 필요한 정보가 하나 이상 없다. |
| NONE | need를 실질적으로 뒷받침하는 근거가 없다. |

**금지** — 상식·업계 일반 지식·비슷한 상품 짐작으로 빈칸 채우기 · 목록 일부에서 전체 추론 · 규격/옵션/수량/주문 상태에 따라 달라지는데 그 값이
없는데 FULL · 다른 상품·다른 판매 페이지의 근거 사용 · 개별 주문 상태나 판매자 판단이 필요한 need에 FULL · P만 보고 FULL/CONDITIONAL ·
**확신이 없으면 FULL이 아니라 PARTIAL/NONE**. 상품 어휘는 여전히 0이다(`CoverageJudgeV2Test`·`InquiryDecisionPayloadFloorTest`가 단어로 고정).

**출력** — `status` · `evidence`(지지하는 E id) · `missing`(필요하지만 근거에 없는 정보, 구절 목록) · `customer_input`(고객에게 받아야 할
값, 구절 목록) · `assumptions`(근거에 없는 내용에 기댔다면 그 내용 — FULL이면 비어야 한다) · `ask_customer` · `precedents`.
v1 응답(`missing`이 문장 하나)도 그대로 읽힌다(`NeedVerdict.of`).

**code가 verdict를 그 자신의 말로 붙잡는다** (`NeedAggregation.enforce`, 단어를 읽지 않고 **목록이 비었는지만** 본다)

| judge가 말한 것 | code의 결과 | `NeedResult.Enforcement` |
|---|---|---|
| FULL/CONDITIONAL + `assumptions` 있음 | PARTIAL | `DECLARED_ASSUMPTION` |
| FULL + `missing` 있음 | PARTIAL | `DECLARED_MISSING` |
| FULL + `customer_input` 있음 | CONDITIONAL_ON_CUSTOMER(물을 문장 = 그 값) | `DECLARED_CUSTOMER_INPUT` |
| 지지 status인데 인용이 존재하는 후보 0 | NONE | `NO_CITED_EVIDENCE` |
| spec·usage·compatibility need의 인용이 **전부 다른 listing**의 카탈로그 사실 | NONE | `OTHER_LISTING_ONLY` |
| 판정 없음 | NONE | `NOT_JUDGED` |
| 읽을 수 없는 상세가 있는 listing need의 PARTIAL/NONE | UNKNOWN | `UNREADABLE_SOURCE` |

CONDITIONAL + `missing`은 강등하지 않는다 — judge가 고객 값을 missing에 적는 것은 모순이 아니다. 판매 여부(availability) need는 다른
listing이 존재한다는 사실로 답해질 수 있으므로 listing fence를 받지 않는다. `NeedResult`는 이제 `judged`(judge의 원래 단어)와
`enforcement`를 함께 든다 — 평가가 raw와 enforced를 따로 잰다.

## 3. 과거 답변 provenance

`AnswerMemoryReuseScope { REUSABLE, ORDER_ONLY, CASE_ONLY, UNKNOWN }` · **V114** `answer_memory.reuse_scope`(NOT NULL, 기본 `UNKNOWN`,
check 제약) · `reuse_scope_declared_by` · `reuse_scope_declared_at`(둘 다 있거나 둘 다 없다, check 제약).

- **backfill 0.** 기존 행은 전부 UNKNOWN이다. 본문에서 REUSABLE을 추론하는 것이 바로 이 칸이 대체하는 추측이다.
- **쓰기 경로**: `RememberCommand.reuseScope`(선언이 있으면 그 행위와 함께 기록, 없으면 새 행은 UNKNOWN · 기존 행은 **사람이 선언한 값을
  유지** — 같은 행위를 다시 기록해도 지워지지 않는다) · `PUT /api/answer-memory/{id}/reuse-scope`(판매자의 선언, org 범위, 다른 org는 404,
  네 단어 밖은 400; 새 memory도 본문 변경도 아니다 — `AnswerMemoryWriteFenceTest`의 writer 목록은 그대로). 승인·검증 hook은 아직 선언을
  싣지 않는다 ⇒ 새 memory도 UNKNOWN으로 들어온다(§10).
- **runtime 규칙** (`PrecedentReuse`, code가 소유): REUSABLE → 모든 Case · ORDER_ONLY → **같은 주문**의 Case만(같은 채널·같은 채널 주문
  참조; 비교는 두 문의의 `sourceOrderRef`를 거친다 — **memory에는 주문 참조가 여전히 없다**, fence 테스트 그대로) · CASE_ONLY·UNKNOWN →
  그 Case만. 두 지점에서 적용된다: **judge 앞**(`InquiryEvidenceCollector.admissible` — 허용되지 않는 과거 답변은 judge에게 보이지도 않는다)과
  **보여줄 때**(`CaseKnowledgeService.prefill` — Case는 retrieval보다 오래 산다; legacy Past Answer Prefill v1 경로도 이 fence를 지난다).
- 평가는 clone의 행이 전부 UNKNOWN이므로 Eval v1의 **사람 annotation 23건**을 scope source로 대신 쓴다(`setScopeSource`, 평가 전용).
- 실측(S1 throwaway 사본): 기존 26행 전부 UNKNOWN · 선언 0, 두 check 제약이 잘못된 값을 거부.

## 4. Judge calibration harness

**입력은 얼린다.** `InquiryNeedEvalIT`의 `EVAL_DECISION=capture` — plan = gold need, judge = gold, 그리고 **production collector가 모은
후보를 번호까지 production과 똑같이** 기록한다(F5 OFF, 모델 0, 마켓플레이스 0). 파일은 고객 문장과 판매자 문장을 담으므로 저장소 밖에
두고 해시만 커밋한다(`dataset.meta.json` `calibration.inputs`). 모든 arm이 **바이트가 같은 입력**을 받는다 — 다른 arm의 차이는 judge뿐이다.

**기준은 snapshot answerability가 아니라 「이 후보 목록 위의 gold」** (`GoldEvidence`) — collector가 주지 않은 문서로 judge를 탓하지 않는다.
각 need에 대해, 모든 ref가 이 목록에 있는 gold set 중 가장 높은 충분성(UNKNOWN set은 제외). Decision v2의 oracle arm(V2O)과 같은 함수이고,
리팩터 뒤 S0-V2O를 다시 돌려 **68행 모두 바이트 동일**함을 확인했다.

**Counterfactual / metamorphic** (`CalibrationVariants`, 결정론; 각 variant는 자기 후보 위에서 gold를 다시 계산한다)

| 종류 | 만드는 법 | 기대 | S0 | S1 |
|---|---|---|---|---|
| ORIGINAL | capture 그대로(반복 2회 — run-to-run) | gold와 비교(혼동 행렬) | 67 | 67 |
| DROP_REQUIRED | gold가 덮는 need의 승리 set 첫 ref 후보를, gold가 더는 덮지 않을 때까지 제거 | 대상 need가 FULL/CONDITIONAL이면 실패 | 10 | 12 |
| CUSTOMER_VARIABLE | FULL set이 부르는 옵션/추가상품 값이 고객 문장에 그대로 있으면 그 값을 지우고 주문 사실도 뺀다 | 대상 need가 FULL이면 실패 | **0** | **1** |
| UNRELATED_ADDED | 다른 listing의 passage 중 gold ref에 닿지 않고 질문과 bigram 겹침이 가장 적은 것 하나 추가 | 같은 arm의 원본 판정보다 오르면 실패(주입 id 인용도 센다) | 67 | 67 |
| PRECEDENT_ONLY | 현재 후보 전부 제거, 허용된 과거 답변만 남김 | 어떤 need든 FULL/CONDITIONAL이면 실패(raw) | 22 | 22 |
| OTHER_LISTING | listing-fact need에 **다른 listing의 카탈로그 사실만** | **enforced**가 덮이면 실패 — code 소관이라 최악의 judge(전부 FULL·전부 인용)로 offline 검사, 모델 호출 0 | 15 | 20 |

- 과거 답변은 production과 같은 정책으로 들어간다 — annotation의 REUSABLE만. capture에는 주문 binding이 없으므로 ORDER_ONLY는 여기서
  허용되지 않는다.
- **CUSTOMER_VARIABLE은 사실상 만들 수 없었다.** S0에는 카탈로그 사실이 없어 옵션 값을 부르는 FULL set이 충족되지 않고, S1에서도 조건을
  만족하는 need는 1개다. 고객 문장에서 「변수」를 지우는 일은 ref가 그 값을 이름으로 부를 때만 결정론적으로 할 수 있다 — 그 밖은 새
  annotation이 필요하고, 이 패키지는 고정 라벨을 바꾸지 않았다. 이 메타모픽 성질은 **사실상 미검증**이고 그렇게 보고한다.
- **offline 자기검사**: gold를 judge로 넣으면 S0·S1 모두 모든 지표 1.0 · 모든 counterfactual 위반 0 · OTHER_LISTING은 최악의 judge에서도
  위반 0(code fence 성립). harness가 자기 자신을 틀리게 채점하지 않는다는 것만 보여 준다 — judge의 품질은 아무것도 말하지 않는다.

## 5. 지표 (`tools/inquiry-need-eval/judge.mjs`, 원본 run 1 기준)

- **FULL precision**(최우선) = judge가 FULL이라 한 것 중 gold FULL · **unsafe FULL promotion rate** = gold가 FULL이 아닌 need 중 judge FULL ·
  **unsafe coverage rate** = gold가 덮지 않는 need를 덮었다고 한 비율(need 수준의 PARTIAL_LEAK/WRONG 모양) · gold CONDITIONAL을 FULL로
  (need 수준 UNDER_CLARIFY).
- 전부 PARTIAL로 보내는 judge를 이기게 두지 않으려고: **FULL recall** · **useful coverage**(gold가 덮는 need를 같은 충분성으로 덮은 비율) ·
  CONDITIONAL precision/recall · PARTIAL/NONE 혼동 · exact / 3-class agreement.
- **run-to-run**: run 2의 need별 판정이 run 1과 같은 비율(raw·enforced) · counterfactual 종류별 위반 · 과거 답변 제안의 정답/오답/recall ·
  enforcement 사유 분포 · 호출 p50/p95·토큰.
- 모든 지표를 **raw(judge)** 와 **enforced(code 뒤)** 로 따로 낸다 — v2의 이득이 prompt에서 왔는지 invariant에서 왔는지 가르기 위해서다.

## 6. 유지되는 안전 장치

PARTIAL·NONE·UNKNOWN이 하나라도 있으면 고객용 완료 금지(`NeedAggregation.basis` 무변경) · Claim Guard · 규격 미확정 경고 줄 항상 유지
(v2 §6) · 모델 실패 → NO_ANSWER_BASIS · product family 자동 공유 금지(이제 code fence도) · marketplace WRITE 0.

## 7. NeedPlanner

프롬프트 무변경. oversplitting은 보수적 방향이라 이번 병목이 아니다. 0-need(NO_NEEDS → NO_ANSWER_BASIS)와 전제 사실 need 회귀에 대한
기존 테스트를 그대로 둔다.

## 8. 실제 모델 비교 — 최소 protocol (승인 필요)

같은 모델 `gpt-5-2025-08-07`, planner·retrieval·aggregation 고정. **Arm A** = judge v1 @ minimal · **B** = judge v2 @ minimal ·
**C** = judge v2 @ low.

1. **Stage 1 — S0 judge 단독**(얼린 입력, DB·Spring·planner 없음): A·B·C 각 233 호출(원본 67×2 + DROP 10 + UNRELATED 67 + PRECEDENT_ONLY
   22) = 699.
2. **winner 규칙(실행 전에 고정)**: (a) raw unsafe FULL promotion이 A보다 적다 · (b) NOT_COVERED 계열 counterfactual 위반이 A 이하 ·
   (c) useful coverage가 A − 0.2 이상. 셋을 만족하는 arm 중 unsafe coverage가 가장 낮은 것, 같으면 싼 쪽(B). 아무도 만족하지 않으면
   Stage 2를 **하지 않는다**.
3. **Stage 2 — S0 전체 pipeline, winner judge 하나**, F5 OFF, 과거 답변 scope = annotation: 질문당 plan 1 + judge 1(최대 136). S0의 fresh
   throwaway 사본에서 돈다 — Flyway가 **그 사본에만** V114를 적용한다(S0 clone은 113 유지). 기준선은 S0-V2M(같은 조건의 v1 judge).

F5 on/off 재측정 · S1 pipeline · 5회 반복은 **하지 않는다**.

## 9. 성공 기준 (DEV — production readiness 아님)

WRONG 0 · PARTIAL_LEAK 0 목표 · UNDER_CLARIFY 0 목표 · need 수준 FULL precision 최우선 · useful FULL recall이 심하게 무너지지 않을 것 ·
불필요 Seller escalation이 legacy보다 나빠지지 않을 것. 충족돼도 **새 실제 문의 holdout 전에는 production 기본값 ON을 결정하지 않는다.**

## 10. 남은 한계 / production ON 전 조건

- **UI 없음**: 판매자가 과거 답변의 재사용 범위를 선언할 화면이 없다(API만). 그래서 production의 memory는 전부 UNKNOWN이고, provenance가
  켜진 지금 **어떤 과거 답변도 다른 Case를 미리 채우지 않는다**(Decision v2와 legacy Past Answer Prefill v1 모두). 안전한 쪽의 퇴행이고,
  승인 흐름에서 범위를 함께 받는 것은 다음 결정이다.
- 과거 답변은 draft 근거 lane(legacy)에는 여전히 들어간다 — v2.1의 규칙은 **미리 채움 후보**에 대한 것이다.
- 상품 지식 passage(PK)는 후보에 listing id가 없다 — 다른 listing fence는 카탈로그 사실에만 code로 걸리고, PK는 retrieval이 상품 범위로
  묶는 구조에 기댄다.
- CUSTOMER_VARIABLE 사실상 미검증(§4) · gold FULL 5–7개(§1) · calibration 입력은 F5 OFF pool뿐.
- production ON 전: (1) 새 실제 문의 holdout, (2) 재사용 범위를 받는 판매자 UI 또는 승인 흐름, (3) Stage 1–2가 §9를 만족, (4) judge 호출이
  질문당 지연·비용에 더하는 몫을 파일럿 조건에서 재측정.

## 11. 검증 (이 패키지, 모델 0)

backend 전체 **4,443 tests · 실패 0**(skip 52 = env-gated proof/eval) · agent-runtime **1,053 통과**(skip 23) · frontend(소스 무변경)
**3,047 통과** · typecheck 오류 0 · node eval 도구 **14 통과** · Flyway 무결성 proof: **빈 throwaway DB**에 112개 migration → v114, validate 통과 후 DB 삭제 · V114를 populated
throwaway 사본(S1)에 적용 33ms 후 사본 삭제. dev DB `sellerops`(105)·S0 clone(113)·S1 clone(113)은 무변경.

재현: `EVAL_DECISION=capture EVAL_CAPTURE=<out>`(InquiryNeedEvalIT) → `RUN_COVERAGE_JUDGE_CALIBRATION=true CAL_MODE=offline|model …`
(CoverageJudgeCalibrationIT) → `node tools/inquiry-need-eval/judge.mjs --obs <arm.jsonl> --needs … --precedents …`.
