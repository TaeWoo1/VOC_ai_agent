# Review Triage Contract v2 — severity와 closure를 분리한다

**Product-owner decisions, 2026-09-11.** 이 문서는 v1을 **대체하지 않는다.** v1은 그대로 남고,
아래 §0이 어느 절이 v1을 승계하고 어느 절이 v1을 개정하는지 줄 단위로 적는다. v1의 history는
한 글자도 덮어쓰지 않았다 — `docs/review_triage_contract_v1.md`가 여전히 §1~§5-G의 소유자이며,
v2는 그 위에서 **stage-2 판정 순서와 schema 필드 하나의 뜻**만 다시 정한다.

`contracts/review-eval/naver/v1/RUBRIC.md`·`v2/RUBRIC.md`와의 관계는 v1 §5-A 그대로다 —
**rubric과 충돌하면 rubric이 이기고 이 문서가 결함이다.**

실제 고객 문장은 이 문서에 넣지 않는다. 아래의 모든 대비 예시는 **합성**이며 평가 코퍼스에
존재하지 않는 물건을 이름으로 쓴다 (RUBRIC v2 §8.11).

---

## 0. v1과의 관계

| v1 절 | v2에서 |
|---|---|
| §1 actionability 3단계 · §2 reply 축 분리 · §2-A · §3 · §5 · §6 · §7 | **승계, 무변경** |
| §4 `NEEDS_ATTENTION`의 기준 · §4-A `WATCH`의 의미 | **승계** — 가르는 질문 둘 다 그대로 |
| §4-A 자기 선택/자기 귀책 · 판매자 안내로 해결된 마찰 | **승계**, 판정 순서에서 **맨 앞**으로 (§3) |
| §4-B `improvement_target` enum | **NOT_ADOPTED 유지** |
| §5-B · §5-C · §5-D · §5-E | **승계, 무변경** |
| §5-F Attention Dev Set v1.1 (n=105) | **승계** — §2가 그것을 포함하는 n=200으로 확장 |
| §5-G Candidate B v3 DEVELOPMENT-FROZEN | **보존** — v3는 기록으로 남고, v4가 그 자리를 잇는다 |
| v1 §4-A가 `explicit_failure_or_unusable`에 기대던 구분 | **§4가 개정한다** |

## 1. 왜 v2인가 — 하나의 측정이 요구했다

Attention Internal Validation v1(n=95, 라벨을 후보보다 먼저 고정)에서 Candidate B v3는
**확인 필요를 하나도 놓치지 않았고**(16/16) **참고를 하나도 올리지 않았다**(52/52). 오답 7건은
전부 `WATCH` 한 class였고, 그중 4건이 **같은 기계**였다.

「구체적 마찰은 이름을 가졌지만 실패한 사건은 적혀 있지 않은」 아홉 행에서, 예측을 가른 것은
`resolution_state` 하나였다 — `UNKNOWN`이면 WATCH(5/5 정답), `UNRESOLVED`면
NEEDS_ATTENTION(4/4 오답). 그리고 그 두 값은 실측에서 확인 필요와 지켜보기를 **전혀 가르지
못한다**(합쳐서 NA 16 · WATCH 11). 즉 **severity를 closure 칸이 지고 있었다.**

동시에 `explicit_failure_or_unusable`(「지금 쓸 수 없는가」)은 실제 기능 실패를 말한 행에서도
false로 읽혀, 정작 severity를 담을 칸이 비어 있었다.

**v2가 바꾸는 것은 이 둘의 분리 하나다.**

## 2. Attention Development Evidence v2 — n=200, 전부 development evidence

| | |
|---|---|
| 구성 | dev60 60 + boundary45 45 + internal-validation95 95 |
| fingerprint digest | `c485576bb5c0e3b1a7ac077b1921f031efff0379ae6f05aa8b3eb3bfa6e73d66` |
| canonical label digest | `fef3c03bb98ff2e3b9e7bdb8d8f190f3f7371c52bd394b0114e890b1618e4af1` |
| label 해석 | adjudicated label if present else original (§5-E 규칙 그대로) |

**95행은 internal validation이었고 그 validation은 실패했다.** 그 이력(라벨 digest ·
prediction digest · 실패 판정)은 세트 안에 보존된다 — **그 이력이 곧 재사용 금지의 근거**이므로
지우면 금지도 사라진다. 이 200행은 **어떤 revised candidate의 fresh validation으로도 쓰지 않는다.**

## 3. Stage-2 판정 순서 (v2)

`ReviewTriageTier`의 값과 의미는 v1 §1 그대로다. 바뀌는 것은 순서다.

1. 원인을 **자기 선택·개인 환경**으로 말하면서 판매자가 바꿀 자리를 함께 말하지 않으면 → `FYI`
2. **과거·타 제품**의 실패이고 **동일 상품 반복 구매**가 본문에 명시되지 않으면 → `FYI`
3. 본문이 비어 있고 1~2★ → `WATCH` (v1 tie-breaker, 무변경)
4. 판매자에게 직접 수정·대응을 **요구**하면 → `NEEDS_ATTENTION`
   (단순 개인 취향 표현은 요구가 아니다)
5. `concrete_failure_observed` + 미해결 → `NEEDS_ATTENTION`
6. `concrete_failure_observed` + 해결·우회됨 → `WATCH`
7. 실패 사건은 없으나 **구체적인 사용·설치·배송·품질 마찰이 명명**됨 → `WATCH`
8. 문제가 없어도 **판매자가 바꿀 구체적 지점을 명명한 SOFT improvement** → `WATCH`
9. 그 밖에 → `FYI`

**`problem_present == false`를 조기 FYI gate로 쓰지 않는다.** FYI는 8번 줄까지 읽은 뒤에만
도달한다 — 그렇지 않으면 「고장난 것은 아니지만 바꿀 자리는 있다」는 리뷰가 구조적으로 도달 불가가 된다.

## 4. schema v2 — rename 둘, 추가 0

```
attention-facts-schema/v1              attention-facts-schema/v2
  explicit_failure_or_unusable    →      concrete_failure_observed
  problem_present                 →      seller_actionable_friction_observed
```

**필드 rename 2건 · 새 필드 0 · 새 enum 값 0.** 나머지 일곱 필드는 이름·값·뜻 전부 v1 그대로다.
이름은 이 harness의 관례(`<명사>_<관측형>`, snake_case)를 따르고, 두 번째 이름이 긴 것은
의도적이다 — 이 축의 정의가 v1 §1의 「**seller** actionability detection」이므로 그 낱말이
필드 이름에 있어야 한다.

### 4-A. `concrete_failure_observed`

**true** — 기대된 기능·상태가 실제로 실패한 사건·결과가 본문에 관측됨. 완전 사용불가일 필요는
없고, 한 번이라도 일어났다고 쓰여 있으면 true다.
**false** — 정도나 한계를 **평가**할 뿐, 실패한 결과를 쓰지 않은 문장.

합성 대비 (이 저장소의 어떤 리뷰도 아니다):

| false | true |
|---|---|
| 「걸쇠가 다소 무른 편이라 아쉬운 정도입니다」 | 「걸쇠가 헐거워 뚜껑이 밤새 열린 채였습니다」 |
| 「손잡이가 헐거운 느낌입니다」 | 「손잡이가 두 번째 쓸 때 빠졌습니다」 |

**tier를 맞추려고 이 boolean을 사후 조정하지 않는다.** 얇은 경계에서는 다른 fact(요구 강도 ·
해결 상태)가 tier를 설명할 수 있으므로, gold tier를 보고 이 칸을 정하는 것은 금지한다.
**이 칸을 severity 개념으로 다시 넓히지 않는다** — 「고정력이 다소 무르다」류를 false로 읽은 것은
유지한다.

### 4-B. `seller_actionable_friction_observed`

v1의 `problem_present`는 「문제가 있는가」로 읽혔고, 그 이름 아래에서 서로 다른 네 모양 —
구매 안내 마찰 · 원인이 얇은 우회 · 완곡한 정도 평가 · soft improvement — 이 전부 false로
떨어졌다. 이 칸이 실제로 묻는 것은 **「판매자가 반복해서 개선할 수 있는 구체적인 마찰 · 안내
공백 · 개선 지점이 본문에 관측되는가」**이고, 판정 질문은 v1 §4-A 그대로 **「이 문장이 열 번
반복되면 판매자가 무엇을 바꿀 수 있는가」**다.

| true | false |
|---|---|
| 사용 과정의 구체적 불편 · 설치 조건의 구체적 마찰 | 단순 칭찬 · 개인 취향 |
| 규격·구성·수량 **안내 공백**(내용이 특정됨) | 무엇이 문제인지 특정되지 않은 막연한 불만 |
| 배송·포장 마찰 (이미 받았더라도) | 바꿀 지점 없는 자기 선택 |
| 실패는 아니나 **구체적 개선 지점**이 적힘 (아래 4-C) | **원인 없는 우회** — 우회 사실만 있고 이유가 없음 |
| 완곡해도 **어느 부위·어느 조건**인지 적힘 | 과거·타 제품 실패(반복 구매 미명시) · 부정문 |

**tier를 보고 이 값을 맞추지 않는다.**

### 4-C. 개선 지점은 **이름**이 아니라 **대상**이 식별되면 된다 — product-owner 결정

SOFT improvement가 `WATCH`가 되기 위해 **부품명·재질명·규격명까지 명시될 필요는 없다.**
판매자가 바꿀 수 있는 **구체적 속성 또는 행동**이 본문에서 식별되면 충분하다.

| `WATCH` 가능 | 자동 `WATCH` 아님 |
|---|---|
| 더 튼튼했으면 · 접착력이 더 강했으면 | 더 좋았으면 |
| 색상 종류가 더 많았으면 · 부속 종류가 더 있었으면 | 뭔가 개선됐으면 |

제품 전체의 속성(견고성)이어도 바꿀 대상이 식별된 것이다. 무엇을 바꿀지 특정할 수 없는 막연한
선호만 `NONE`이다. **새 field 0 · 새 enum 값 0** — 이것은 기존 두 칸의 판독 조건이다.

### 4-D. 제외가 우선한다 — product-owner 결정

§4-C가 「이름이 아니라 대상」으로 넓힌 뒤, 그 넓힘이 같은 field가 이미 들고 있던 두 제외를 넘어
버렸다. 어느 쪽이 이기는지를 여기서 정한다.

**한 문장이 제외 항목 하나에 해당하면, 그것이 §4-B의 true 항목 중 무엇처럼 보이더라도
`false`다.** true 목록은 본문이 바꿀 자리를 **이미 말하고 있을 때** 그것을 알아보라는 것이고,
적혀 있지 않은 바꿀 자리를 **찾아내거나 되짚으라는 것이 아니다.**

- 고객이 무엇을 **더 해서 썼는지**에서 어떤 속성이 문제였는지를 **역으로 추론하지 않는다.**
  무엇이 안 됐는지가 본문에 적혀 있으면 `true`, 우회 사실만 있으면 `false`.
- 원인을 **자기 선택**으로 말한 문장에서 판매자가 바꿀 자리를 **대신 찾아 주지 않는다.**
  안내가 없었다고 본문이 함께 말하면 `true`, 본인 선택으로 끝나면 `false`.

이 결정이 확정한 세 행: **D46 `FYI` 유지 · D15 `FYI` 유지 · B44 `UNCERTAIN` 유지**(§7-A가 미결로
올려 둔 그 행은 이 변경을 이유로 adjudicate하지 않는다). **새 field 0 · 새 enum 값 0 · 판정 순서
변경 0** — 이것은 `seller_actionable_friction_observed`의 판독 우선순위 한 문장이다.

### 남는 가장 얇은 경계

「실패 사건」과 「정도 평가」가 어휘로 갈라지지 않는 문장이 존재한다. 200행에서 실제로 둘을 가른
것은 **실패한 조건의 명명 여부**였다 — 어느 조건에서 그렇게 됐는지를 대면 사건이고, 조건 없이
평가로 닫으면 정도다. 이 규칙은 쓸 수 있지만 **얇고, v2가 남기는 가장 위험한 자리다.**

## 5. `resolution_state`는 closure만 담는다

값은 v1 그대로 `UNRESOLVED | RESOLVED_OR_WORKAROUND | NO_PROBLEM | UNKNOWN`이다.

**감수하거나 포기한 것은 해결이 아니다 — product-owner 결정.**
`RESOLVED_OR_WORKAROUND`는 **문제 자체가 사라졌거나**, 대체 방법을 적용해 **기대했던 사용 상태를
되찾은** 경우다. 다음은 여기가 **아니다** — 반품·교환하려다 포기하고 그냥 씀 · 귀찮아서 그냥 씀 ·
참고 씀 · 문제는 남아 있지만 감수하기로 함. **`tolerated` / `abandoned remediation` ≠ `resolved`.**
「그냥 쓴다」는 문구만 보고 닫지 말고 **문제 상태가 실제로 사라졌는지**를 본다.

**배송·포장에서는 「왔다 · 도착했다 · 받았다」가 곧 종료 신호다** — 늦게 왔더라도 받았으면 그
배송 사건은 끝났고, 박스가 찌그러져 왔더라도 받았으면 그 포장 사건은 끝났다(만족한다는 말이
따로 없어도 그렇다). 아직 안 왔다·계속 지연 중이라고 쓰여 있을 때만 열린 상태다. 이것은 v1
§4-A의 「종료된 배송 지연 7/7 WATCH」를 문장으로 옮긴 것이다.

그 밖에 바뀌는 것은 **무엇을 싣지 않는가**다 — severity·impact를 여기에 싣지 않는다. 그리고 판정표는
`== UNRESOLVED`가 아니라 `!= RESOLVED_OR_WORKAROUND`를 읽으므로, `UNRESOLVED`와 `UNKNOWN`의 차이는
더 이상 어떤 tier도 바꾸지 않는다. **v1 §5-G의 vB3가 이 칸에 넣었던 시제 판독은 철회된다.**

## 6. `action_request_strength` — 축으로 복귀시키지 않는다

DIRECT/SOFT는 `NEEDS_ATTENTION` vs `WATCH`의 핵심 축이 **아니다**(v1 §4-A 유지). 다만:

- **DIRECT → `NEEDS_ATTENTION`** 규칙은 v1에 이미 있고 유지한다. 가르는 것은 **문장의 강도가
  아니라 내용**이다 — 지금 있는 문제를 **고쳐 달라**고 하면 DIRECT(「고쳐 주십시오」·
  「보강해 주십시오」·「개선해 주세요」), 없는 것이 **있으면 좋겠다**고 하면 SOFT.
  **문법이 완곡해도 DIRECT다** — 「손봐야 할 것 같아요」는 DIRECT다. 다만 **단순 개인 취향은
  요구가 아니다** — 판매자가 무엇을 해야 하는지가 문장에 있어야 한다.
- **SOFT**는 tier를 직접 정하지 않지만, **판매자가 바꿀 자리를 이름으로 댄 SOFT**는 §3-8로
  `WATCH`가 된다. 바꿀 자리가 없는 막연한 바람은 `NONE`이고 `FYI`로 간다.

## 7. 과거 / 이전 제품 — product-owner 결정

과거 제품의 실패는 **기본적으로 현재 상품의 Attention 신호로 승격하지 않는다.**

단 「재구매 · 다시 구매 · 두 번째 구매」처럼 **동일 상품의 반복 구매**임이 본문에서 명시적으로
확인되면, 이번에 받은 것이 정상이어도 **반복 품질 신호로 `WATCH`**가 될 수 있다.
「전에 쓰던 것」·「원래 쓰던 것」만으로 같은 상품이라고 추론하지 않는다.

**새 field는 만들지 않는다** — 이것은 `problem_present`의 판독 조건이다.

기존 6건은 이 기준으로 재판정했고, **라벨은 덮어쓰지 않고 append-only로 기록**했다
(original / adjudicated / reason / contract version / timestamp). 그중 tier가 움직인 것은 1건이다.

## 7-A. Stale-label audit — 후보가 아니라 계약이 판정한다

v2의 문장이 확정된 뒤, 기존 라벨 중 그 문장과 충돌하는 것을 찾아 재판정했다. **후보의 예측은
판정 근거가 아니다** — 근거는 후보보다 먼저 쓰인 계약 문장이고, 후보가 우연히 같은 답을 낸
행에서도 그 사실을 근거로 적지 않았다.

| 행 | original | adjudicated | 계약 문장 |
|---|---|---|---|
| D46 | WATCH | **FYI** | v1 §4-A — 우회의 존재만으로는 WATCH가 아니고 **원인이 명시**돼야 한다 |
| B39 | NEEDS_ATTENTION | **WATCH** | §3-6 — concrete failure + 리뷰어가 회피 방법을 스스로 명시 |
| D28 | NEEDS_ATTENTION | **NEEDS_ATTENTION (유지)** | §6 — 완곡해도 수정 요구는 DIRECT. 움직일 것은 라벨이 아니라 판독 문장이었다 |
| D32 | NEEDS_ATTENTION | **NEEDS_ATTENTION (유지)** | §5 — 반품하려다 포기하고 그냥 쓰는 것은 closure가 아니다. **unresolved concrete failure** |
| V67 | WATCH | **WATCH (유지)** | §4-C — 본문이 견고성이라는 바꿀 대상을 식별한다 |

D32·V67은 **라벨이 아니라 계약 문장이 움직인 두 행**이다 — 후보가 틀린 자리를 라벨로 메우지
않았다.

**결정하지 않고 올린 것 하나**: B44(우회 사실만 있고 원인 무명)는 D46과 같은 모양인데 현재
`UNCERTAIN`이다. D46 판정이 그 행도 건드려야 하는지는 이 문서가 정하지 않는다.

## 8. 이 문서가 만들지 않는 것

새 enum · 새 필드 · 새 classifier · 새 holdout · 새 validation corpus · production classifier 변경
**전부 0**. `ReviewTriageRules`도 `ReviewTriageTier`도 이 문서로 바뀌지 않는다.

## 9. Candidate B v7 — DEVELOPMENT-FROZEN

```
prompt   attention-dev-prompt/vB7
sha256   076da930f2589231969a30c8e88ba257d1247a48117be11a2ad5b6656340414a
schema   attention-facts-schema/v2   (변경 없음)
model    gpt-5-2025-08-07 · max_completion_tokens 4000 · reasoning_effort low
```

freeze의 근거는 점수가 아니다. vB6 대비 SYSTEM diff는 **hunk 1개 · +5 / −0**이고 그 내용이 §4-D
한 문장이며, 결정표·true/false 목록·나머지 모든 field 블록은 **byte 단위로 동일**하다. 새 field 0 ·
새 enum 0 · 새 구체 예시 0.

**여기서 나온 어떤 수치도 validation 결과가 아니다.** 설계자가 dev200 전부를 읽었고 이 문서의
문장 다수가 그 행들을 보면서 쓰였다. 그 corpus에서 오답이 0이 된 것은 일반화의 증거가 아니라
**dev200이 더 이상 후보를 구별하지 못한다**(포화)는 사실이다 — 그것이 다음 단계가 같은 corpus의
v8 tuning이 아니라 fresh cross-seller corpus인 이유다. **B31 · B38 · D42 같은 개별 행을 더 맞히기
위한 v8 prompt tuning은 하지 않는다.** v8은 새 contract-level gap이 발견될 때만 허용한다.

## 10. Development adequacy — RUBRIC v1 §4

canonical development evidence는 **n=270**이다 — Attention Development Evidence v2(200) +
Supplement v1(55) + Supplement v1.1(15). 두 supplement는 **후보가 frozen된 뒤에** 뽑히고 라벨됐고,
그것이 이들을 validation으로 만들지는 **않는다**: 같은 판매자, 같은 corpus, 그리고 70행 중 66행이
lexical cue로 선택됐다.

| floor (RUBRIC v1 §4) | dev200 | v1 | v1.1 | total | floor | |
|---|---|---|---|---|---|---|
| scored labels (UNCERTAIN 제외) | 192 | 54 | 15 | **261** | ≥200 | 충족 |
| `NEEDS_ATTENTION` | 30 | 9 | 1 | **40** | ≥40 | 충족 |
| high-rated NO_ACTION (4~5★ FYI) | 95 | 12 | 11 | **118** | ≥30 | 충족 |

**DEVELOPMENT ADEQUACY = MET.** `NEEDS_ATTENTION`은 **정확히 0의 여유로** 통과한다 — 한 행만
달랐어도 미달이었고, 그 사실을 지우지 않는다. 라벨은 floor를 맞추기 위해 한 건도 조정되지
않았다.

**이 floor가 답하지 않는 것**: RUBRIC v1 **§5의 go/no-go**(precision Wilson 95% LB ≥0.80 · recall
≥0.30 · 4~5★ FP ≤0.05)와 **§13.2의 fresh corpus 300행**은 **다른 floor이고 여기서 충족되지
않는다.** §4는 development 증거가 충분한지만 말하고, 그 둘은 fresh cross-seller corpus의 일이다.

corpus는 소진됐다 — `S1`(1~2★) · `S2`(3★) · `S3` · `S5` · `S6` 다섯 stratum에 남은 행이 **0**이다.
같은 판매자에게서 이 축을 더 키우는 draw는 존재하지 않는다.
