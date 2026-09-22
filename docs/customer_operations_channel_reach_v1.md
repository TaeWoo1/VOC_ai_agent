# Customer Operations — Channel Reach v1 (G1 closure)

2026-09-22 · branch `feat/review-decision-workspace-v1` · follows `docs/full_mvp_channel_capability_audit_v1.md` §2 G1

**Product-owner decision (current task, conflict priority 1).** 고객 운영 관리(`CUSTOMER_OPERATIONS_V1`)는
Cafe24 계정에 종속되지 않는다. 새 AI 로직 0 · 새 Agent architecture 0 · Demo Core UI 0 ·
마이그레이션 0 · 마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · DB 행 변경 0.

---

## 0. 무엇이 문제였나

감사(`full_mvp_channel_capability_audit_v1.md` §2 G1)가 찾은 것은 기능의 부재가 아니라 **범위**였다.
규칙(`OperationsCaseRules`) · 조사(`CaseInvestigator`) · 초안(`InquiryDraftComposer`) · Case 화면 ·
Home · Queue는 **이미 전부 채널 무관**이었고, `discover()`도 `sources.resolve()`를 그대로 돈다.
채널에 묶여 있던 것은 딱 하나, **템플릿의 source 목록**이었다:

```java
CUSTOMER_OPERATIONS_V1(..., List.of(
        new SourceSpec("CAFE24", DataType.INQUIRY),
        new SourceSpec("CAFE24", DataType.REVIEW)), ...)
```

그 결과 활성화 전제(`eligible()`)가 Cafe24 계정을 요구했고, NAVER만 쓰는 판매자는
**`409 NO_ELIGIBLE_SOURCE`로 제품의 canonical goal을 시작조차 할 수 없었다.**

---

## 1. 규칙을 목록으로 바꾸지 않고, 규칙으로 되돌렸다

PD-1(2026-09-15)은 「Cafe24 둘, 그 외 없음」이라고 적었지만 **그 이유는 채널이 아니었다** —
「사람이 버튼을 눌러야 읽히는 것을 정기 의무에 넣으면 매 창이 실패가 아닌 이유로
「확인하지 못함」을 보고한다」였다. 그 논증은 **acquisition mode에 대한 것**이다.

그래서 의무의 기준을 Product Truth의 **acquisition 축**으로 되돌렸다 —
`AUTOMATIC`이면 의무, `SELLER_GUIDED`면 의무가 아니다:

| source | acquisition | 의무 |
|---|---|---|
| CAFE24 INQUIRY · CAFE24 REVIEW | 공식 게시판 API · AUTOMATIC | **포함**(기존 그대로) |
| NAVER INQUIRY | 공식 문의 두 리소스 · AUTOMATIC | **추가** |
| COUPANG INQUIRY | 공식 `onlineInquiries` · AUTOMATIC | **추가** |
| NAVER REVIEW | export / 기기 읽기 · SELLER_GUIDED | **제외**(그대로, `deviceRecipes`) |
| COUPANG REVIEW | Action Window · SELLER_GUIDED | **제외**(그대로, `deviceRecipes`) |

**PD-1의 결론은 유지되고 그 적용 범위만 세 채널로 넓어졌다.** 리뷰 두 개는 여전히 의무가 아니며,
그것을 테스트가 이름으로 고정한다(`theTemplateObligesEverySourceTheProductCanCollectWithoutAPerson_andNoOther`).

**톡톡은 목록에 없다** — 공식 API가 없어 `DataType.INQUIRY` 수집이 돌려주지 않는다.
없는 것을 제외 규칙으로 적지 않고, 수집이 답하지 않는 것으로 둔다.

---

## 2. 넓힌 것은 관측뿐이다 — capability 천장은 그대로

> **Equal reach is not equal capability.**

source를 넓히면 **무엇이 관측되는가**가 바뀌고, 그 외에는 아무것도 바뀌지 않는다.
무엇을 초안으로 쓸 수 있고, 승인할 수 있고, 보낼 수 있고, 보낸 뒤 확인할 수 있는지는
기존 capability truth가 그대로 정한다 — 이 패키지는 그 어느 것도 건드리지 않았다:

- `InquiryReplyCapabilityRegistry` — 채널 × subtype별 전송 계약(쿠팡 문의 답변은 구현됨·라이브 미실행)
- `ReviewExecutionCapability` — NAVER guided · CAFE24 API(쓰기 동의 필요) · **그 외 `CHANNEL_UNSUPPORTED`**
- `ReviewTriageChannelCapability.replyFlowExists()` — **NAVER·CAFE24만 true**

그래서 **쿠팡 문의 Case는 초안까지 가고 쿠팡이 멈추는 곳에서 멈추며, 쿠팡 리뷰는 Case가 되어도
초안이 없다**(`ReviewReplyService.authorize()`가 409로 거절한다 — 채널에 기능이 없기 때문이지
스위치가 꺼져서가 아니다).

---

## 3. capability 게이트 — 커넥터의 「못 읽는다」와 커넥터의 부재는 다른 답이다

source가 한 채널의 것이 아니게 되자 새 경우가 생긴다: 판매자가 NAVER 계정을 갖고 있는데
이 배포가 NAVER 문의 lane을 제공하지 않는 경우. 그때 의무로 두면 **아무도 손쓸 수 없는 실패**가
매 창 기록된다 — PD-1이 경고한 바로 그 모양이다.

그래서 `ResponsibilitySources.resolve()`가 후보를 source로 만들기 전에 한 번 묻는다:

| 커넥터 상태 | 결과 | 이유 |
|---|---|---|
| 있고 「그 유형 지원」 | source로 **유지** | 평범한 경우 |
| 있고 「그 유형 미지원」 | **제외** | 커넥터가 질문에 **답했다**. 약속하지 않으므로 관측·보고·gap Case 모두 없다 |
| **없음**(모든 커넥터 플래그 off = 평범한 로컬 기동) | source로 **유지** | 부재는 답이 아니다. 여기서 제외하면 멀쩡한 채널을 가진 조직에게서 책임을 조용히 빼앗는다 |

세 번째 줄이 이 규칙의 핵심이고, 없었다면 기본 부팅에서 Cafe24 조직의 활성화가 깨졌을 것이다.
네 경우를 `ResponsibilitySourcesCapabilityGateTest`가 고정한다.

---

## 4. 판매자가 보는 것

- **활성화 거절 문구가 채널을 부르지 않는다** — 「고객 운영 관리를 시작하려면 **판매 채널**을 먼저
  연결해 주세요」 + `[판매 채널 연결하기]` → `/connect`. 이전에는 「Cafe24를 먼저 연결해 주세요」 +
  `/connect/cafe24`라, NAVER 판매자를 없는 쇼핑몰로 보냈다.
- **맡긴 일의 범위가 그 판매자의 것이 된다** — `ResponsibilityView.scope`가 템플릿 전체가 아니라
  **이 조직이 실제로 가진 source**를 싣는다. 아직 아무것도 연결하지 않은 조직 하나만 후보 목록으로
  떨어지는데, 그 화면은 마침 「채널을 먼저 연결해 주세요」를 말하고 있는 그 화면이다.
- **연결 끊김 Case의 링크가 그 채널로 간다** — `/connect/naver` · `/connect/coupang` · `/connect/cafe24`.
  이전에는 Cafe24만 자기 화면으로 가고 나머지는 목록으로 갔다.
- **NAVER 과거 리뷰 답글 줄의 모순이 사라졌다** — 같은 줄에 「가져오지 못함」 배지와
  「…읽어 옵니다」 문장이 함께 있었다. M5(2026-09-18)가 그 읽기를 증명했고 답글은
  `seller_reply_body`(source `NAVER_REVIEW_DETAIL_V1`)에 저장돼 `LearnedKnowledgeService`가 인용한다 ⇒
  새 값 **`SCREEN_READ`**: 공식 경로는 없지만 이 제품이 도우미로 판매자센터 상세를 열어 읽는다.
  `LEARNED`와 합치지 않은 이유는 `LEARNED`가 「판매자가 아무것도 하지 않아도 되는 공식 경로」를
  약속하기 때문이고, 이 읽기는 도우미를 필요로 한다.

---

## 5. Product Truth — Customer Operations와 새 5축

### 구현: `FEATURE.CUSTOMER_OPERATIONS` 한 행

고객 운영 관리는 **채널 × 객체가 아니다**. 어떤 채널을 연결했든 같은 한 벌의 행동이고 조직 단위로
맡기고 멈춘다 — `ProductFeature`가 정확히 그런 것을 위해 만들어졌다(「channel과 object를 요구해
구조적으로 담을 자리가 없던 것」). 그래서 `features.yaml`에 한 행을 넣었다:
`status: SUPPORTED · evidence: IMPLEMENTED`(실제 판매자 조직에서 계속 돌아간 기록이 아직 없어
`LIVE_PROVEN`을 쓰지 않는다), 채널별 천장을 그대로 따른다는 것을 limitation으로 적는다.

### 제시: 새 5축은 격자에 올리지 **않는다**

주문 결합 · 확인할 일 생성 · Knowledge 활용 · 승인 · 완료 확인을 `ProductCapabilityAxis`로 만들면:

- coverage 규칙이 **채널 × 객체 × 축 전부**를 요구하므로 **60행**이 늘고(48 → 108),
  그중 30행은 「네이버 주문에는 승인 단계가 없다」류의 지어낸 행이 된다;
- `ProductCapabilityMode`의 축별 허용 목록과 「`requirements`는 EXECUTION 전용」 규칙이 **함께 열린다** —
  승인의 mode가 무엇인지, 완료 확인의 mode가 무엇인지 새 어휘를 10개쯤 만들어야 한다;
- 렌더러가 4열 헤더를 문자열로 갖고 있어 표가 깨진다(`ProductTruthReport`);
- 그리고 `SUMMARY_AXES`가 ACQUISITION·EXECUTION만 남기므로 **「뭘 할 수 있어?」에는 보이지도 않는다.**

그래서 다섯은 **그 한 feature 행의 단계**로 표현하고, 축으로 만들지 않은 이유를 yaml 주석과 이 절에
적어 둔다. 채널별로 갈라야 할 필요가 관측되면 그때 다시 정한다.

### 값을 치른 것 — 남은 여유 1줄

`PRODUCT_OVERVIEW` 계획의 사실 수가 **66 → 67**이 됐다. floor 상한은 80이고 runtime overlay가 12줄을
쓰므로 **67 + 12 = 79 ≤ 80**, 즉 **남은 여유는 1줄**이다. 다음 한 행을 더하면 이 계획이 상한을 넘고,
그때 판매자가 보는 것은 오류가 아니라 **근거 있는 답이 옛 조립 답으로 조용히 바뀌는 것**이다.
`ProductTruthConverseFloorTest`가 그 숫자를 단언하고, 그 다음 선택(무엇을 좁힐지 / 상한을 올릴지)은
**product-owner 결정**이다.

---

## 6. 검증

| | |
|---|---|
| backend | **4,757 tests · 실패 0** |
| frontend | **3,077 tests · 실패 0** · `tsc --noEmit` clean |
| agent-runtime | **1,053 tests · 실패 0** (23 skipped) |

**계약이 바뀌어 테스트 2건을 다시 썼고, 둘 다 단언이 늘었다**(안전 테스트 약화 0):

- `ResponsibilityWindowsTest` — 「정확히 Cafe24 둘」이라는 **목록**을 단언하던 것이 이제 **규칙**을
  단언한다: AUTOMATIC source 전부가 있고, SELLER_GUIDED 리뷰 둘은 여전히 거부되며 device recipe로
  남아 있고, ORDER·PRODUCT는 이 책임의 것이 아니다.
- `CustomerOperations.test.tsx` — 「Cafe24를 먼저 연결해 주세요」 + `/connect/cafe24`를 단언하던 것이
  **어떤 채널 이름도 문장에 없을 것**을 단언하고, 판매자 자신의 source가 화면에 뜨는 검사를 새로 얻었다.

**새 테스트 1건** — `ResponsibilitySourcesCapabilityGateTest`(4): 레지스트리 없음 · 커넥터가 일부만
지원 · 커넥터 부재 · 커넥터가 우리가 묻는 것을 하나도 지원하지 않음. 이 테스트는 옛 코드에서
컴파일되지 않는다(3-인자 생성자가 없었다) — 「옛 코드에서 빨개지는 것을 확인했다」고 적지 않는다.

**재생성된 산출물 3건**: `docs/product_truth_matrix.md` · `contracts/product-truth/v1/ledger.json` ·
`contracts/product-truth/v1/converse-facts.json`(각각의 regenerate-and-fail 테스트가 다시 썼다).

---

## 7. 고치지 않고 보고한 것

- **라이브 미실행.** NAVER·COUPANG 문의가 실제로 확인할 일이 되는 것은 기존 라이브 기록
  (§24·§25, 2026-09-17/18)이 각각 증명했지만, **세 채널이 한 조직에서 동시에 한 창을 도는 것은
  관측된 적이 없다.** 이 패키지는 마켓플레이스를 호출하지 않았다.
- **쿠팡 문의 Case의 끝은 여전히 초안이다** — 답변 adapter는 구현됐고 라이브 실행이 0이며,
  `reply-by`와 단일 사용 승인이 필요하다(감사 §2 G7).
- **리뷰 lane의 천장은 그대로** `RECOMMENDATION_ONLY`다(감사 §2 G2). 이 패키지는 리뷰 Case가
  세 채널에서 생기게 했을 뿐, 답글을 보낼 수 있게 만들지 않았다.
- **`FEATURE.PROACTIVE_OPERATIONS`와의 중복** — 두 행 모두 「미리 준비해 둔다」를 말하고 세 selection
  plan에 함께 실린다. 은퇴시킬지 승계시킬지는 **product-owner 결정**이라 그대로 두었다.
- **원장의 남은 여유 1줄**(§5).
- 주문 결합은 여전히 어느 채널에서도 실제 문의 위에서 돌지 않았다(감사 §2 G4).
