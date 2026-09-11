# Review Triage Contract v1 — 두 축을 분리한다

**Product-owner decisions, 2026-09-10.** 이 문서는 짧고, 새 알고리즘을 하나도 정의하지 않는다.
정하는 것은 **무엇이 무엇의 축인가**뿐이다.

이 결정들은 `contracts/review-eval/naver/v1/RUBRIC.md`와 `v2/RUBRIC.md`를 **승계한다.**
아래 §5가 승계·추가·충돌을 줄 단위로 적는다. 두 rubric 중 어느 문장과도 충돌하는 것으로 읽히면
**rubric이 이기고 이 문서가 결함이다** — v2 §0이 v1에 대해 정한 것과 같은 규칙이다.

---

## 1. Actionability 축 — 기존 3단계를 유지한다

`ReviewTriageTier`는 그대로다. 값도, 의미도, `ReviewTriageRules`의 판정도 바뀌지 않는다.

| tier | 의미 | seller-facing |
|---|---|---|
| `NEEDS_ATTENTION` | 이 리뷰 **한 건**을 판매자가 직접 확인해야 함 | 확인 필요 |
| `WATCH` | 당장 개별 조치 필요성은 낮지만 **패턴으로 관찰할 가치**가 있음 | 지켜보기 |
| `FYI` | 별도 직접 확인 필요성이 낮음 | 참고 |

v2 §2.3이 이름 붙인 성질이 이 축의 정의다 — **seller actionability detection이고, 감정분석도
만족도 점수도 불만 감지도 아니다.**

## 2. Reply Recommendation은 별도 축이다 — `ReviewTriageTier`에 합치지 않는다

답변 필요성은 **조치 필요성의 한 값이 아니다.** 5★ 칭찬은 조치가 0이면서 답변 가치가 있을 수 있고,
1★ 무본문은 답변 가치가 0이면서 별점이 실재한다. 한 enum에 넣으면 그 둘을 같은 자리에 두게 된다.

향후 이 축은 **review context + channel capability + seller policy**로 판단한다. 채널이 답글을
지원하지 않으면 답변 추천은 성립하지 않고(`ReviewTriageChannelCapability`가 이미 아는 사실),
「모든 5★에 답한다」는 회사의 정책은 리뷰의 성질이 아니다.

**이 패키지에서 구현하지 않는다.** 새 enum도, 새 컬럼도, 새 classifier도 만들지 않았다.

### 2-A. Seller reply policy — 관측된 archetype과, 그것으로 정하는 것 (2026-09-11)

**Product-owner decision.** 이 절은 **결정만 적는다** — UI도 schema도 enum도 이 단계에서 만들지 않는다.

Reply Recommendation 축이 읽어야 할 **seller policy**의 모양을, 공개 SmartStore 7곳 · 리뷰 약 400건의
READ-ONLY 관측(`scratchpad/research/`, 저장소 밖)으로 다음 셋으로 정한다:

| archetype | 뜻 | 관측 |
|---|---|---|
| `NO_REPLY` | 답글을 달지 않는다 | 서번트 — 36건 관측, 1★ 결함 불만 9건 포함 **답글 0** |
| `SELECTIVE` | 일부에만 답글을 단다 | 원더너츠 — ≤3★ **19/19**, ≥4★ **0/6** |
| `BROAD` | 대부분에 답글을 단다 | 빅네이처 — ≤3★ 10건 · ≥4★ 20건 |

셋 모두 실물로 존재하고, 관측된 7개 스토어가 이 셋 밖으로 나가지 않았다. **최소 설정 후보는 이 셋으로
충분하다.**

**`SELECTIVE`의 조건은 rating threshold로 받는다.** 이것은 예상과 반대였고 관측이 뒤집었다 — 답글을 다는
두 판매자 모두 **별점에 반응**하며, 답글 문장이 스스로 그 사실을 인용한다("별점 3점 남겨주셨는데 혹시 저희가
부족한 점이 있었을까요?" — 본문은 순수 칭찬인 3★). 반대 방향도 관측된다: 서번트의 1★ 결함 불만은 complaint가
최대치인데 답글이 0이다. 즉 **rating과 complaint는 같은 것이 아니고, 실제로 쓰이는 방아쇠는 rating이다.**

- **`complaint` / `actionability` 기반 SELECTIVE는 채택하지 않는다.** 더 나은 기준으로 보이지만, 판매자가
  자기 정책으로 **진술한 적이 없는** 기준이다. 설정으로 받으면 우리가 발명한 정책이 된다.
- **threshold 값은 지금 고정하지 않는다** (product-owner decision, 2026-09-11). 관측이 정한 것은
  **축이 rating이라는 것**뿐이고 값은 정하지 않았다 — 원더너츠는 ≤3★에 답하고 빅네이처는 1★에도 4★에도
  답한다. `3★ 이하` · `2★ 이하` 같은 기본값도 아직 없다. threshold는 **seller별 설정값 후보**로 남긴다.
- **`question` 기반 SELECTIVE는 「없다」가 아니라 「이 표본에서 보지 못했다」.** 질문형 리뷰 자체가 이
  카테고리(생활용품·식품)에 거의 없었다. 관측되면 그때 값을 하나 더한다.

**외부 seller 행동은 Attention gold로 쓰지 않는다.** 이것이 이 절에서 가장 중요한 금지선이다 — 답글 유무를
attention 근거로 삼으면 두 방향으로 틀린다: 서번트의 「수선하지 않으면 입을 수 없는 상태」(§4 기준으로 명백한
`NEEDS_ATTENTION`)는 답글이 없어 놓치고, 빅네이처의 5★ 칭찬 20건은 답글이 있어 올라온다. 그리고 두 replier
모두 **별점으로 반응**하므로, 이것을 gold로 쓰면 `ReviewTriageRules`에서 벗어나려는 바로 그 heuristic을
학습하게 된다. **§4는 이 관측으로 바뀌지 않는다.**

관측 표본의 한계를 함께 적는다: 스토어 7곳 · 스토어당 상품 1개 · 검색 랭킹 편향 · 로그인 세션에서 관측했으므로
`PUBLIC`은 「공개 페이지에서 로그인한 사용자에게 보인다」는 뜻이다. 플래티넘/프리미엄 등급은 한 번도 관측되지
않았고, 등급은 정책을 예측하지 못했다(파워 둘이 정반대 archetype이었다).

## 3. Seller-facing Queue는 derived UX다 — 저장하지 않는다

| 화면 bucket | 도출 규칙 |
|---|---|
| 직접 확인 | `tier == NEEDS_ATTENTION` |
| 답변할 것 | `tier != NEEDS_ATTENTION` **AND** reply recommended |
| 일반 | 나머지 |

**`WATCH`를 별도의 메인 UX bucket으로 만들지 않는다.** 패턴 관찰은 반복 문제 화면이 이미 소유하고
있고(`/memory/{issueId}`), 판매자의 하루 목록에 「지켜볼 것」이라는 세 번째 더미를 만들 이유가 없다.
`WATCH`는 계속 저장·정렬·집계되지만 그것을 이름으로 부르는 화면 bucket은 없다.

## 4. `NEEDS_ATTENTION`의 기준 — 부정 표현이 아니라 **미결 조치**다

**Product-owner decision, 2026-09-11.** 이 축을 가르는 질문은 「불만·부정 표현이 있는가」가
**아니라** 이것이다:

> **이 리뷰 한 건 때문에 판매자가 지금 직접 확인·판단·조치해야 하는가?**

### `NEEDS_ATTENTION`

- 지금도 **남아 있는** 제품 · 배송 · 설명 · 품질 문제
- **사용 불가** 또는 명확한 **기능 이상**
- 교환 · 환불 · 재발송 등 **조치 가능성**이 있음
- 판매자에게 **명시적으로** 수정 · 개선 · 대응을 요구

### `WATCH`

- 문제가 있었으나 **이미 해결됨**(문의 · 교환 등으로)
- 배송 지연 등이 있었으나 **이미 수령했고** 지금 개별 대응할 일이 없음
- 개별 고객 대응보다 **반복 여부 관찰**이 중요한 마찰

이 세 줄은 **예시이지 정의가 아니었고**, 그 공백이 실제로 라벨을 갈랐다. 정의는 **§4-A**가 적는다.

### `FYI`

실질적인 문제 신호도 패턴 신호도 없음.

### 유지되는 tie-breaker

- **1–2★ 무본문 → `WATCH`.** (v1 §2) 볼 것이 없다. `FYI`로 내리지도 않는다 — 별점은 실재한다.
- **3★인데 구체적으로 조치할 내용이 없음 → 직접 확인 아님.** (v2 §2.2 product-owner adjudication)
  `NEEDS_ATTENTION`은 판매자가 **지금** 확인하거나 조치할 것을 요구한다.

### 이 기준이 하지 않는 것

**감정의 강도를 재지 않는다.** 「배송이 좀 늦어서 걱정했는데」는 부정 표현이지만, 그 고객은 이미
물건을 받았고 판매자가 **그 한 건에 대해** 할 수 있는 조치가 없다. 그 마찰이 실재하지 않는다는
뜻이 아니라 — 실재하고, 반복되면 배송 문제이며, 그것을 보는 자리는 반복 문제 화면이다. v2 §2.3이
이름 붙인 성질(**seller actionability detection이지 sentiment analysis가 아니다**)이 여기서
처음으로 **높은 별점 쪽으로도** 적용된다. 이 결정이 v1 §2의 한 행을 개정하며, 무엇을 어떻게
개정하는지는 **§5-B**가 적는다.

## 4-A. `WATCH`의 의미 — product-owner 결정 (2026-09-11)

**§4의 WATCH는 세 개의 예시였고 정의가 아니었다.** 그 결과 development labeling에서 두 계열의 행이
서로 다른 방향으로 갈렸고(§5-E), candidate 하나는 「제품 결함이 아니면 FYI」로 수렴했다. 정의를
여기서 확정한다.

> **`WATCH`**: 지금 이 고객 건을 판매자가 직접 처리할 필요는 낮지만, **같은 신호가 반복되면**
> 상품 · 설명 · 설치 · 배송 · 운영 방식을 **구체적으로** 개선할 가치가 있는 마찰.

**따라서 `WATCH`는 product defect에 한정되지 않는다.** 이것이 이 결정의 실체다 — 마찰의 원인이
제품의 하자일 필요가 없고, 지금 열려 있을 필요도 없다.

### 포함

| | |
|---|---|
| 이미 해결됨 / 우회됨 | workaround가 적용됐고, **무엇 때문에 그것이 필요했는지가 본문에 명시**되어 있으며, 같은 마찰이 반복되면 판매자가 구체적으로 개선할 수 있음 |
| 선택 정보 공백 | 상품 선택 · 사이즈 · 구성 수량에 대한 안내 부재 |
| 사용 과정 마찰 | 설치 · 사용 과정에서 **반복 가능한** 어려움 |
| 종료된 배송 마찰 | 지연이 이미 끝났으나 반복 모니터링 가치가 있음 |
| 사용은 가능한 구체적 불편 | 반복되면 seller-side 개선이 **가능한** 불편 |

**`workaround`의 존재만으로는 `WATCH`가 되지 않는다.** 2026-09-11 측정: 마찰을 이름으로 댄
우회 행은 **7/7 `WATCH`**, 우회만 있고 원인이 무명인 행은 **0/2**였다. 필요조건은 우회가 아니라
**마찰의 명명**이다 — 「나사로 보강했지만 모양 깔끔해요」는 무엇을 개선할지 말하지 않는다.

### 제외 — `FYI`로 간다

- 단순 **취향**
- 막연한 「더 좋으면 좋겠다」
- 반복돼도 판매자가 취할 **구체적 변화가 불명확한** 선호
- 마찰의 **신호는 있으나 내용이 특정되지 않음** — 「주문할 때 잘 생각해야 돼요」

### 가르는 질문은 하나다

「이 문장이 열 번 반복되면, 판매자가 **무엇을 바꿀 수 있는가**?」 — **자리를 이름으로 댈 수 있으면**
`WATCH`, 댈 수 없으면 `FYI`. 강도·감정·별점이 아니라 **바꿀 자리의 존재**가 기준이다.

이 질문에 답하는 어휘는 새로 만들지 않는다. **`OpportunityKind`와 `OpportunityRules.guidanceTargetOf`가
이미 그 자리의 목록이다** — FAQ · 상세·안내 · 운영 기준 · 제품 자체. 관계는 §4-B.

### `NEEDS_ATTENTION`과 `WATCH`를 가르는 것은 **요구의 강도가 아니다** (2026-09-11 측정)

`action_request_strength`(DIRECT / SOFT)를 주된 축으로 쓰지 않는다. targeted validation이 같은
모양의 행 **12건**을 만장일치로 갈랐고, 가른 것은 요구의 세기가 아니라 **현재 상태**였다:

| 모양 | tier | 일관성 |
|---|---|---|
| 개선 제안 + **현재 미해결 결함·문제를 명시** | `NEEDS_ATTENTION` | **3/3** |
| 현재 결함 없음 / 사용 가능 + **개선 제안·마찰만** | `WATCH` | **6/6** |
| 배송 지연이 **이미 끝남** | `WATCH` | **7/7** |

「테이프가 좀 더 강력했으면 좋겠습니다」와 「접착테이프가 좀 더 강했으면 좋겠어요」는 서로 다른 sitting에서
독립적으로 같은 값을 받았다. 요구 문장의 강도는 **보조 fact로는 유효**하나 tier 결정의 핵심 축이 아니다.

### 구매 결정 / 구성 안내 마찰 — **안내할 내용이 특정되면 `WATCH`**

개별 대응이 필요 없어도, 리뷰가 판매자가 **추가로 안내할 구체적 내용**을 특정하면 `WATCH`다.

- 어떤 **규격**을 선택해야 하는지 — 「이 굵기면 5호를 구매하시는 걸 추천」
- 필요한 **구성 · 수량** — 「마감캡은 꼭 필요한 수량대로 주문하세요」
- 특정 **설치 조건** — 「도배지에는 실리콘이나 젤타입 접착제가 필요함」

반대로 **무엇을 안내해야 하는지 본문만으로 특정할 수 없으면 임의로 `WATCH`로 만들지 않는다.**
측정된 5건이 이 규칙 하나로 전부 설명된다(특정됨 2 → `WATCH`, 특정 안 됨 3 → `FYI`/`UNCERTAIN`).

### `NEEDS_ATTENTION`과 `FYI`는 그대로다

- **`NEEDS_ATTENTION`**: 이 리뷰 한 건 때문에 판매자가 **지금** 직접 확인 · 판단 · 조치해야 한다.
- **`FYI`**: 현재 조치도 없고, 반복 관찰할 **구체적** 마찰도 없다.

세 tier의 관계는 강도의 사다리가 아니다. `NEEDS_ATTENTION`은 **지금**에 대한 질문이고, `WATCH`는
**반복되면**에 대한 질문이며, `FYI`는 둘 다 아니다.

### 이 결정이 무효화하지 않는 것

220 gold · holdout 판정 · `ReviewTriageRules` · `TRIAGE_TIER_RANK` · 저장된 tier — **전부 재작성
0**. §5-B와 같은 이유다: 그 코퍼스는 이 결정 이전 rubric의 것이고, 이 문장의 근거로 인용할 수 없다.

## 4-B. Observable factor — 「반복되면 바꿀 자리」를 무엇으로 표현하는가

> ## ⛔ 상태: **`NOT_ADOPTED` — measurement did not support (2026-09-11)**
> 
> 아래 §4-B가 제안한 5-value `improvement_target` enum은 **채택하지 않는다.** 같은 날 targeted
> validation 45건에 기존 어휘(`OpinionUnitSplitter` + `IssueVocabulary` + `NegationScope` +
> `OpportunityRules`, 전부 무변경)를 그대로 돌려 잰 결과:
> 
> | | |
> |---|---|
> | derived `improvement_target ≠ NONE` recall | **3/16** |
> | false positive | 1/27 |
> | **aspect** 축 매치 — actionable 16행 | **16/16** |
> | **aspect** 축 매치 — `FYI` 27행 | **25/27** |
> 
> **의미는 맞았고 구별력이 없었다.** false positive가 사실상 0이므로 `OpportunityRules`의 판정
> 자체는 §4-A와 어긋나지 않는다. 그러나 「바꿀 자리가 있는가」는 `FYI` 행 25/27에서도 참이므로
> tier를 가르지 못한다. 실제로 가르는 것은 **problem 축**(구체적 마찰이 명명됐는가)이고, 그 축은
> Candidate가 **이미 가진 `problem_type` 필드**다.
> 
> ⇒ **새 enum · 새 field · 새 낱말 0.** 필요한 변경은 기존 필드 둘에 대한 것이다 —
> `problem_type`을 `problem_present`에 종속시키지 않는 것과, problem 축 어휘를 **측정된 라벨
> 위에서** 넓히는 것(RUBRIC v1 §4의 전제가 이제 처음으로 충족된다).
> 
> 아래 본문은 **삭제하지 않고 남긴다.** 다음에 같은 제안이 나올 때 왜 채택되지 않았는지가
> 근거와 함께 읽혀야 한다.


§4-A의 기준을 classifier가 tier 이전에 구조화하려면 그 질문을 담을 칸이 필요하다. **기존 어휘 조사를
먼저 했고, 대부분 있었다.**

| 필요한 것 | 기존 어휘 | 판정 |
|---|---|---|
| 바꿀 자리의 목록 | `OpportunityKind` 4종 (FAQ · 상세·안내 · 운영 기준 · 제품 자체) | **있다** |
| 어떤 마찰이 어느 자리로 가는가 | `OpportunityRules.guidanceTargetOf` (aspect × problem → target) | **있다** |
| 마찰의 종류 | `IssueVocabulary` 9 aspect × 10 problem | **부분적** |
| 문제 유형 | `TriageReasonCode` §3.1 6종 | 있다 (결함 축만) |

**`OpportunityRules`가 이미 이 질문의 답이다.** 그 파일의 docblock이 적은 대로 그 표는 「판매자가 그
aspect에 대해 **어디서** 행동할 수 있는가」를 말하고 원인도 효과도 주장하지 않는다 — §4-A가 요구하는
바로 그 판정이다. 그러므로 이것은 새 개념이 아니라 **이미 있는 판정을 리뷰 한 건 수준으로 내리는
것**이다.

**그래도 칸이 하나 필요한 이유는 둘이다.**

1. `OpportunityRules`는 **issue 수준**이고 `IssueVocabulary` 매치를 전제한다. 리뷰 한 건을 읽는
   classifier는 그 표의 입력(aspect · problem)을 스스로 말해야 한다.
2. 그 표의 출력 중 **FAQ 보완 vs 상세·안내 보완**을 가르는 것은 *판매자가 이미 무엇을 써 두었는가*이고,
   그것은 이 classifier의 **입력 계약에 없는 정보**다(rating + body만). 그러므로 리뷰 수준에서 말할 수
   있는 것은 **kind가 아니라 target**이다.

### 제안하는 최소 표현 — 새 낱말 0개

```
improvement_target :
    USAGE_GUIDANCE          # KnowledgeSourceType.USAGE       — 사용·설치 안내로 답할 수 있다
    DESCRIPTION_GUIDANCE    # KnowledgeSourceType.DESCRIPTION — 상세페이지 기재로 답할 수 있다
    OPERATING_RULE          # OrgKnowledgeType.SHIPPING_POLICY / EXCHANGE_REFUND_POLICY
    PRODUCT_ITSELF          # OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW
    NONE                    # 바꿀 자리를 이름으로 댈 수 없다
```

**다섯 값 전부 기존 선언과 1:1 대응이고 새로 만든 낱말은 없다.** 브리프가 예시로 든
`repeat_actionable_friction`은 이 필드의 **파생 view**다(`improvement_target != NONE`) — boolean을
따로 두지 않는 이유는 크기가 아니라 검증 가능성이다: boolean은 무엇으로도 정당화되지만, target은
「그 자리에 쓸 문장을 지금 쓸 수 있는가」로 판매자가 직접 반증할 수 있다. **쓸 수 없으면 `NONE`이다.**

### 이 factor가 지켜야 하는 성질

- **`problem_present`와 독립** — 제품에 하자가 없어도 target이 있을 수 있다.
- **`resolution_state` · `workaround_present`와 공존** — 이미 해결된 마찰도 반복되면 바꿀 자리가 있다.
- **rating에서 파생 금지** — 이 필드의 어휘에 별점 항이 없고, 같은 값이 3★과 5★ 양쪽에 나타난다.
- **근거는 body의 verbatim** — target을 주장하려면 그 aspect를 말한 **고객의 문장**을 인용해야 한다.
- **`NONE`에 default가 없다** — 모르면 `NONE`이 아니라 판정하지 않는다(RUBRIC v2 §8.5).

### 아직 확정하지 않은 것 — 이번 targeted validation이 답할 질문

1. **`IssueVocabulary`의 9 aspect가 구매 결정 마찰을 덮지 못한다.** 「구성 수량을 필요한 만큼
   주문하세요」 · 「이 선 굵기면 한 호수 위를 사세요」에 해당하는 aspect가 없다. 어휘를 넓힐지,
   target을 aspect 없이 인정할지는 **측정 뒤**에 정한다 — 낱말을 먼저 추가하지 않는다(v1 RUBRIC §4).
2. **자기 귀책 마찰의 경계.** 「내가 사이즈를 잘못 봤다」는 판매자가 상세에 쓸 수 있는 문장이 있으면서도
   고객 자신이 문제라고 말하지 않는다. `WATCH`인지 `FYI`인지 이 3-tier 정의만으로 갈리지 않는다.
3. **`workaround_present` 단독으로 `WATCH`가 되는가.** dev set에는 우회가 있으면서 `FYI`인 행이 있다.

**이 셋 중 무엇도 지금 코드로 만들지 않는다.** §4-B는 설계이고, 구현은 targeted validation 결과 뒤다.

## 5. AI 지표는 `author_kind = 'MODEL'`만 쓴다

- **`RULE`(템플릿) 승인은 AI draft adoption에 포함하지 않는다.** 분자에도 분모에도 넣지 않는다.
  `<> 'SELLER'` 술어는 금지 — 문의 lane이 이미 낸 결함이고
  (`docs/core_daily_loop_ux_v1.md`가 `= 'MODEL'`로 고친 그것) 리뷰 lane에서 같은 모양이 된다.
  **실측 근거**: 2026-09-10 로컬 DB에서 서 있는 승인 4건 중 **2건이 `RULE`**이다.
- **approval history는 `review_reply_approval`이 아니라 `review_reply_approval_audit`을 읽는다.**
  현재 행은 `uq(review_id)` 하나라 철회하면 `approved_version`이 null이 된다. audit만 append-only다.
  **실측 근거**: `c329471c`는 지금 `WITHDRAWN`(head v22)이고 「v3 승인 후 철회」는 audit에만 있다.

**오늘 이 지표를 계산하는 production 코드는 없다.** `review_reply_draft`에 대한 쿼리는 존재 검사
둘뿐이고 `author_kind`를 읽지 않는다. 이 절은 **첫 구현자를 위한 사전 규칙**이지 기존 코드의 수정이
아니며, 이 패키지는 지표를 만들지 않았다.

## 6. 「사진 있음」은 근거로 쓰지 않는다

NAVER 취득 경로에 `reviews.media_count` producer가 없을 때까지 triage reason/evidence로 사용 금지.

**실측 근거**: REAL 리뷰 4,753행 **전부 `media_count = 0`**이다. 이 컬럼을 채우는 in-page 추출기는
`collector/src/action-window/coupang-review/`에만 있고, 이 org의 리뷰는 전부 NAVER다. 컬럼은 ingest를
지나 `ChannelReviewDetailView`까지 배선돼 있으므로, 화면이 「사진 있음」을 그리면 **모든 리뷰에 대해
거짓을 말한다.**

## 7. 새 LLM candidate도 새 holdout도 아직 만들지 않는다

calibration을 먼저 끝낸다. `contracts/review-eval/naver/v2/holdout-spent.json`은 **봉인된 채로
둔다** — 그 파일을 지우는 것은 메시지가 붙은 커밋이다.

---

## 5-A. Rubric과의 관계 — 승계 · 추가 · 충돌

### 승계 (한 글자도 바꾸지 않음)

| 출처 | 내용 |
|---|---|
| v1 §1 | 라벨링 질문 — 「판매자가 이 리뷰에 대해 무언가 해야 하는가」 |
| v1 §2 | tie-breaker **다섯** (택배 불만 = 조치, 낮은 별점 무본문 = 무조치, 요구 없는 비판 = 무조치, 혼합 리뷰는 조치 항목 하나면 전체가 조치, 이미 답변된 리뷰는 본문만 보고 판단). **첫 행(칭찬+양보)은 §5-B가 개정한다 — 이 표에서 유일하게 그대로 넘어오지 않는 줄이다.** |
| v1 §4 | adequacy floor 200 |
| v1 §5 | go/no-go — precision ≥ 0.80 (Wilson lower bound) · recall ≥ 0.30 · 4–5★ 오탐 ≤ 0.05 · `LOW_RATING_REVIEW` 카운트 불변, 「a detector may only ADD」 |
| v2 §2.2 | 3★ 무조치 = `WATCH` (§4가 재확인) |
| v2 §2.3 | actionability이지 sentiment가 아니다 (§1이 재확인) |
| v2 §3.1 | reason code 13종 |
| v2 §8.3/§8.3.1 | 채널 경계 — NAVER · Cafe24 · Coupang |
| v2 §8.5 | 알 수 없는 값에 기본값을 넣지 않는다 (`UNCLASSIFIED`는 tier가 아니다) |
| v2 §8.9 | additive guard — AI는 tier를 **올리기만** 한다 |
| v2 §12·§13 | 220 라벨은 development evidence이고 어떤 candidate도 최종 검증할 수 없다 |

### 추가 (rubric이 다루지 않는 것)

**Reply Recommendation 축(§2)은 두 rubric 어디에도 없다.** rubric은 **판단 하나**를 라벨한다
(v2 §2: "One judgment, read two ways"). 그래서:

> **220개 gold label을 새 축으로 옮길 수 없다.** `NEEDS_ATTENTION → 직접 확인`만 넘어오고,
> `WATCH ∪ FYI → {답변할 것, 일반}`은 **아무도 라벨한 적이 없다.**

이것이 calibration이 필요한 이유이고, calibration sheet가 **행마다 두 칸**을 받는 이유다.

§3의 derived queue는 v1 §5의 regression gate를 지킨다 — 화면 bucket이 `tier`를 바꾸지 않으므로
`LOW_RATING_REVIEW` 카운트는 움직이지 않고, 답변 축은 조치 축 위에 **덧붙기만** 한다.

### 충돌 (하나 — §5-B가 개정한다)

v1 §2 첫 행(「칭찬+양보 = 조치」)과 §4의 기준은 서로 다른 답을 낼 수 있다. 조용히 어느 한쪽을
따르지 않고 **개정으로 기록한다** — §5-B.

그 밖에 두 rubric의 문장과 충돌하는 결정은 없다.

함께 기록해 둘 것은 **이 세션 안에서 뒤집힌 제안 하나**다. 2026-09-10 inventory 보고가 세 class를
`DIRECT_ATTENTION` / `REPLY_NEEDED` / `GENERAL` 한 축으로 접는 안을 냈고, **product-owner가 §2로
거절했다.** 이유가 그 제안 자신이 적은 것과 같다 — 그 안에서 중간 class가 패턴 class에서 커뮤니케이션
class로 **말없이 바뀌고**, `WATCH`가 하던 일을 아무도 하지 않게 된다. 두 축으로 나누면 그 문제가
사라진다.

---

## 5-B. 개정 — v1 §2 「칭찬+양보 = 조치」 blanket rule

**Product-owner decision, 2026-09-11.** RUBRIC v1 §2의 첫 행은 이렇게 되어 있다:

> Praise with a concession — 「예쁜데 배송이 너무 늦었어요」 → `NEEDS_LOOK`
> *"This is the exact class the whole effort exists for. A high rating does not neutralise an
> actionable complaint."*

**뒤 문장은 승계하고, 앞 규칙은 승계하지 않는다.**

- **승계**: 높은 별점이 조치 가능한 불만을 무효화하지 않는다. 이것은 그대로 참이고 §4의
  `NEEDS_ATTENTION` 목록 넷이 별점을 조건으로 달지 않는 이유다.
- **승계하지 않음**: 「칭찬 + 양보」라는 **문장의 모양** 자체가 곧 조치라는 blanket rule. 그 모양은
  조치가 **아직 남아 있는지**를 묻지 않는다.

그 예문은 §4 아래에서도 **여전히 `NEEDS_ATTENTION`일 수 있다** — 물건이 아직 도착하지 않았다면.
도착했고 고객이 만족을 적었다면 `WATCH`다. **바뀐 것은 예문의 답이 아니라 답을 정하는 질문이다.**

### 이 개정이 실제로 움직이는 행 — 2026-09-11 blind calibration (n=40)

| # | 별점 | 본문 요지 | v1 §2 첫 행 | §4 기준 |
|---|---|---|---|---|
| 4 | 4 | 배송은 늦었지만 설치 간단하고 편리 | `NEEDS_LOOK` | **`WATCH`** |
| 40 | 5 | 배송이 늦어 걱정했으나 설치 후 만족 | `NEEDS_LOOK` | **`WATCH`** |
| 31 | 4 | 초기 불량 → 문의 → 해소 | (모호) | **`WATCH`** |

셋 다 **이미 끝난 마찰**이고, 셋 다 반복되면 실재하는 운영 신호다. 같은 세트의 #10 · #18 · #21
(요구 없는 제품 비판 · 규격 조언)은 v1 §2의 **다른 행**과 이미 일치하므로 이 개정과 무관하다.

### 기존 gold와 history는 재작성하지 않는다

- **`contracts/review-eval/naver/v2/labels*.json`의 220 라벨을 한 줄도 건드리지 않는다.** 그것은
  v1 §2 첫 행이 서 있던 시점의 판단이고, 결과를 본 뒤 고치면 측정이 아니라 **결과에 맞춘 기준**이
  된다 — v1 서문이 「a threshold agreed after seeing a result is not a threshold」로 거부하는 것.
- 따라서 220 gold는 **이 개정 이전 rubric의 코퍼스**이고, 「칭찬+양보」 모양의 행에서는 두 기준이
  갈릴 수 있다. **얼마나 갈리는지는 아직 측정되지 않았다.** 재라벨 없이 그 코퍼스를 §4의 근거로
  인용하면 안 된다.
- `holdout-spent.json`의 `REJECTED`도 그대로다. 그 판정은 v2 프롬프트의 precision에 대한 것이고
  이 개정이 되살리지 않는다. 파일은 봉인된 채다(§7).
- 재라벨을 한다면 **새 rubric 버전**으로 하고 옛 라벨은 남긴다. **이 패키지는 하지 않는다.**

### 이 개정이 rubric 파일을 고치지 않는 이유

`contracts/review-eval/naver/v1/RUBRIC.md`는 **220 라벨이 생성된 시점의 기준**이고, 그 파일을
지금 고치면 이미 커밋된 라벨들이 자기가 따르지 않은 규칙을 가리키게 된다. 개정은 **이 문서에
기록되고 §5-A 표가 그것을 가리킨다** — 다음 라벨링 버전이 rubric 파일을 새로 쓸 자리다.

---

## 5-C. T-07 — seller triage correction (2026-09-11)

**Product-owner decision, 구현됨.** 판매자가 **시스템 판단에 동의하지 않을 때 자기 판단을 남길 수 있어야
한다**, 그리고 그것은 AI pilot과 무관한 기능이다.

이 결정이 **명시적으로 뒤집는 것 하나**를 먼저 적는다. `TriageFeedbackRequests`는 이렇게 적고 있었다 —
"There is no WATCH/FYI choice here on purpose: that split is the rule's and the pilot does not own it."
그 문장은 **pilot에 대해서는 옳고 seller에 대해서는 틀렸다.** pilot의 mark는 additive이고 구조적으로
binary지만, 판매자는 화면이 보여 주는 어휘 **전체**를 소유한다. 실제 결함: 「확인할 필요 없어요」는
**그 행에 대해 규칙이 말했을 값**으로 저장됐으므로, 참고라고 생각한 판매자에게 지켜보기가 그의 이름으로
기록됐고 둘은 이후 구별되지 않았다.

| 결정 | 내용 |
|---|---|
| **값** | `NEEDS_ATTENTION` · `WATCH` · `FYI` — 화면의 chip과 **같은 세 단어** |
| **AI pilot과 분리** | correction은 pilot 여부와 무관하게 가능. pilot은 `shownSource`(RULES/AI)만 정한다 |
| **overwrite 없음** | 시스템 판단은 read time에 그대로 계산되고, 두 판단이 화면에 **나란히** 선다 |
| **순서 불변** | `FINAL_TIER_RANK`는 correction 테이블을 읽지 않는다 — 재정렬은 overwrite의 다른 이름이다 |
| **되돌리기** | 삭제가 아니라 `WITHDRAWN` 상태. 삭제는 **frozen snapshot에서 행을 없앨 수 있다** |
| **변경 기록** | append-only `review_triage_correction_audit` (`tier_from`/`tier_to`) |
| **Decision Data** | silver `review_triage_behavior_events`와 섞지 않는다 — 같은 press가 두 강도로 두 번 세어지면 안 된다 |
| **rule vs LLM 구분** | `shown_source`가 V43부터 이미 답한다. 이번에 trail에도 얼린다 |
| **분리 범위** | **correction만.** 조치 시작·완료·불필요 버튼은 pilot 뒤에 그대로 둔다 — 무엇이 더 기록되는지 넓히는 것은 이 결정이 아니고, **Recommended Action / Decision Workspace 작업 때 다시 정한다** (product-owner decision, 2026-09-11) |

**새 generic event platform은 만들지 않았다.** `review_reply_approval`(STANDING/WITHDRAWN + `*_audit`)과
`review_triage`/`review_triage_audit`이 이 저장소가 「바뀔 수 있고 답변 가능해야 하는 사람의 결정」에 이미
쓰는 모양이고, 이것은 그 패턴의 **세 번째 사례**다.

**correction은 gold가 아니다.** 그 규율은 `CorrectionDispositionKind`가 이미 소유한다 — 사람이
`CLASSIFIER_ERROR` / `SELLER_PREFERENCE`로 읽기 전까지 correction 행은 **왜인지 말하지 않으며**,
`SELLER_PREFERENCE`는 global gold set에 영원히 들어가지 않는다. 이번 변경은 그 경계를 건드리지 않았다.

## 5-D. Attention Dev Set v1 — 고정 (2026-09-11)

**Product-owner decision.** blind labeling으로 만든 **60개**를 development evidence로 고정한다.
라벨은 이 문서로도, 이후 어떤 candidate 결과로도 **수정하지 않는다**.

| field | value |
|---|---|
| n | 60 |
| status | **PROVISIONAL** |
| contract | 이 문서의 현재 버전 (§4 + §5-B 개정) |
| UNCERTAIN 비율 | **0/60** |
| 용도 | candidate 개발 · error analysis · regression comparison |
| 금지 | production go/no-go · prevalence 주장 · final benchmark |

**금지가 규율이 아니라 산술이다.** RUBRIC v1 §4의 adequacy floor 셋 중 하나만 충족한다 —
라벨 60/200 · 확인 필요 13/40 · 4~5★ 무조치 35/30(충족). 앞의 둘이 미달이므로 harness는 판정을
거부해야 하고, 그 거부가 옳다.

**아직 닫히지 않은 경계 하나를 이름으로 남긴다** — *soft improvement suggestion의 강도*. §4는
「명시적으로 수정·개선·대응을 **요구**」라고만 적고 **요구와 바람을 가르지 않는다.** 관측된 행은
**3건**이고 그중 `NEEDS_ATTENTION` 둘이 4★, `WATCH` 하나가 5★라 별점이 판단에 새어 들어갔을 가능성을
배제할 수 없다. **이 3건으로 threshold를 만들지 않는다.** 준비된 나머지 140개가 이 경계의 표본을
들고 있고, 그것을 라벨한 뒤에 정한다.

> **경과 (2026-09-11, 같은 날).** 이 경계는 threshold가 아니라 **정의의 공백**이었고 §4-A가 그것을
> 메웠다. 3건의 판정은 **§5-E**가 적는다 — #17 · #48 confirm, #57 adjudicate. 라벨 자체는 여전히
> 움직이지 않았고 canonical development label은 `attention-dev-set/v1.1-canonical`이다.

라벨 데이터 자체는 실제 고객 문장이므로 scratchpad에만 있고 저장소에 커밋하지 않는다.

## 5-E. #57 adjudication — soft improvement edge (2026-09-11)

§5-D가 「아직 닫히지 않은 경계」로 이름 붙인 3건 중 하나를 **product-owner adjudication**으로 닫는다.
나머지 둘은 확정(confirm)이고 값이 움직이지 않는다.

| n | 별점 | original | adjudicated | 판정 |
|---|---|---|---|---|
| 17 | 4★ | `NEEDS_ATTENTION` | `NEEDS_ATTENTION` | **CONFIRMED** — 명시적 수정 요구 |
| 48 | 5★ | `WATCH` | `WATCH` | **CONFIRMED** — 우회 적용 + 바람 |
| 57 | 4★ | `NEEDS_ATTENTION` | **`WATCH`** | **ADJUDICATED** |

**#57의 근거.** 「지금 확인·판단·조치」가 없다 — 고객은 제품을 쓰고 있고 이 한 건에 대해 판매자가 할
조치가 없다. 동시에 §4-A의 `WATCH` 조건은 충족한다: 마찰이 **구체적**이고(특정 부품의 접착력), 반복되면
바꿀 자리를 **이름으로 댈 수 있다**(사용 안내 또는 접착 사양). §4-A의 제외 항목(취향 · 막연한 바람)에
걸리지 않는다.

**이것은 라벨러의 오류가 아니라 계약의 공백이었다.** 라벨 시점의 §4는 「명시적으로 수정·개선·대응을
**요구**」라고만 적었고 요구와 바람을 가르지 않았다. 그 공백을 §4-A가 메웠고, 이 adjudication은 메운
뒤의 재판정이다 — 그래서 원 라벨을 **틀렸다고 적지 않는다**.

### 라벨 history는 보존한다 — 덮어쓰기 0

원 라벨은 `dev-set-v1.json`에서 **한 글자도 움직이지 않는다**(그 파일의 digest
`e7cc804d…`가 adjudication 기록 시점에 재검증됐다). adjudication은 **곁에 서는 두 번째 값**이고
별도 파일에 original · adjudicated · reason · contract version · adjudicated_at을 나눠 적는다.

| | |
|---|---|
| canonical development label | `adjudicated_tier if present else rows[].label` |
| id | `attention-dev-set/v1.1-canonical` |
| 움직인 행 | **1** (#57) |
| 분포 변화 | NA 13→**12** · WATCH 11→**12** · FYI 36 (불변) |

**보고 규칙.** canonical 라벨로 계산한 모든 수치는 **adjudicated 행 수를 함께 보고**하고, adjudication
이전에 계산된 수치와 직접 비교하지 않는다. 「0.917」과 「0.933」이 같은 기준의 두 값처럼 읽히는 것이 이
규칙이 막는 결함이다.

## 5-F. Attention Dev Set v1.1 — n=105, **전부 development evidence** (2026-09-11)

**Product-owner decision, 그리고 정정이다.** §5-D의 60개와 그 뒤 WATCH 경계 검증으로 라벨한 45개를
**하나의 development set으로 합친다.**

| field | value |
|---|---|
| name | **Attention Dev Set v1.1** |
| n | **105** (60 + 45) |
| status | **PROVISIONAL — development evidence** |
| label 해석 | `adjudicated_tier if present else 원 라벨` (§5-E) |
| 용도 | candidate 개발 · error analysis · regression comparison |
| **금지** | **validation · holdout · go/no-go · prevalence 주장 · production 성능 주장** |

**45개를 「검증셋」이라고 부르지 않는다.** Candidate B가 그 행들에 실행된 적은 없지만, **그 라벨
결과를 읽고 B v2의 schema와 decision rule을 설계했다** — §4-A의 workaround 조건도, soft
improvement 경계도, 구매 안내 규칙도 전부 그 45건의 판정에서 나왔다. 모델이 그 데이터를 보지 않았어도
**설계자가 봤으면 독립이 아니다.** 그것을 validation set이라고 부르는 것이 이 문서가 막으려는 종류의
주장이다.

**그래서 이 105개로는 여전히 아무것도 통과하지 못한다.** RUBRIC v1 §4의 adequacy floor는 라벨
**105/200**이고, §5의 go/no-go는 애초에 holdout의 것이다. 이 집합 위의 어떤 수치도 **production 성능이
아니며**, 사후에 PASS threshold를 만들지 않는다.

**아직 라벨하지 않은 95건**(prepared batches b2~b8의 나머지)은 그대로 둔다. 그 95건은 지금 이 저장소에서
**어떤 candidate도, 어떤 설계자도 보지 않은 유일한 행들**이고, fresh validation을 만들 때 가장 먼저
쓸 수 있는 재고다.

## 6-A. 이 계약이 만들지 않는 것

새 enum · 새 컬럼 · 새 마이그레이션 · 새 classifier · 새 LLM capability · 새 Decision schema ·
`ReviewTriageRules` 변경 · `TRIAGE_TIER_RANK` 변경 · 새 holdout. **전부 0.**
