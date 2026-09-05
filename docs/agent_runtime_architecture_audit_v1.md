# Agent Runtime Architecture Audit v1

**2026-09-06 · HEAD `62cfbc6a` + the uncommitted first-use fix · 코드 변경 0 · 라이브 실행 0 ·
마켓플레이스 0 · 모델 호출 0.**

기능 구현을 멈추고, 반복되는 Agent 품질 defect가 **구조의 성질인지 우연인지**를 코드와 실제 trace로
잰다. 관점은 하나다 — **World State → Goal → Procedure/Skill → Tools → Artifact**.

결론을 먼저 적는다: **B — 작은 Procedure layer를 추가한다.** 근거는 §1~§7, 제안은 §8~§10.

---

## 0. 이 감사가 답해야 했던 질문

직전 Manual QA defect #1(연결 0인 판매자에게 「지금 먼저 하실 일은 없습니다」)은 고쳐졌다. 문제는 그
수정이 **다섯 번째 같은 모양의 수정**이었다는 것이다. 그래서 묻는다: 지금 구조가 문장 하나마다 규칙
하나를 더하는 쪽으로 가고 있는가.

**측정된 답: 그렇다.** 다만 무너지고 있는 것은 planner도 tool layer도 아니고 **plan과 answer 사이의
한 층**이다.

| 지표 | 값 |
|---|---|
| `agent-runtime/src/conversation/` | 2026-08-28 **8 파일 / 2,639줄** → 09-05 **26 파일 / 7,729줄** (8일, ×2.9) |
| `ConversationService.ts` | 08-28 **1,324줄** → 현재 **3,579줄** (커밋 29회) |
| `compose()` | 523줄 · `if` 분기 **47** |
| `directLane()` | 281줄 · `if` 분기 **37** |
| 소스에 적힌 「라이브에서 측정된 결함」 주석 | **124건 / 24파일** |
| 문장을 읽는 결정론 함수(export) | **약 30개** |
| plan 이후에 문장을 다시 읽는 모듈 | **15개** |

마지막 줄이 이 문서의 핵심 발견이다. §5를 보라.

---

## 1. Planner가 실제로 받는 context

`AgentPlanPrompt.user()` (backend) — **wire로 나가는 것은 정확히 셋**이다.

```
목표: <판매자가 친 문장 그대로>
사용 가능한 도구:
  <name>: <설명>          ← 31개, registry에서 보간, 정적
지금까지의 진행:            ← 있을 때만
  n1=SATISFIED n2=PENDING          (re-plan 진행)
  대상 확정: … INQUIRY|PRODUCT …    (화면이 고정한 객체의 KIND만)
  직전 작업 집합: REVIEWS (기간:TODAY, 채널:전체, 평점:ALL, 상태:없음, 상품 특정:예)
  집합 규칙: …                       (고정 지시문)
  직전 선택: INQUIRY|PRODUCT|REVIEW
  직전 준비: INQUIRY_DRAFT|REVIEW_DRAFT
```

payload floor는 `AgentPlanPayloadFloorTest`가 직렬화 바이트로 단언한다. id·row·org·고객 문장 **0**.

**그래서 planner가 볼 수 있는 world state는 「대화가 방금 무엇을 그렸는가」뿐이다.** 판매자가 어떤
회사인지, 채널을 연결했는지, 읽을 수 있는 데이터가 있는지, 어느 채널이 무엇을 지원하는지는 **한 글자도
가지 않는다.**

`GoalRequest`에는 그보다 더 많은 것이 실린다(`productId`·`workItemId`·`referenceDate`·`collected`·
`pendingHumanWindow`·`localAgent`·`channelFocus`). 이것들은 **런타임이 쓰고 모델은 못 본다.** 경계는
의도된 것이고 옳다 — 그러나 **아무도 그 경계 앞에서 「이 계획이 실행 가능한가」를 묻지 않는다**는 것이
defect #1의 구조적 원인이다.

### 실제 trace (2026-09-05, `tools/dev/.run/agent-runtime.log`)

| 문장 | 판매자 | plan | 결과 |
|---|---|---|---|
| 「할 수 있는 일이 뭐야?」 | clean | `needs:0 specialists:0 tools:0` · `EXPLAIN_CAPABILITY` | plan 3,572ms / turn 3,685ms |
| 「어떻게 시작해?」 | clean | **완전히 동일** | plan 3,615ms / turn 3,664ms |
| 「뭐부터 하면 돼?」 | clean | `needs:2 specialists:2 tools:3` · `LIST_ACTIONS` | turn 3,871ms |
| 「뭐부터 하면 돼?」 | **Demo(3채널)** | `needs:3 specialists:2 tools:3` · `LIST_ACTIONS` | turn 8,207ms |

읽어야 할 두 가지:

1. **연결 0인 org와 3채널 org에 대해 planner는 사실상 같은 계획을 세운다.** 세울 수밖에 없다 —
   두 org를 구별할 입력이 없다. 계획은 판매자 상태에 대해 **구조적으로 blind**하다.
2. **plan 단계가 turn의 87~98%다.** (3,572/3,685 · 3,615/3,664 · 6,856/8,207) 이것은
   `agent_responsiveness_v1.md`가 이미 측정한 성질이고 지금도 그대로다.

---

## 2. NeedKind / route / composer / fallback — 수와 역할

### 2.1 어휘 (닫힌 집합, 전부 planner가 채운다)

| 축 | 수 | 값 |
|---|---|---|
| `NeedKind` | **14** | PRODUCT_FACT · PRODUCT_CATALOG · PRODUCT_LISTING · PRODUCT_VARIANT · PRODUCT_KNOWLEDGE_DOC · POLICY · CUSTOMER_HISTORY · REVIEW_SIGNAL · INQUIRY_VOLUME · REPEAT_PATTERN · IMPROVEMENT_OPPORTUNITY · ORDER_HISTORY · COMPANY_PROFILE · PAST_ANSWER |
| `SpecialistName` | **5** | PRODUCT_OPS · REVIEW_OPS · INQUIRY_OPS · ORDER_OPS · REPORT_OPS |
| `RequestedAction` | **6** | NONE · PREPARE_INQUIRY_DRAFT · REQUEST_SEND_APPROVAL · OPEN_WORKSPACE · LIST_ACTIONS · EXPLAIN_CAPABILITY |
| `PlanFilters` 축 | **11** | period · periodDays · rating · channel · scope · topic · reviewIntent · inquiryIntent · limit · order · status |
| Tool (전부 READ) | **31** | `OperatorToolRegistry`가 non-READ 생성을 거부 |
| `Artifact` type | **24** | |
| `OperatorStopReason` | **5** | COMPLETE · BUDGET_EXHAUSTED · NO_PLAN · CLARIFICATION_NEEDED · REPLAN_UNAVAILABLE |

**어휘 자체는 건강하다.** 닫혀 있고, 검증기가 있고, 위반이 거부되며, prompt가 registry에서 보간된다.
NeedKind를 갈아엎을 이유는 이 감사에서 하나도 발견되지 않았다.

### 2.2 route — 문장 하나가 지나는 갈림길

**(A) planner 이전 — `turnNow` + `directLane`: 20개 진입점**

| # | 조건 | 비용 | stopReason |
|---|---|---|---|
| 1 | `request.select` (행 클릭) | READ ≤1 | — |
| 2 | `request.captureDecision` | write 1 | — |
| 3 | `resumeOfTurnId` (수집 완료 확인) | READ n | — |
| 4 | `pendingCapture` + 답변 문장 | write 1 | KNOWLEDGE_CAPTURE |
| 5 | `pendingPrepared` + tone | 초안 1 | TONE_REVISION |
| 6 | tone인데 초안 없음 | 0 | TONE_REVISION |
| 7 | acquisition · AUTOMATIC 채널 | tool 2 | ACQUISITION |
| 8 | acquisition · GUIDED 채널 | 0 | ACQUISITION |
| 9 | freshness 질문 | tool n | FRESHNESS |
| 10 | 지시 대상 없는 참조 | **0** | NO_REFERENT |
| 11 | anchor + analyze | tool n | ADVISORY |
| 12 | anchor + prepare | 초안 1 | DIRECT_PREPARE |
| 13 | anchor + 「이 문의」 | READ ≤1 | SELECTED |
| 14 | anchor + 「이 리뷰」 | READ 1 | SELECTED |
| 15 | 서수 · REVIEWS | READ 1 | SELECTED |
| 16 | 서수 · INQUIRIES | READ ≤1 | SELECTED |
| 17 | visible priority | **0** | (urgency) |
| 18 | visible filter | READ ≤8 | (filter) |
| 19 | label 선택 · 확정 | READ ≤1 | SELECTED |
| 20 | label 선택 · 후보 다수 | 0 | SELECTION_AMBIGUOUS |

전부 **LLM 0회**이고, 하나라도 못 맞추면 `null`을 돌려 planner로 넘긴다. 설계 의도는 명확하고 옳다 —
**화면 위 객체에 대한 조작은 계획할 것이 없다.**

**(B) planner 이후 — `compose`: 결과 모양 11가지**

`FAILED` · `NO_PLAN`(→FAILED) · `CLARIFICATION_NEEDED`(anchored / plain 2가지) · `PREPARE_INQUIRY_DRAFT`
· `REQUEST_SEND_APPROVAL` · `EXPLAIN_CAPABILITY` · `OPEN_WORKSPACE` · `LIST_ACTIONS` · `NONE`(기본
answer 합성) · toneRevision guard · **first-use 빈 답 guard**(이번에 추가).

### 2.3 composer — 판매자가 읽는 문장을 만드는 곳

| composer | 소유 | 위치 |
|---|---|---|
| `headlineOf` + `sellerSentence` + `dedupeNear` | 일반 답변 산문 | ConversationService |
| `sellerWording.ts` | 닫힌 어휘·출처 라벨·발췌 | operator/wording |
| `AssistantCapability` | capability / getting-started | operator/capability |
| `advisory.ts` | 「뭐라고 답할까」 | conversation |
| `DraftPreparer` | 초안 artifact | conversation |
| `freshnessQuestion` + `asOf` + `reviewClaim` | freshness 문장 | conversation |
| `acquisitionSummary` | 수집 영수증 의미 | conversation |
| `inquiryRowsSentence` · `rowsSentence` · `urgencySentence` | 행 집합 문장 | operator/graph |
| `knowledgeCapture.questionFor` | 지식 질문 템플릿 | conversation |
| `notStartedSentence` / `noDataSentence`(FE) / `NOTHING_FOUND_LINE` | **부재 문장 ×3** | 흩어짐 |

마지막 줄이 문제다. **「없다」를 말하는 곳이 최소 세 군데이고 서로를 모른다.**

### 2.4 fallback — 11개, 그러나 대부분은 fallback이 아니라 refusal

| # | 경로 | 성격 |
|---|---|---|
| 1 | `PlannerUnavailableError` 7종 | **refusal** — 대체 planner 없음. `plannerFence.test.ts`가 구현 1개를 고정 |
| 2 | `NO_PLAN` → FAILED | refusal (모델이 이해하고 거절) |
| 3 | `CLARIFICATION_NEEDED` | 되묻기 |
| 4 | plan repair 1회 | 유일한 재시도, 예산에 청구 |
| 5 | specialist throw → `ToolFailure` | 구조화 backstop |
| 6 | `directLane` → `null` | **설계된 fallthrough** (17곳) |
| 7 | `locateBySubject` | PREPARE의 precondition 복구 |
| 8 | `readiness()` catch → `UNKNOWN` | **침묵** |
| 9 | `reviewAcquisitionResult` catch → null | 침묵(산문으로 강등) |
| 10 | `emptyPlan()` | plan 없는 result의 축 기본값 |
| 11 | 27개 `catch` (ConversationService) | 대부분 fail-soft |

**결정론 goal planner는 없다.** v2 계약(`sellerops_operator_graph_v2.md`)이 요구하는 대로다. 이
성질은 지켜지고 있고 이 감사도 지킬 것을 전제한다.

---

## 3. Seller state — planner 앞에 있는 것과 뒤에서 따로 읽히는 것

### planner 앞 (모델이 보는 것)
- 직전 작업 집합의 **kind + 5개 축** · 직전 선택 객체의 **kind** · 직전 준비 초안의 **kind** ·
  고정된 entity의 **kind** · need 진행 상태.
- **끝이다.**

### planner 뒤 (런타임이 따로 읽는 것)

| 사실 | 읽는 곳 | 횟수 |
|---|---|---|
| 채널 coverage | `get_channel_coverage` tool · `acquisitionStep` 자체 read · `listRecentReviews` 응답에 실린 coverage · **`compose`의 readiness memo** | **4곳, 서로 다른 판정** |
| 채널 실행 capability | `capabilityOf` (`reviewCapability`, `listInquiryReplyTransports`, `getPublishCapability`) | 3곳 |
| 문의 actionability | `actionabilityOf` | direct·compose 양쪽 |
| 초안 상태 | `replyApprovalStateOf` · `pendingPrepared` | 2곳 |
| 지식 gap | `GeneratedDraftView.knowledgeGap` | composer 1곳 |
| 대기 중 사람 단계 | `pendingActionsOf` + `syncCompleted` | 2곳 |

그리고 **프론트엔드가 같은 질문에 대한 5번째 답을 갖고 있다**:
`homeFirstUse.ts` · `firstConnectionState.ts` · `firstSourceSummary.ts` · `connectionState.ts` ·
`channelSupport.ts`.

**정직하게 이번 패키지의 결함으로 적는다.** 내가 추가한 `SellerReadiness.ts`는 `homeFirstUse.ts`의
규칙을 **거울처럼 베낀 것이지 공유한 것이 아니다.** 게다가 둘은 **다른 엔드포인트를 읽는다** —
runtime은 `GET /api/channels/coverage`(`ChannelCoverageRow`), FE는 dashboard의 `metrics.channels`
(`ChannelMetricRow`). 오늘은 답이 같고, 한쪽이 바뀌면 조용히 갈라진다. 이것이 §8-1이 존재하는 이유다.

### 그래서 defect #1의 구조적 진술

> **계획은 판매자 상태를 볼 수 없고, 실행은 상태를 네 번 따로 읽으며, 답을 쓰는 층은 그중 어느 것도
> 「이 답이 성립하는가」를 묻는 데 쓰지 않았다.**

「지금 먼저 하실 일은 없습니다」는 **틀린 문장이 아니라 전제를 확인하지 않은 문장**이었다.
`ChannelDataState`의 자기 docblock이 이미 규칙을 적고 있었다 — 「`ZERO`만이 없습니다라고 말할 수 있는
상태다」. 코드는 그 규칙을 알고 있었고, 그것을 읽는 사람이 없었다.

---

## 4. 같은 business workflow가 여러 branch에 흩어진 곳

### 4-A. 문의 답변 초안 — **진입점 5개**

| 위치 | 경로 |
|---|---|
| `directLane` ANALYZE (DRAFTABLE anchor) | → `directPrepare` |
| `directLane` PREPARE intent | → `directPrepare` |
| `compose` `PREPARE_INQUIRY_DRAFT` | → `DraftPreparer` 직접 (L765) |
| `reviseTone` | → `DraftPreparer` 직접 (L2187) |
| `captureAnswerLane` 저장 후 resume | → `DraftPreparer` 직접 (L1250) |

전부 결국 `POST /api/inquiries/{id}/draft/generate` **한 엔드포인트**에 닿는다(레거시 `/api/agent-runs`
lane도 `ComposerDraftProvider`로 위임돼 같은 곳으로 간다 — 그 통합은 이미 §30에서 끝났다). 그런데
**「초안을 준비한다」의 전제(actionability · capability · gap · tone)를 확인하는 코드는 다섯 벌**이고,
`prepareOneInquiry` 하나만 공유된다.

### 4-B. 「없다」의 판정 — **최소 3벌**
`notStartedSentence`(runtime, 새것) · `noDataSentence`(FE) · `NOTHING_FOUND_LINE`(advisory) ·
그리고 각 specialist의 `NeedState.coverage` 기반 부재 판정.

### 4-C. 채널 freshness/capability — **4벌** (§3의 표)

### 4-D. 리뷰 답글 — 문의와 같은 lifecycle을 **별도 분기**로 다시 씀
`compose`의 PREPARE 안에 `resolved.kind === "REVIEW"` 분기, `reviseTone`에 `REVIEW_DRAFT` 분기,
`inspectReview`가 `inspect`와 나란히 존재. 두 객체의 lifecycle은 실제로 다르지만(리뷰는 anchor가
되되 이름이 없고, 실행 경로가 채널마다 다르다) **그 차이가 어디인지 선언된 곳이 없다.**

### 4-E. 수집(acquisition) — **3벌**
`directLane`의 acquisition lane · `freshnessQuestion`의 waiting 분기 · `reviewRows`의 자동 refresh.
셋 다 같은 capability 판정과 같은 `HUMAN_ACTION_REQUIRED` artifact를 만든다.

---

## 5. user phrase별 예외 / keyword rule이 실제로 있는 곳

**전부 있다. 그리고 대부분은 정당하다.** 문제는 위치다.

### 5-1. planner **앞**의 결정론 문장 읽기 — 정당
`taskInterpreter`(13표) · `reference`(17표) · `visibleSelection`(8표) · `knowledgeCapture`(8표) ·
`freshnessQuestion`(6표) · `subjectTerm`(5표) · `styleIntent`(3표) · `acquisitionRequest`(4표) ·
`channelFocus`(3표) · `periodTerm`.

이것들은 **화면 위 객체에 대한 조작**을 읽는다. 계획할 것이 없는 행위이고, 실측으로 6~29ms이며 LLM 0회다.
「닫힌 표 · 못 읽으면 planner로」라는 규율이 지켜지고 있고, 문장별 분기가 아니라 어휘 가족이다.
**여기는 문제가 아니다.**

### 5-2. planner **뒤**의 문장 재해석 — **여기가 문제다**

`compose()` 안에서 판매자 문장이 **8번 더** 읽힌다:
`sentenceSubjectOf` · `effectiveAxisOf` · `focusForAxis` · `channelFocusOf` · `locateBySubject` ·
`analyzeIntentOf` · `isAcquisitionRequest` · `sellerSentence`.

그리고 **operator graph 안쪽에서 15개 모듈이 `goalText`를 읽는다**:

- `ReviewEvidenceSense.senseOf` — `NEGATIVE_WORDS` 8개 · `ISSUE_WORDS` 5개로 리뷰 근거의 의미를 정함
- `ProductGrouping.groupingOf` — 「상품별」·「채널별」을 문장에서 읽음
- `inquiryOps` — `goalText`를 검색 query로, subject term 추출로
- `reviewRows` — `isAcquisitionRequest`를 **다시** 호출
- `scopeOverride.effectiveAxisOf` — `namesOwnObject`·`hasRefineExpression`
- `OperationalDefaults` · `inquiryWorkloadStep` · `inquiryRowsStep` · `specialistInput` …

**그 결과 `AgentPlanPrompt`의 docblock 한 문장이 사실과 다르다:**

> *"None of this is interpreted by keyword anywhere else — the planner is still the only thing that
> reads the sentence."*

**틀렸다.** 계획 앞에서 30개 함수가, 계획 뒤에서 15개 모듈이 같은 문장을 읽는다. 이것은 규율 위반이
아니라 **규율이 표현할 자리를 못 찾은 것**이다 — plan은 「무엇을 알아내야 하는가」만 담고, 「그 사실을
어떤 모양으로 말할 것인가」를 담는 칸이 없으므로 하류가 문장으로 되돌아가 그것을 다시 정한다.

### 5-3. 실제 하드코드된 판매자 문구 — **1개**
`ConversationService.ts:442` `const saysThisProduct = /이 상품/.test(text)`. 나머지는 전부 모듈화된
어휘 표다. 문장별 canned reply는 **0개**이고, 이 규율은 지켜지고 있다.

---

## 6. 이미 Procedure처럼 동작하는 흐름

각 흐름을 「선언된 절차인가 / 흩어진 분기인가」로 판정한다.

| 흐름 | 상태 | 실체 | 판정 |
|---|---|---|---|
| **knowledge gap** | **가장 절차에 가깝다** | `PendingKnowledgeCapture`가 대화에 영속되고 `state`·`resume`(`INQUIRY_NOT_ACTIONABLE`·`DRAFT_STILL_GAP` …)·`candidate`·`captureId`를 든다. 질문은 scope×topic 닫힌 템플릿, 답변 판정은 닫힌 cue, 저장은 단일 writer(`KnowledgeCaptureWriter`), 저장 후 **원래 일을 한 번** 재개 | **이미 Procedure다. 이름만 없다.** |
| **collect(acquisition)** | 절차이되 3벌 | capability(AUTOMATIC/GUIDED) → step artifact → `pendingHumanActions` 영속 → `syncCompleted` → 영수증. 상태 전이가 명확하고 재개 가능 | **Procedure인데 세 곳에 복제** |
| **inquiry 답변** | 절반 | inspect→prepare→revise→approve→execute의 상태는 `activeTask` 5값으로 **이미 선언돼 있다**(`INSPECT`·`PREPARE_REPLY`·`REVISE_DRAFT`·`CAPTURE_KNOWLEDGE`·`APPROVE_REPLY`). 그런데 **그 값을 읽어 다음 단계를 정하는 코드가 없다** — 매 turn 분기가 처음부터 다시 판정 | **절차의 이름표만 있고 절차가 없다** |
| **review 답변** | 절반 | 같은 lifecycle을 별도 분기로. `pendingPrepared.kind`로만 구분 | 위와 같음 |
| **onboarding** | **없었다 → 방금 생김** | `SellerReadiness` 3상태 + `CONNECT_ACTION` + first-use guard. 아직 「절차」가 아니라 세 lane이 각자 같은 판정을 부르는 모양 | **가장 새것이고 가장 취약** |
| **opportunity** | 절차 아님 (맞다) | `reviewOpportunities` — 순수 READ + 결정론 도출. 상태가 없다 | **specialist로 남는 것이 옳다** |
| **report** | 절차 아님 (맞다) | `reportOpsNode` — 다른 specialist의 findings만 봄. tool 0 | **그대로 둔다** |

**결정적 관찰:** `ActiveTask`는 **이미 존재하는 procedure 상태 머신**이다. 대화에 영속되고, 화면의
ContextBar가 그리고, 5개 값이 정확히 문의/리뷰 답변 절차의 단계다. **그런데 이 저장소에서 그 값을
읽어 「다음에 무엇이 가능한가」를 결정하는 곳은 없다.** 매 turn이 `directLane`의 20개 조건과 `compose`의
47개 분기를 처음부터 통과한다.

---

## 7. 공개적으로 검증된 hybrid agent 패턴 — 그리고 reviewnary의 위치

세 갈래의 공개 지침이 같은 모양으로 수렴한다.

1. **Anthropic, *Building effective agents*** — workflow(정해진 경로)와 agent(모델이 경로를 정함)를
   **구분해서 고르라**는 것이 논지다. prompt chaining · routing · orchestrator-workers ·
   evaluator-optimizer는 전부 **경로가 코드에 있는** 패턴이고, 자율 loop는 경로를 예측할 수 없을 때만
   쓴다. 핵심 조언: 가장 단순한 것에서 시작하고, 복잡도가 결과를 개선한다는 것을 **보인 뒤에만** 더하라.
2. **Anthropic, Agent Skills (`SKILL.md` · progressive disclosure)** — 반복되는 절차 지식을
   **이름 붙은 로드 가능한 단위**로 두고, 필요한 turn에만 펼친다. 절차를 프롬프트에 상주시키지 않는다.
3. **OpenAI, *A practical guide to building agents*** — instruction은 **회사가 이미 가진 SOP에서
   유도**하고, guardrail은 **층으로 쌓으며**(관련성/안전 분류기 → tool risk rating → HITL), 오케스트레이션은
   single-agent + tools로 시작해 필요할 때만 manager/handoff로 간다.
4. **LangGraph** (이 저장소가 이미 쓰는 것) — 결정론 edge + `interrupt`/resume + 명시적 state가
   그 자체로 절차 표현이다.

**수렴점 5개와 reviewnary의 현재 상태:**

| 패턴 | 상태 | 근거 |
|---|---|---|
| ① World state를 **모델 앞에서 결정론으로 조립** | **없음** | §1 — planner는 판매자 상태를 못 본다 |
| ② Goal/intent는 모델이 | **있음, 건강함** | 닫힌 스키마 + 검증기 + 유일 planner |
| ③ 반복 업무를 **이름 붙은 절차**로 | **암묵적** | §6 — capture/collect는 절차인데 이름이 없고, inquiry/review는 이름표(`ActiveTask`)만 있고 절차가 없다 |
| ④ typed·permissioned tools | **있음, 모범적** | 31 tools 전부 READ, registry가 구조적으로 강제 |
| ⑤ 층으로 쌓인 guardrail + HITL | **있음, 모범적** | payload floor · evidence scope · judge · 승인 경계 · `interrupt` |
| ⑥ 시나리오 기반 eval | **부분적, 파편화** | §9 |

**즉 reviewnary는 ②④⑤에서 공개 지침보다 앞서 있고, ①③⑥이 비어 있다.** 반복되는 품질 defect는 전부
①과 ③의 자리에서 나온다 — 상태를 못 본 계획, 그리고 전제를 각자 다시 판정하는 분기.

---

## 8. 필요한 최소 구조 (generic framework 아님, NeedKind 무변경)

세 조각. 각각 **새 파일 1~2개**이고, 셋 다 **기존 값을 옮겨 담을 뿐 새 어휘를 만들지 않는다.**

### 8-1. `WorldState` — turn당 한 번, planner **앞에서** 조립

```ts
// agent-runtime/src/operator/state/WorldState.ts  (새 파일 1개)
interface WorldState {
  readonly readiness: SellerReadiness;        // 기존 값 그대로
  readonly channels: readonly ChannelStanding[]; // capabilityOf의 결과, 채널당 1행
  readonly anchor: SelectedObject | null;     // 기존 workingSet에서
  readonly activeTask: ActiveTask | null;     // 기존 대화 상태에서
}
```

- 지금 **4곳이 따로 하는 coverage 판정을 1곳으로** 모은다 (§3).
- `turnNow`에서 goal을 만들기 전에 조립하고, `GoalRequest.conversation`에 실어 graph·specialist·
  compose가 **같은 값**을 본다.
- **프롬프트는 건드리지 않는다** — 아래 8-2의 precondition gate가 같은 문제를 payload 변화 0으로
  해결하기 때문이다.

> **product-owner 결정으로 올리는 선택지:** readiness를 `priorContext`에 **닫힌 토큰 한 줄**로 실으면
> (예: `판매자 상태: NO_CHANNEL (연결된 채널 0)`) planner가 연결 0인 org에 문의·리뷰 조사를 계획하는
> 일 자체가 사라지고 turn당 3.5초를 아낀다. 그러나 그것은 **payload floor가 종류로는 같고 내용으로는
> 넓어지는 변화**다 — 지금까지 나간 것은 「대화가 무엇을 그렸는가」뿐이고, 이것은 「이 회사가 무엇을
> 연결했는가」라는 **판매자 사업에 대한 사실**이다. id·row·고객 문장은 여전히 0이다. 이 감사는
> 이것을 **권고하지 않고 결정으로 올린다.**

### 8-2. `Procedure` — 6개, 새 엔진 없음

Procedure는 클래스도 DSL도 아니고 **record 하나**다.

```ts
// agent-runtime/src/operator/procedure/Procedure.ts  (새 파일 1개)
interface Procedure {
  readonly id: ProcedureId;                 // 6개 닫힌 값
  /** 이 절차가 성립하는가 — 성립하지 않으면 왜 성립하지 않는지가 곧 답이다. */
  precondition(world: WorldState): { ok: true } | { ok: false; because: AbsenceReason };
  /** 다음에 가능한 단계 — 기존 함수들을 가리킬 뿐, 새로 쓰지 않는다. */
  readonly steps: readonly ActiveTask[];
}
```

여섯 개: `ONBOARD` · `ANSWER_INQUIRY` · `ANSWER_REVIEW` · `CAPTURE_KNOWLEDGE` · `COLLECT` ·
`(none)`. 앞의 다섯은 §6이 보인 대로 **이미 존재하는 흐름**이고, `CAPTURE_KNOWLEDGE`와 `COLLECT`는
이미 상태·재개·종결을 가진 진짜 절차다.

**이 층이 하는 일은 정확히 두 가지뿐이다:**

1. **precondition을 한 번만 판정한다.** 「초안을 준비할 수 있는가」(actionability × capability ×
   channel)를 다섯 곳이 각자 묻던 것을 한 곳이 묻는다 (§4-A).
2. **부재를 한 번만 말한다.** `AbsenceReason`은 닫힌 5값 —
   `NO_CHANNEL` · `NO_DATA_YET` · `ZERO_MEASURED` · `NOT_SUPPORTED` · `UNKNOWN` — 이고
   `ChannelDataState`의 규칙(「`ZERO`만이 없습니다라고 말할 수 있다」)을 **실행 가능한 코드**로 만든다.
   §4-B의 3벌이 1벌이 되고, defect #1은 **구조적으로 재발 불가능**해진다.

**하지 않는 것:** 새 라우팅 엔진 · 절차 DSL · 상태 머신 프레임워크 · planner 대체 ·
`directLane`/`compose` 통폐합. `ActiveTask`는 이미 있는 값을 그대로 쓰고, NeedKind·specialist·
tool·artifact·프롬프트는 **한 글자도 바뀌지 않는다.**

**예상 델타:** 새 파일 2~3개 · `ConversationService`에서 **줄어드는** 분기(부재 판정 3벌 → 1,
DraftPreparer 전제 5벌 → 1, coverage 4벌 → 1) · 프론트의 `homeFirstUse`는 그대로 두되 두 파생이
같은 규칙을 참조한다는 것을 테스트가 고정.

### 8-3. `ConversationScenario` — eval (§9)

---

## 9. Multi-turn Agent eval scenario 구조

### 9-1. 지금 있는 것과 없는 것

**있는 것 (그리고 좋은 것):** `test/conversation/support.ts`의 `harness()` + `say()`는 **진짜
`ConversationService` · 진짜 operator graph · 진짜 planner + validator**를 돌리고 **transport만**
가짜다. 이것이 정확히 옳은 층이고, 이미 303번의 turn이 이 위에서 돈다.

**없는 것:**

| 문제 | 실측 |
|---|---|
| 시나리오가 **파일마다 다시 조립**된다 | 38개 파일이 각자 `plansByGoal`을 정의 (105 사용처) |
| plan 녹화가 흩어져 있다 | 공유 `recordedPlans.ts`에 24개, 나머지는 테스트 파일 안 |
| 판매자 상태 fixture가 복제된다 | `coverageRow(...)`를 8개 파일이 각자 조립 |
| 새 QA defect 1건 = **새 파일 1개** | 테스트 파일 97개, 대부분 패키지 이름을 달고 있다 |
| 같은 질문 × 다른 판매자 비교가 **불가능** | world를 바꾸는 축이 fixture 안에 녹아 있다 |

즉 **eval이 없는 것이 아니라, eval이 회귀 테스트의 모양으로만 존재한다.** PO가 defect를 주면
「시나리오에 4줄 추가」가 아니라 「테스트 파일 하나 작성 + plan 녹화 + coverage fixture」가 된다.
이것이 §0의 성장 곡선을 만든 두 번째 원인이다.

### 9-2. 제안하는 형태

```ts
// test/scenario/scenarios/firstUse.scenario.ts
scenario("연결 전 판매자의 첫 세 문장", {
  world: WORLD.NO_CHANNEL,                      // 이름 붙은 판매자 상태 4~5개
  turns: [
    { say: "이 서비스를 통해 할 수 있는 일이 뭐야?",
      expect: { artifacts: ["SUMMARY"], link: "/connect",
                never: ["답변 안 한 문의", "별점 낮은 리뷰"] } },
    { say: "아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?",
      expect: { differsFromPreviousTurn: true, link: "/connect" } },
    { say: "뭐부터 하면 되냐고",
      expect: { artifacts: ["CHECKLIST"], checklistItem: "/connect",
                never: ["지금 먼저 하실 일은 없습니다", "0건"] } },
  ],
});

// 같은 문장, 다른 판매자 — 이것이 이 형식의 존재 이유다
scenario("연결된 판매자의 같은 세 문장", {
  world: WORLD.WORKING_3CH,
  turns: [ /* 같은 say, 다른 expect */ ],
});
```

**핵심 설계 결정 넷:**

1. **`world`가 1급 축이다.** `WORLD.NO_CHANNEL` · `WORLD.CONNECTED_NO_DATA` · `WORLD.WORKING_3CH` ·
   `WORLD.STALE_ONE_CHANNEL` · `WORLD.NO_EXECUTION_CAPABILITY`. **같은 시나리오를 두 world에 돌려
   답이 올바르게 달라지는가를 단언**할 수 있다 — clean seller와 Demo seller의 같은 질문이 정확히 이것이다.
2. **plan 녹화는 문장을 키로 하는 한 파일.** 녹화가 없는 문장은 **테스트가 그 문장을 인쇄하며 실패**해서
   운영자가 라이브에서 한 번 받아 붙이면 끝난다. 지금은 각자 손으로 스키마를 쓴다(`AUTHORED` 24개).
3. **`never`가 `expect`만큼 중요하다.** defect #1의 다섯 증상은 전부 「말하지 말았어야 할 문장을
   말했다」였다. 부정 단언이 시나리오의 1급 필드여야 한다.
4. **`say`/`harness`는 그대로 쓴다.** 새 러너가 아니라 그 위의 **얇은 선언 층**이고, 기존 97개 테스트는
   한 줄도 바뀌지 않는다.

**여기에 더하지 않는 것:** LLM-as-judge · 벤더를 부르는 CI · 자연어 rubric 채점. 이 저장소의 eval은
`knowledge_retrieval_quality_v2.md`가 세운 규율을 따른다 — **CI는 벤더를 부르지 않고**, 라이브 정확도는
별도 harness에서 승인 아래 잰다.

---

## 10. 결론 — **B. 작은 Procedure layer 추가**

### 왜 A가 아닌가
eval만 강화하면 §4의 다섯 겹 초안 경로와 §3의 네 겹 coverage 판정이 그대로 남는다. eval은 defect를
**더 빨리 발견**하게 하지만, 지금 defect가 나오는 이유는 발견이 늦어서가 아니라 **같은 전제를 다섯 곳이
각자 판정하기 때문**이다. 시나리오를 늘리면 통과해야 할 분기가 함께 늘어난다. 다만 **§9는 B의 일부로
반드시 함께 한다** — A의 내용은 버리는 것이 아니라 흡수된다.

### 왜 C가 아닌가
architecture refactor를 정당화할 만한 것이 **아무것도 발견되지 않았다.** planner 계약(§1)은 건강하고,
tool layer(31 READ + 구조적 강제)는 모범적이며, guardrail·승인 경계·evidence scope·payload floor는
공개 지침보다 앞서 있다. NeedKind 14개는 실제로 서로 다른 증거를 가리키고 있고 교체 근거가 없다.
`ConversationService`가 3,579줄인 것은 **아키텍처가 틀려서가 아니라 절차 층이 없어서 절차가
분기로 표현됐기 때문**이다. 3,579줄을 재설계하는 것과 그중 부재 판정·초안 전제·coverage 판정을
꺼내는 것은 다른 작업이고, 후자로 충분하다는 것이 이 감사의 판정이다.

### B의 범위 (이 문서가 승인 요청하는 것이 아니라, 제안하는 것)

| 순서 | 내용 | 크기 |
|---|---|---|
| 1 | `ConversationScenario` + `WORLD` fixture + 공유 plan 녹화 | 새 파일 2~3, 기존 테스트 무변경 |
| 2 | 이번 defect의 6개 시나리오를 그 형식으로 (clean × Demo) | 시나리오 파일 1 |
| 3 | `WorldState` — coverage 판정 4벌 → 1벌 | 새 파일 1, 삭제 3곳 |
| 4 | `AbsenceReason` — 부재 문장 3벌 → 1벌 | 새 파일 1(또는 3에 포함) |
| 5 | `Procedure.precondition` — 초안 전제 5벌 → 1벌 | 새 파일 1 |
| 6 | `ActiveTask`를 읽는 쪽으로 (지금은 쓰기만 함) | 기존 분기 축소 |

**불변으로 유지:** LLM planner 단일성 · 결정론 goal planner 0 · NeedKind 14 · specialist 5 ·
tool 31 READ · artifact 24 · payload floor · 승인 경계 · marketplace WRITE 0 · `directLane`의
「닫힌 표, 못 읽으면 planner로」 규율.

---

## 11. 이 감사가 고치지 않고 보고하는 것

1. **`AgentPlanPrompt` docblock의 사실 오류** — 「the planner is still the only thing that reads the
   sentence」는 틀렸다(§5-2: 앞 30 함수 · 뒤 15 모듈). 주석 한 줄이지만, 이 저장소에서 주석은 규율의
   기록이므로 다음 패키지가 고쳐야 한다.
2. **`SellerReadiness`와 `homeFirstUse`가 다른 엔드포인트를 읽는다** (§3). 오늘 답이 같고 내일
   갈라질 수 있다. §8-1이 닫는다.
3. **plan 단계가 turn의 87~98%** — `agent_responsiveness_v1.md` §7이 「남은 가장 큰 지렛대」로 올린
   **모델 교체**는 `planner_model_benchmark_v1.md`에서 측정됐고 **기본값 무변경**으로 끝났다.
   §8-1의 선택지(readiness를 계획에 알림)는 연결 0인 org에서 계획 호출 자체를 없앨 수 있는 유일한
   경로이므로, 지연 문제와 같은 결정에 묶인다.
4. **`ConversationService.ts:442`의 `/이 상품/`** — 유일하게 모듈 밖에 남은 문장 리터럴.
5. **테스트 파일 97개가 대부분 패키지 이름을 달고 있다.** 회귀 가치는 실재하나, 「이 제품이 무엇을
   보장하는가」를 읽을 수 있는 목록은 아니다. §9-2가 그 목록을 만들 자리다.

**마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · DB 변경 0 · 마이그레이션 0 · 코드 변경 0**
⇒ evidence 행 없음. localhost 스택은 그대로 유지.
