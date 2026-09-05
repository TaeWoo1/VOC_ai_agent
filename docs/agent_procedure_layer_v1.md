# Agent Procedure Layer v1

**2026-09-06 · `frontend/` + `agent-runtime/` · backend 소스 변경 0 · 마이그레이션 0 ·
마켓플레이스 호출 0 · WRITE 0 · 승인 0 ⇒ evidence 행 없음.**

`docs/agent_runtime_architecture_audit_v1.md`의 결론 **B**를 실행한다. 새 framework가 아니라,
plan과 answer 사이에 흩어져 있던 **같은 판단**을 한 곳씩으로 모은다. Planner · NeedKind(14) ·
specialist(5) · tool(31, 전부 READ) · artifact(24) · `ActiveTask`(5) · 승인 경계 · 프롬프트는
**한 글자도 바뀌지 않았다**.

---

## 1. WorldState — turn당 한 번

`src/operator/state/WorldState.ts`. **필드는 넷이고, 그 넷은 trace가 고른 것이다.**

```ts
interface WorldState {
  readiness: SellerReadiness;   // UNKNOWN | NO_CHANNEL | NO_DATA | WORKING (+ connected/connectable/delegable)
  anchor: "INQUIRY" | "REVIEW" | "PRODUCT" | null;   // 대화가 서 있는 객체의 종류
  activeTask: ActiveTask | null;                     // 진행 중인 절차의 단계
  coverage: readonly ChannelCoverageRow[] | null;    // 이 turn의 스냅샷 — 두 번째 읽기를 없애기 위한 것
}
```

**넣지 않은 것**과 이유: 행·id·고객 문장(객체별 질문의 답이고, 묻는 lane이 읽는다) · 채널별 실행
capability(객체별이고 turn마다 필요하지 않다) · freshness(다른 축이고 `ChannelDataState`가 이미 소유).

**lazy이고 공유된다.** 말투 수정이나 서수 선택처럼 「이 판매자가 무엇을 가질 수 있나」를 묻지 않는
turn은 읽기를 사지 않는다. 묻는 lane은 전부 **같은 값**을 본다.

**Planner에게 가는 것은 닫힌 enum 한 줄뿐이다** — `판매자 상태: NO_CHANNEL|NO_DATA|WORKING`.
채널 이름 0 · 숫자 0 · id 0 · 고객 문장 0이고, `UNKNOWN`은 **아무것도 보내지 않는다**(읽지 못한 상태는
주장할 상태가 아니다). 지시문도 넣지 않았다 — 프롬프트는 백엔드의 것이고, `priorContext`에 지시를 쓰는
caller는 두 번째 프롬프트다. **하류는 planner가 이 줄을 존중하는지에 의존하지 않는다**: 연결 0인
판매자의 답은 같은 world에서 procedure가 정하고, 이 줄은 경제성이지 정확성 경로가 아니다.

착수 근거(감사 §1): 같은 문장에 대해 연결 0인 org와 3채널 org의 plan이 `needs 2 vs 3 · specialists
2 vs 2`로 사실상 동일했다 — 구별할 입력이 wire에 없었기 때문이다.

---

## 2. Procedure — 여섯 개, 엔진 0

`src/operator/procedure/Procedure.ts`. Procedure는 클래스도 DSL도 graph도 아니고 **record**다:
`precondition(world) → { ok } | { ok: false, absence }`, 그리고 그 실패에 붙는 **next step 하나**.

| id | 절차 | 이 layer가 소유하는 판단 |
|---|---|---|
| `ONBOARD_CHANNEL` | 판매 채널 연결 | 연결이 없다 ⇒ 유일한 다음 단계 |
| `DAILY_WORK` | 오늘 할 일 | 빈 체크리스트가 **무엇을 뜻하는가** |
| `ANSWER_INQUIRY` | 문의 답변 준비 → 승인 → 전송 | 이 문의가 지금 초안을 받을 수 있는가 |
| `ANSWER_REVIEW` | 리뷰 답글 준비 → 승인 → 실행 | 이 채널이 답글을 받을 수 있는가 |
| `CAPTURE_KNOWLEDGE` | 빠진 기준을 묻고 저장하고 재개 | (기존 `PendingKnowledgeCapture`가 이미 절차다 — 재사용) |
| `IMPROVE_FROM_ISSUES` | 반복 문제 → 개선 기회 | (상태 없음 — specialist로 남는 것이 옳다) |

**`AbsenceReason`은 닫힌 여섯이고, 그중 하나만 가게에 대한 주장이다:**
`NO_CHANNEL` · `NO_DATA_YET` · **`ZERO_MEASURED`** · `NOT_ACTIONABLE` · `NOT_SUPPORTED` · `UNKNOWN`.

이것이 `ChannelDataState`가 자기 docblock에 오래 적어 두고 아무도 강제하지 않던 규칙을 **실행 가능한
코드**로 만든 것이다 — 「`ZERO`는 가장 드문 값이다. 「없습니다」라고 말할 수 있는 유일한 상태다」.

**의도적으로 넣지 않은 것 둘:**
- `inquiryDraftPrecondition`은 `operationalPrecondition`을 **묻지 않는다**. 객체를 손에 쥐고 있다는 것이
  곧 출처의 증거이므로, 여기서 world를 물으면 인자가 이미 증명한 것을 확인하려고 읽기를 산다.
- 이 layer는 **판매자의 문장을 한 글자도 읽지 않는다**(§D 구조 테스트가 `RegExp`·`.test(`·`.includes(`·
  `goalText`의 부재를 코드에서 단언한다). 입력은 world와 객체별 verdict뿐이다.

---

## 3. 제거된 중복 판단

| 판단 | before | after |
|---|---|---|
| **readiness** (coverage → 이 판매자가 무엇을 가질 수 있나) | **4**: compose의 memo · acquisitionStep의 자체 read · capability 답변 · (FE) `firstConnectionState` | **1**: turn의 `WorldState` — acquisitionStep은 그 스냅샷의 행을 받고, FE의 셋째 파생은 삭제됐다 |
| **absence 문장** (「없습니다」/「연결하시면」) | **3** 문장이 3곳 | **1**: `absenceSentence` — 세 리터럴 전부 `Procedure.ts`에만 존재(구조 테스트) |
| **connect step 라벨** | **2**: `CONNECT_ACTION`(chat) · checklist item 조립 | **1**: `CONNECT_STEP`, `CONNECT_ACTION`은 re-export |
| **문의 초안 전제** | **3**곳이 `actionability !== "DRAFTABLE"`을 각자 비교 | **1**: `inquiryDraftPrecondition`, 호출 2 + capture resume |
| **리뷰 초안 전제** | **2**곳 — 그리고 **말투 수정 lane은 아예 묻지 않았다** | **1**: `reviewDraftPrecondition`, 호출 2 · 거절 화면은 `reviewRefusal` 하나 |
| **「없습니다」를 말할 자격** | 암묵 | **1**: `honestZero(items, findings)` |
| (FE) **「연결된 것이 있나」** | **2**: `firstConnectionState.ts` · `homeFirstUse.ts` | **1**: `hasAnyConnectedChannel = homeFirstUseState(...).kind !== "NO_CHANNEL"`, 옛 파일 삭제 |

**FE와 runtime의 수렴은 절반이고 그렇게 적는다.** 두 파생은 **서로 다른 엔드포인트**를 읽는다 —
FE는 화면에 이미 있는 `metrics.channels`, runtime은 `GET /api/channels/coverage` — 그리고
`frontend/`와 `agent-runtime/`은 **공유 모듈이 없는 별도 패키지**다(`contracts/`는 어느 쪽에도 빌드되지
않는다). 코드를 공유할 수 없으므로 **규칙을 공유했다**: 세 줄짜리 규칙표를 양쪽 테스트가 같은 형태로
고정하고, 각자 상대 모듈을 이름으로 가리킨다. 한쪽에서 규칙이 깨지면 그쪽이 빨개진다.

### branch before/after — 정직하게

| | before | after |
|---|---|---|
| `compose()` | 44 if / 457L | **44 if** / 502L |
| `directLane()` | 37 if / 278L | **37 if** / 282L |
| `turnNow()` | 16 if / 261L | **17 if** / 287L (world memo의 `if (worldMemo) return`) |

**분기는 줄지 않았고, 줄 수 없었다.** compose와 directLane의 `if`는 **판단이 아니라 dispatch**다 —
planner의 action 어휘 6개와 화면 위 객체에 대한 닫힌 intent 17개이고, 그것을 줄이는 것은 이번 scope가
금지한 planner/NeedKind rewrite다. 줄어든 것은 §3 표의 **판단 지점**이고, 그것이 이 패키지의 지표다.
compose 안에서는 리뷰 게이트 2 분기가 1로 접혔고(−1), world/notStarted 배선이 +1을 더해 44로 평평하다.

---

## 4. Multi-turn Scenario Eval

`test/scenario/` — 기존 harness(`test/conversation/support.ts`) 위의 **얇은 선언 층**. 진짜
`ConversationService` · 진짜 graph · 진짜 planner + validator가 돌고 **transport만** 가짜다.
**CI는 벤더를 부르지 않는다.**

```ts
scenario("연결 전 판매자의 첫 세 문장", {
  world: "NO_CHANNEL",
  turns: [
    { say: "이 서비스를 통해 할 수 있는 일이 뭐야?",
      expect: { artifacts: ["SUMMARY"], link: "/connect",
                never: ["답변 안 한 문의 보여줘", "별점 낮은 리뷰 보여줘"] } },
    …
  ],
});
```

- **`world`가 1급 축**(`NO_CHANNEL` · `CONNECTED_NO_DATA` · `WORKING`) — 같은 문장을 두 가게에 묻고
  답이 **올바르게 달라지는가**를 단언할 수 있다. 이것이 형식의 존재 이유다.
- **`never`가 `expect`만큼 1급**이고, 판매자가 볼 수 있는 **전부**를 훑는다(message · notes · 모든
  artifact의 제목·줄·항목·라벨 · 제안 칩). 이번 결함의 증상은 전부 「하지 말았어야 할 말」이었다.
- **plan 녹화는 문장을 키로 하는 공유 파일**(`SCENARIO_PLANS`, 2026-09-05 라이브 녹화). 녹화 없는 문장은
  **그 문장을 인쇄하며 실패**한다 — 「한 번 받아 붙인다」가 고치는 방법이 된다.

**최소 검증 4개, 전부 통과** — 그리고 넷 다 **옛 코드에서 빨개지는 것을 확인한 뒤** 남겼다:

| 요구 | 어떻게 | 확인 |
|---|---|---|
| NO_CHANNEL에서 「할 일이 없습니다」 금지 | `never: ["지금 먼저 하실 일은 없습니다"]` | `absenceSentence`를 되돌리자 2건 red |
| follow-up에서 capability 반복 금지 | `never: ["제가 도와드릴 수 있는 일"]`, 두 world 모두 | said-once 규칙을 끄자 red |
| WORKING에게 불필요한 connect CTA 금지 | `noLink: "/connect"` | — |
| 기존 exact-object flow 회귀 0 | `objectFlow.scenario.test.ts` — 목록 → 서수 → 초안 → 말투, `llmCalls: 0` | 6/6 통과 |

구조 불변식은 `test/operator/procedureLayer.test.ts`(§A~§D, 11 assertions)가 **소스 스캔**으로 고정한다 —
문장 하나당 파일 하나, 게이트 하나당 호출부 n개, 그리고 procedure layer가 문장을 읽지 않는다는 것.
docblock은 스캔 전에 제거한다(자기 설명 때문에 실패하는 guard는 고쳐지지 않고 삭제된다).

---

## 5. 라이브 브라우저 확인 (1440×900@2×, headless)

**clean seller(연결 0)** — 제품 자신의 signup으로 만든 일회용 org:

1. 「이 서비스를 통해 할 수 있는 일이 뭐야?」 → 「판매 채널을 연결하시면 문의 · 리뷰 · 주문을 대신
   확인하고…」 + 도메인 4줄 + 상태 1줄 + 경계 1줄, chip = **[판매 채널 연결하기]** 하나
2. 「아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?」 → 「판매 채널을 연결하는 것부터 하시면 됩니다.」 +
   **「시작하는 방법」** 카드(연결 가능 채널 · 안내 · 연결 뒤 무엇이 되는지), **도우미 언급 0**
3. 「뭐부터 하면 되냐고」 → 「아직 연결된 판매 채널이 없어서, 확인해 드릴 자료가 없습니다…」 +
   「지금 하실 일 · 1. 판매 채널 연결하기」, 0건 카드 0

**Demo Org(3채널)** — 같은 세 문장. 그리고 **이 실행이 결함 둘을 새로 드러냈고 같은 세션에서 닫았다:**

- **(A) 연결된 판매자의 두 번째 capability 질문이 카드를 통째로 다시 인쇄했다.** said-once 규칙을
  first-use world에만 쓴 것이 원인. **사실은 어느 가게가 물어도 한 번만 말한다** ⇒
  `alreadySaidAnswer` — 카드 없이 한 문장과 다음 걸음(「네이버 스마트스토어 · 카페24 자사몰 · 쿠팡이
  이미 연결돼 있습니다. 오늘 하실 일부터 정리해 드릴 수 있습니다.」 + 「내가 해야 할 일 정리해줘」).
- **(B) 「지금 먼저 하실 일은 없습니다」 바로 아래에 「답변이 필요한 문의가 24건 있습니다」가 있었다.**
  체크리스트가 빈 이유는 그 run이 list artifact 대신 **findings**를 냈기 때문이고, 빈 체크리스트를
  「측정한 0」으로 읽은 것이 결함이다 ⇒ `honestZero(items, findings)` — **일을 찾은 turn은 그 주장을
  하지 않고**, findings가 답이 된다. 재실행: 「지금 하실 일을 정리했습니다 (2건). 답변이 필요한 문의가
  23건 있습니다…」, 세션 전체에서 그 문장 **0회**.

두 세션 모두 **콘솔 오류 0 · off-host 요청 0**.

---

## 6. 테스트

backend **무변경**(파일 0) · agent-runtime **861 passed / 23 skipped** · frontend **2,762 passed** ·
typecheck 양쪽 clean. **안전 테스트 약화 0**, 재작성 0(계약이 바뀐 곳은 새 단언이 더해졌을 뿐이다).

## 7. 아직 Procedure 밖에 남은 문장 기반 decision

정직하게 전부 적는다. 이번 scope는 「새 keyword exception 추가 금지」였고 **하나도 추가하지 않았지만**,
기존 것을 옮기지도 않았다.

- **planner 앞 결정론 lane 약 30개**(`taskInterpreter` 13표 · `reference` 17표 · `visibleSelection` ·
  `knowledgeCapture` · `freshnessQuestion` · `subjectTerm` · `styleIntent` · `acquisitionRequest` ·
  `channelFocus` · `periodTerm`). 화면 위 객체에 대한 조작이고 계획할 것이 없다 — 감사가 「정당하다」고
  판정한 그대로 유지.
- **planner 뒤 문장 재해석**: `compose` 안 8회(`sentenceSubjectOf` · `effectiveAxisOf` · `focusForAxis` ·
  `channelFocusOf` · `locateBySubject` · `analyzeIntentOf` · `isAcquisitionRequest` · `sellerSentence`),
  operator graph 안 **15개 모듈**이 `goalText`를 읽는다(`ReviewEvidenceSense`의 `NEGATIVE_WORDS` 8개 ·
  `ISSUE_WORDS` 5개, `ProductGrouping`, `inquiryOps`의 검색 query …). **이번 패키지가 건드리지 않았다.**
- **`ConversationService.ts:442`의 `/이 상품/`** — 모듈 밖에 남은 유일한 문장 리터럴.
- 그래서 **`AgentPlanPrompt`의 「the planner is still the only thing that reads the sentence」는 여전히
  사실과 다르다**(감사 §11-1). 주석 한 줄이지만 이 저장소에서 주석은 규율의 기록이므로 다음 패키지의 몫.

## 8. 고치지 않고 보고하는 것

- `checklistOf`는 findings를 읽지 않는다 — §5(B)는 **잘못된 주장을 막았을 뿐** 24건을 체크리스트 항목으로
  만들지는 않는다. 그것은 work-queue semantics이고 이 패키지 밖이다.
- plan 단계는 여전히 turn의 **87~98%**다. world token이 연결 0인 org의 계획을 줄일 수 있는지는
  **라이브 관측이 더 필요하다**(이번 실행에서 planner는 여전히 `LIST_ACTIONS` + 2 specialists를 냈다).
- QA 환경: 이번 브라우저 확인을 위해 일회용 QA org 하나를 `SELLEROPS_AGENT_{PLAN,DRAFT}_ORG_IDS`에
  **추가**하고 backend를 재기동했다(명시 allow-list 유지, `CONNECTED_SELLERS`·global enable 사용 0).
  기존 두 org는 그대로다.
