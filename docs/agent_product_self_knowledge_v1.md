# Agent Product Self-Knowledge v1

**2026-09-07 · manual owner QA defect · Agent architecture FREEZE 유지 (AOP/Procedure 추가 0)**

## 0. 보고된 것

Clean seller에서 실제 관측:

```
"지원하는 이커머스 종류가 뭐가 있지?"   → 어느 정도 답함
"연동하고 나면 어떻게 가능한거지?"      → onboarding 답
"연동하고 나면 뭐가 되냐고"            → 거의 같은 onboarding 답
```

재현하니 첫 turn은 보고보다 나빴다 — **「어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 · 카페24)」**.
어떤 채널이 있느냐는 질문에 채널을 대라고 되물으면서, 그 거절문의 괄호 안에 답이 들어 있다.

## 1. Trace — 원인은 planner가 아니다

`POST /api/agent/plan` 직접 호출 (v16, QA clean org, 2026-09-07):

| 문장 | requestedAction | needs |
|---|---|---|
| 지원하는 이커머스 종류가 뭐가 있지? | EXPLAIN_CAPABILITY | 0 |
| 연동하고 나면 어떻게 가능한거지? | EXPLAIN_CAPABILITY | 0 |
| 연동하고 나면 뭐가 되냐고 | EXPLAIN_CAPABILITY | 0 |
| 네이버 연결하면 정확히 뭘 해줘? | EXPLAIN_CAPABILITY | 0 |
| 리뷰 답글도 자동으로 보내? | EXPLAIN_CAPABILITY | 1 (`EXPLAIN_CAPABILITY` — **NeedKind에 없는 값**) |
| 쿠팡은 어디까지 가능해? | EXPLAIN_CAPABILITY + channel=COUPANG | `ORDER_HISTORY`, `POLICY` |

**여섯 문장을 planner는 전부 맞게 읽었다.** 못 한 것은 「어떤 종류의 capability 질문인가」를 말하는 것이고,
그럴 축이 없었다. 그 결과:

- **(A) 런타임의 판별자가 proxy였다.** `ConversationService`는
  `aboutAssistant = plan.informationNeeds.length === 0`으로 「우리 자신에 대한 질문인가」를 정했다. 이 proxy는
  양방향으로 틀린다 — need를 하나 붙인 문장(「지원하는 이커머스…」의 다른 실행)이 채널 lane으로 떨어져
  되물음이 되고, need 0인 서로 다른 네 질문이 한 답으로 합쳐진다.
- **(B) 제품 자신에 대한 factual source가 없었다.** 답은 4-domain 카드와 getting-started 카드 **둘**뿐이고,
  그 사이에 「어떤 채널을 지원하는가」·「연결 후 무엇이 일어나는가」·「채널별로 어디까지 되는가」가 들어갈
  자리가 없었다.
- **(C) 「한 사실은 한 번」이 대화 단위로 걸려 있었다.** 카드를 한 번 그린 뒤에는, `NO_CHANNEL`인 동안 이후 모든
  제품 질문이 **무엇을 묻든** `gettingStartedAnswer` 하나로 돌아왔다. 이것이 보고된 반복이다.
- **(D)** 「쿠팡은 어디까지 가능해?」가 `POLICY` need를 세웠다 — 제품 설명 질문에 **판매자 회사의 운영 기준**이
  답으로 나갈 수 있는 모양이고, 프롬프트가 이미 경고하던 바로 그 위험이다.

## 2. 고친 것

### 2-1. 축 하나 — `filters.capabilityAspect` (프롬프트 v16 → **v17**)

`reviewIntent`·`inquiryIntent`와 **같은 가족**이다: action은 「capability를 물었다」를 말하고, aspect는
「어느 capability 질문인가」를 말한다. 닫힌 다섯 값:

`PRODUCT_OVERVIEW` · `SUPPORTED_CHANNELS` · `AFTER_CONNECT` · `CHANNEL_ACTION` · `HOW_TO_CONNECT`

프롬프트에서 두 문단(채널 capability / 어시스턴트 자신)을 **하나로 합치고** 예시는 각 값의 뜻을 보이는 용도임을
명시했다 — 「문구 목록이 아니다, 판매자가 어떻게 말하든 무엇을 알고 싶어 하는지로 고르라」. **키워드 예외 0 ·
새 decision tree 0.** `informationNeeds`는 반드시 비우게 해서 (D)를 닫았다.

**`null`은 여섯 번째 값이 아니다.** `fallbackAspect(channelNamed, overviewAlreadyDrawn, readiness)`가 필드 이전
동작을 **그대로** 재현하므로, v17 이전 backend에 붙은 런타임은 바이트 동일이다.

### 2-2. `operator/capability/ProductSelfKnowledge.ts` — 제품 자신에 대한 유일한 factual source

**중복 작성 0.** 입력은 전부 이미 있던 source of truth다:

| 사실 | 출처 | 추가 읽기 |
|---|---|---|
| 무슨 일을 하는가 | `capabilityDomains` (등록된 tool catalogue) | 0 |
| write 경계 | `boundarySentence` (catalogue의 action class) | 0 |
| 어떤 채널을 지원하고 각각 무엇을 주는가 | `WorldState.coverage` (그 turn의 스냅샷) | **0** |
| 채널별 수집/전송 실제 능력 | `capabilityOf` — 모든 실행 경로가 쓰는 그 resolver | 채널당 overview 1 + org 2 (그 turn만) |
| 연결 후 loop | 이 런타임의 여섯 `Procedure` | 0 |

`AssistantCapability.ts`는 **파생만** 남기고 문장은 전부 이 파일로 옮겼다(같은 문장의 두 번째 사본 금지) —
`assistantCapabilityAnswer`·`gettingStartedAnswer`·`alreadySaidAnswer` 삭제, 그 테스트는 새 소유자를 향한다.

**연결 전에 답할 수 있는 것이 요점이다.** 채널 capability 읽기는 전부 채널-keyed(`/api/channels/{code}/capabilities/overview`)
이거나 org 범위라서 계정이 필요 없다 — 연결을 **결정하려는** 판매자가 그 답을 가장 필요로 한다.

### 2-3. 「모른다」와 「안 된다」와 「이 배포에서 꺼져 있다」는 다른 문장

`NOT_SUPPORTED` 하나에 reason이 셋이고, 합쳐 놓으니 연결된 Demo Org에서 「쿠팡은 어디까지 가능해?」가
**「연결하신 뒤에 확인해 드릴 수 있습니다」**로 답했다 — 몇 달째 연결돼 있는 판매자에게, 연결이 해결책이 아닌 일에.

- `CHANNEL_UNSUPPORTED` → 「이 채널은 외부에서 보내는 길이 없어, 초안을 복사해…」
- `EXECUTION_DISABLED` → 「지금은 초안을 복사해 판매자센터에 올리시게 됩니다」 (**내부 플래그 이름 노출 0**)
- `CAPABILITY_UNKNOWN` → 연결됨이면 「지금은 가능한지 확인하지 못했습니다」, 아니면 「연결하신 뒤에…」

그리고 **읽을 수 있는 사실은 withhold하지 않는다** — 연결된 채널은 그 계정의 review capability를 실제로 읽는다.
NAVER처럼 source subtype이 둘인 채널은 **둘이 같은 답이면 그것이 채널의 답**이고, 다르면 unknown으로 남는다
(per-object lane은 무변경 — 거기서 subtype을 고르는 것은 다른 고객에게 답을 보내는 일이다).

### 2-4. capability 질문은 채널을 **상속하지 않는다**

라이브에서 「네이버 연결하면 정확히 뭘 해줘?」 다음의 「리뷰 답글도 자동으로 보내?」가 `channel: NAVER`를 물고
왔다(`channelFocusOf` — 데이터 대화의 주어를 잇는 장치). 채널을 말하지 않은 제품 질문이 한 채널로 조용히
좁혀지고, 그래서 직전과 **같은 사실**이 되어 반복으로 눌렸다. `productFocus.ts`가 닫은 것과 같은 모양이다 —
**떠난 scope가 문장을 좁히는 것**. `focusForAxis`에서 한 줄, 넓히는 방향으로만.

### 2-5. 「한 사실은 한 번」은 **사실 단위**

키가 aspect뿐일 때 네이버·전체·쿠팡 세 질문이 한 답으로 합쳐졌다(이 패키지가 없애려던 바로 그 모양이, 한 단계
아래에서). 키에 채널이 들어간다. 그리고 재질문의 답이 **직전 문장 그대로에 카드만 뗀 것**이면 첫 답보다 적으므로,
`NO_CHANNEL` 재질문은 새 사실을 말한다 — 「말씀드린 것까지가 연결 전에 드릴 수 있는 전부입니다」.

### 2-6. 렌더링 — 채널 수만큼 반복하지 않는다

org 전체 매트릭스가 12줄(그중 10줄이 이미 읽은 문장의 반복)이었다. 목록의 공유 낱말 규칙과 같게 **사실로 묶는다**:
모두가 공유하는 능력은 채널을 이름 부르지 않고, 갈리는 능력만 그 그룹을 이름 부른다. 실측 **12 → 5줄**.

## 3. 라이브 결과 (clean seller, 실제 브라우저 1440×900@2×)

| 문장 | before | after |
|---|---|---|
| 지원하는 이커머스 종류가 뭐가 있지? | 「어느 채널에 대한 질문인지 알려주세요」 | 세 채널 + 각 채널이 주는 자료 |
| 연동하고 나면 어떻게 가능한거지? | 4-domain 카드 | 수집→초안→이슈→상품→오늘 할 일 5단계 + write 경계 |
| 연동하고 나면 뭐가 되냐고 | 「판매 채널을 연결하는 것부터…」 | 카드 반복 0, 새 문장 + 연결 CTA |
| 네이버 연결하면 정확히 뭘 해줘? | (미보고) | 네이버 4행 매트릭스 |
| 리뷰 답글도 자동으로 보내? | (미보고) | 3채널 매트릭스, 사실 단위 5행 |
| 쿠팡은 어디까지 가능해? | (미보고) | 쿠팡 4행 매트릭스 |

**콘솔 오류 0 · off-host 0 · 가로 스크롤 0 · 문서 높이 900.**

연결된 Demo Org 재확인: overview는 연결된 채널을 이름 부르고(무변경), 채널 매트릭스는 이 org의 진짜 상태를
말한다 — NAVER 리뷰 답글 = guided(라이브 증명된 그 lane), 쿠팡 리뷰 답글 = 채널 미지원, 문의 답변 = 복사.

## 4. 검증

runtime **975** · backend **3,898** · frontend **2,779** · 실패 0 · typecheck clean.
새 시나리오 2건은 **옛 코드에서 빨개지는 것을 확인한 뒤** 남겼다. 새 unit 18건.

**마켓플레이스 호출 0 · WRITE 0 · 승인 0 · 마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행 없음.
모델 호출은 QA turn의 planner뿐(clean seller 14 + Demo Org 5).

**계약이 바뀌어 테스트 3건을 다시 썼다** — `agentObjectV1`/`agentWorkspaceV1`의 두 건은 같은 성질을 새 소유자
(`overviewAnswer`)에 대고 단언하고, `AgentOperatorResponseParserTest`는 v17과 새 축을 고정한다. **안전 테스트
약화 0.**

## 5. 고치지 않고 보고

- `AFTER_CONNECT` vs `CHANNEL_ACTION`은 「네이버 연결하면 정확히 뭘 해줘?」에서 실행마다 갈릴 수 있다(둘 다
  방어 가능한 읽기이고 두 답 모두 그 채널에 대한 사실이다). planner 변동성은 이 패키지가 고정하지 않는다.
- 채널 매트릭스는 **네 가지 능력 전부**를 답한다. 「리뷰 답글」만 물어도 수집 줄이 함께 나온다 — 「어떤 동작인가」
  축을 하나 더 여는 것은 새 schema이고, 관측된 필요가 아직 한 문장이다.
- `SUPPORTED_CHANNELS`는 coverage 표를 따르므로 GMARKET처럼 `ProductChannels` 밖의 채널은 나오지 않는다
  (2026-08-17 product-owner 결정 그대로).
- recorded plan은 v17 실측이지만 **CI는 벤더를 부르지 않는다** — 프롬프트가 다섯 질문을 구분하지 못하게 되면
  fixture는 그대로 다섯을 이름 부르고 단언은 계속 통과한다. 그 검사는 라이브 재녹화뿐이고, 여기 적어 둔다.
