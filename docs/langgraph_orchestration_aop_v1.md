# LangGraph Orchestration Migration + AOP Runtime Core v1

**2026-09-06 · HEAD `b813316f` 기준 · Planner benchmark 결과와 prompt v16은 FREEZE.**

reviewnary의 Agent architecture를 **바꾸지 않는다.** WorldState · Planner · Procedure semantics ·
NeedKind · typed tools · Evidence · Knowledge/RAG · structured artifacts · Approval · Executor
fences · Helper는 그대로다. 옮긴 것은 **custom conversation orchestration** 하나다.

**결론 먼저:** turn 실행 · 상태 전이 · procedure routing · resume · subgraph orchestration은 이제
LangGraph가 소유한다. 기존 스위트 **913 통과 · 실패 0**이고, 실 planner 라이브 parity는 **정확히
동일**하다 — selection 46/48, holdout 13/14, 실패한 turn 집합이 이관 전과 **문자 그대로 같고 새로
깨진 것 0**. dual runtime은 남기지 않았다: 옛 orchestration은 이 커밋에서 실제로 사라졌다.

---

## 0. 먼저 — 개발용 AI quota

`sellerops.agent.quota.enabled`는 「기록하는가」, 새 **`enforced`**는 「거절할 수 있는가」다.
하나였을 때의 결함은 이름 붙일 값이 있다: **한도를 끄면 계량기까지 꺼졌다.** 벤치마크나 수동 QA를
위해 한도를 끈 sitting이 usage·latency·cost 숫자를 가장 필요로 하는 sitting이었는데, 바로 그때
usage 행이 하나도 쓰이지 않았다. 대신 한도를 **올리면** 첫 pass의 일부가 모델이 아니라 할당량을
재게 된다(직전 벤치마크가 실제로 그랬다).

- `enforced=false` ⇒ 모든 호출이 계량되고 어떤 호출도 거절되지 않는다. **local/manual-QA/benchmark**.
- 기본값은 **`true`** ⇒ production/pilot은 아무것도 설정하지 않아도 예전과 같다.
- **거절된 호출은 여전히 기록하지 않는다** — 일어나지 않은 호출이고, 그것을 세는 계량기는 벤더가
  청구하지 않은 지출을 보고한다.
- metering 없는 enforcement는 제공하지 않는다: 비교할 기록이 없는 배포는 한도를 가질 수 없다.
- 프로액티브 reconciler의 예산 양보도 같은 스위치를 읽는다 — enforcement를 끈 배포가 **보이지 않는
  두 번째 강제점**을 원한 것은 아니다.
- `bench/arm.sh`는 한도를 올리는 대신 `enforced:false`로 돈다.

## 1. Before — 실제 코드에서 그린 execution graph

`ConversationService.turnNow` **292줄**. 지역 변수가 할당되는 순서가 orchestration이었다.

```
turn(token,id,req)
 └ lanes: conversation별 in-memory promise chain (직렬화)
    └ turnNow
       1  tenant() → bundle/store/orgId
       2  store.load(id) → view (transcript · workingSet · pending* · activeTask)
       3  worldMemo: lazy WorldState (coverage 1회)
       4  if (req.select)           → applyClickSelection        ─ return
       5  if (req.captureDecision)  → decideCapture              ─ return
       6  if (req.resumeOfTurnId)   → 각 pending step의 기록 재확인
                                      · 아직 대기 → persist       ─ return
                                      · 전부 끝남 → text/receipts/prefix 복원
       7  text 없음 → 400
       8  userTurn 생성 · progress(UNDERSTANDING)
       9  directLane(...)           → 닫힌 의도면 persist         ─ return
      10  channelFocusOf → axis
      11  await world()
      12  OperatorAgentRuntime.run(...)   ← 이미 LangGraph (plan→dispatch→judge→compose)
      13  compose(...)   ← artifact · 문장 · chip · pending · capture gap
                          그리고 그 안에서 procedure 판단(operationalPrecondition · absenceSentence ·
                          honestZero · nextStepFor)이 문장 쓰기와 뒤섞여 내려짐
      14  persist(...)
```

**이미 LangGraph였던 것**: operator run(`operatorGraph.ts`, 4 노드). **아니었던 것**: turn 자체.

## 2. After — Main StateGraph

```
START → hydrate → chooseRoute ─┬→ click ───────────────────────────→ END
                               ├→ captureDecision ─────────────────→ END
                               ├→ resume ──┬ 아직 대기 ─────────────→ END
                               │           └ 원래 요청 실행 …
                               ├→ direct ──┬ 닫힌 의도가 답함 ───────→ END
                               │           └ …
                               └→ operator → procedure → compose → persist → END
```

`operator` 노드 안에서 기존 **OperatorGraph**(plan → dispatch → judge → compose)가 그대로 돈다 —
graph 안의 graph이고, 그 계약은 건드리지 않았다.

**노드 이름은 `chooseRoute`이지 `route`가 아니다** — LangGraph는 state 채널과 이름이 겹치는 노드를
거절하고, `route`는 이 노드가 쓰는 채널이다. operator graph가 자기 `interpretGoal`에 대해 적어 둔
바로 그 규칙이다.

**각 phase는 위임한다.** `direct`는 `directLane`을, `operator`는 `OperatorAgentRuntime`을, `compose`는
`compose`를, 저장은 composer가 이미 하던 그 store write를 부른다. **그래서 이 이관은 답을 바꿀 수
없다** — parity가 측정하는 것은 그 성질이지 조심성이 아니다.

`turnNow`는 **292줄 → 16줄**이 됐고 그 16줄은 graph를 부르는 것뿐이다. 구조 테스트가 고정한다:
`turnNow`는 어떤 phase도 직접 부르지 않고, 각 phase의 call site는 **정확히 1**(= 노드 표)이다.

## 3. LangGraph State schema

```ts
TurnStateAnnotation = {
  conversationId, turnId,                    // id
  route,                                     // CLICK | CAPTURE_DECISION | RESUME | DIRECT | OPERATOR
  readiness,                                 // NO_CHANNEL | NO_DATA | WORKING | UNKNOWN
  procedureId, procedureVersion, absence,    // 어느 절차가 이 turn을 가져갔고 왜 못 돌았는가
  terminal, interrupt,                       // 어떻게 끝났고 무엇을 기다리는가
  trail,                                     // 실제로 실행된 노드 순서 = execution cursor
}
```

**전부 id · 닫힌 토큰 · 목록이다.** 구조 테스트가 이 스키마의 키 집합을 통째로 고정하고, `turnGraph`
모듈 안에 `token`·`artifact`·`body`·`draft`·`approval`·`text`·`message`가 **낱말로도 없음**을
단언한다. 협력자(Spring client · store · progress · AbortSignal)는 `config.configurable`로 흐르고
LangGraph는 그것을 직렬화하지 않는다 — **bearer token을 담을 수 있는 checkpoint는 그것을 흘리는
checkpoint다.**

## 4. AOP Runtime Core

`src/aop/` — 정의는 **데이터**이고, 컴파일러가 LangGraph subgraph로 만든다.

```ts
ProcedureDefinition = {
  id, version,                    // "answer-inquiry/v1" — prompt version과 같은 종류의 provenance
  entry,                          // 닫힌 토큰 표: readiness · anchor · requestedAction · needKinds ·
                                  //   pendingCapture · priority
  steps,                          // { id, does, handler: HandlerName, optional? } 의 순서 있는 목록
  allowedTools,                   // registry에 실재하고 전부 READ (구조 테스트)
  references,                     // WORK_ITEM_ID · INQUIRY_ID · REVIEW_ID · PRODUCT_ID · ISSUE_ID ·
                                  //   CANDIDATE_ID · CHANNEL_CODE · DRAFT_VERSION
  guardrails,                     // READ_ONLY_TOOLS · NO_MARKETPLACE_WRITE ·
                                  //   ABSENCE_ONLY_FROM_MEASURED_ZERO · DRAFT_BEHIND_PRECONDITION ·
                                  //   APPROVAL_VALIDATED_SEPARATELY · RESUME_IS_IDEMPOTENT ·
                                  //   NO_PHRASE_MATCHING
  completion,                     // ANSWERED · BLOCKED_BY_PRECONDITION · WAITING_HUMAN · UNKNOWN
  humanInterrupt,                 // SEND_APPROVAL · HUMAN_ACTION_ON_CHANNEL · KNOWLEDGE_ANSWER
}
```

**step은 구현을 담지 않고 닫힌 `HandlerName`을 지목한다.** 이 저장소의 의미는 테스트된 코드에 있고,
데이터로 다시 쓰는 v1은 이관이 아니라 재구현이다. 정의가 더하는 것은 **이름 · 순서 · 계약**이다.

**`compile.ts`**: 정의의 순서를 그대로 chain으로 만들고 분기는 **하나뿐** — `terminal`을 세운 step이
마지막으로 실행된 step이다. precondition 실패와 human interrupt가 공유하는 그 탈출구가 절차에 필요한
유일한 분기다. optional step은 런타임의 `shouldRun`이 정한다. 런타임이 publish하지 않은 handler를
지목한 정의는 **컴파일 자체가 거절**된다(조용한 no-op이면 테스트가 통과해 버린다).

**만들지 않은 것**: natural-language compiler · visual editor · business-user builder. v1이 사는
가치는 여섯 절차가 **편집 가능해지는 것**이 아니라 **검사·테스트 가능한 데이터가 되는 것**이다.

## 5. 여섯 procedure subgraph

새 절차 **0**. QA case 때문에 절차를 더하지 않았다.

| id | entry | steps | interrupt |
|---|---|---|---|
| `ONBOARD_CHANNEL` | readiness=NO_CHANNEL (priority 10) | world · gate · answer | — |
| `DAILY_WORK` | LIST_ACTIONS (20) | world · gate · read · answer | — |
| `ANSWER_INQUIRY` | anchor=INQUIRY + PREPARE/SEND (30) | target · gate · draft · *tone* · answer · *approval* · *send* | SEND_APPROVAL |
| `ANSWER_REVIEW` | anchor=REVIEW + PREPARE/SEND (40) | target · gate · draft · *tone* · answer · *approval* · *guided* · *send* | SEND_APPROVAL · HUMAN_ACTION_ON_CHANNEL |
| `CAPTURE_KNOWLEDGE` | pendingCapture (5 — 가장 앞) | ask · store · redo · answer | KNOWLEDGE_ANSWER |
| `IMPROVE_FROM_ISSUES` | need IMPROVEMENT_OPPORTUNITY (50) | read · answer | — |

*기울임 = optional.* priority는 **전순서**라 「파일에서 먼저」가 누구의 계약도 아니다.

**router는 두 번째 planner가 아니다.** 판매자의 문장을 읽지 않는다 — 입력은 plan의 닫힌 토큰,
world의 readiness, 대화가 서 있는 객체, 그리고 이미 서 있는 지식 질문뿐이고 전부 그것을 소유한
곳에서 상류에 결정된 값이다. **대부분의 turn은 어떤 절차에도 속하지 않고(`null`) 그것이 정직한
답이다** — 「최근 문의 보여줘」는 행에 대한 질문이지 업무 절차가 아니다.

**이 이관이 실제로 옮긴 판단은 하나다**: 어떤 절차가 이 turn을 가져가는지와 그 precondition이
composer 안에서 문장 쓰기와 뒤섞여 내려지던 것을, router가 정해 **verdict로 넘긴다**. 같은 함수,
같은 입력, 소유자 하나. 문장은 여전히 composer가 쓴다.

## 6. Persistence ownership

| 사실 | 소유자 |
|---|---|
| transcript · working set · pending human action · pending capture · activeTask | **`ConversationStore`** (이관 전부터) |
| draft 버전 · fingerprint · 승인 · 실행 결과 · 지식 · 마켓플레이스 outcome | **backend DB** |
| 「이 turn이 어디까지 갔는가」 | **graph state** (id · 닫힌 토큰 · trail) |

**in-process checkpointer를 붙이지 않았고, 그것이 결정이다.** 이 제품의 durable turn state는
**대화**이고 `ConversationStore`가 그것을 이미 소유한다. 같은 사실의 두 번째 durable store는 resume
뒤에 원본과 어긋날 수 있고 어느 쪽이 옳은지 말할 사람이 없다 — §5가 막으려는 바로 그 불일치다.
graph state는 **한 turn의 execution cursor**이고 turn은 그것을 시작한 요청보다 오래 살지 않는다.
오래 사는 것은 대화이고, resume은 store의 기록에 대고 `resumeOfTurnId`로 다시 들어온다.

AOP subgraph는 checkpointer를 **받을 수 있게** 만들어 두었고(테스트가 `MemorySaver`로 확인한다),
production에서 붙이지 않은 이유는 위와 같다.

## 7. Interrupt / Approval semantics

**interrupt는 일시정지이지 허가가 아니다.** §6의 순서를 그대로 지킨다:

```
interrupt  →  기존 approval validation  →  별도 execute 노드
```

- 정의의 `humanInterrupt`는 **어디서 멈출 수 있는가**만 말한다.
- 승인은 `validateApproval` step이 **자기 기록에 대고** 검증한다. resume되었다는 사실이 승인을
  대신할 수 없다 — 구조 테스트가 `SEND_APPROVAL`을 든 절차만 `APPROVAL_VALIDATED_SEPARATELY`를
  지도록 고정한다.
- 재실행 방지는 기존 single-use fence 그대로(`RESUME_IS_IDEMPOTENT`).
- 라이브가 아니라 테스트로 증명한 것: **두 번째 resume은 아무것도 시작하지 않는다**
  (`restartResume.test.ts` — 두 번째 resume 뒤 sync run 수 불변).

## 8. 제거한 legacy orchestration

- `turnNow`의 **292줄 순차 제어 흐름 → 16줄**(graph 호출). 그 안에 있던 다섯 갈래 `if` 사슬 ·
  early return 여섯 개 · resume의 중첩 분기가 노드와 조건부 엣지가 됐다.
- **dual runtime 없음.** feature flag도 shadow mode도 남기지 않았다 — parity가 한 번에 확인됐으므로
  이관 커밋이 곧 cutover다.
- 새로 생긴 공유 지점 하나: `ensureUserTurn` — 판매자 문장을 turn으로 만드는 일은 옛 코드에서
  resume 블록과 direct lane **사이**에 있어 두 경로가 함께 지났다. 그래프는 그 둘을 다른 노드로
  나누므로 공유되는 단계에 이름을 붙였다.

## 9. Parity 결과

| | 이관 전 | 이관 후 |
|---|---|---|
| agent-runtime 스위트 | 900 통과 | **913 통과 · 실패 0** (새 테스트 13) |
| ConversationScenario (CI, 녹화 plan) | 18 통과 | **18 통과** |
| 라이브 selection (실 planner, 48 turn) | 46/48 | **46/48** |
| 라이브 holdout (14 turn) | 13/14 | **13/14** |
| 실패한 turn 집합 | 「그건 어때?」·「오늘 들어온 리뷰 보여줘」·「저기 그거」 | **동일** |
| 새로 깨진 turn | — | **0** |

완료 기준 대조: Scenario Eval regression **0** · exact inquiry/review/product continuity **통과**
(objectFlow 시나리오 + 브라우저) · Knowledge gap resume **통과** · approval wait/resume **통과** ·
opportunity flow **통과** · multi-turn **통과** · **process restart 후 resume 통과**(두 번째
`ConversationService`를 같은 store 위에 세워 재현) · **side-effect duplicate 0**.

**1440 브라우저 QA**(Demo Org 4 turn, 재기동 후): 「오늘 내가 답해야 할 문의 정리해줘」 → 23건 ·
「두 번째 거」 → 「2번째 문의입니다」와 그 문의 카드 · 「답변 준비해줘」 → 근거가 없으므로 초안을
지어내지 않고 기준을 되묻는다 · 「반복해서 나오는 리뷰 문제 있어?」 → 이슈 3건과 근거 날짜.
**이관 전 출력과 같다. 콘솔 오류 0 · off-host 0.**

## 10. 남은 custom orchestration — 정직하게

1. **`directLane`의 내부**는 여전히 닫힌 의도들의 `if` 사슬이다(~300줄). 그것은 orchestration이
   아니라 **dispatch**이고, 노드로 쪼개면 LangGraph가 아니라 switch문을 그래프로 그리는 일이 된다.
   그래프가 소유하는 것은 「direct lane을 언제 묻는가」와 「답했으면 거기서 끝난다」이다.
2. **`compose`(~520줄)는 한 노드다.** 그 안에서 artifact·문장·chip·pending·capture gap이 만들어진다.
   procedure **판단**은 이번에 밖으로 나왔지만 **표현**은 여전히 그 안이다.
3. **ANSWER_INQUIRY / ANSWER_REVIEW / CAPTURE_KNOWLEDGE의 draft·tone·execute step은 정의에 적혀
   있으나 아직 subgraph로 실행되지 않는다** — 그 일은 `directLane`과 `compose` 안에서 벌어지고,
   이번에 그래프가 소유한 것은 **선택과 precondition**이다. 정의가 약속하고 런타임이 하지 않는
   것처럼 읽히지 않도록 여기 적는다: 여섯 정의 중 subgraph로 **실행**되는 것은 아직 없고,
   컴파일·라우팅·검사는 실재한다.
4. **conversation별 직렬화**(`lanes` promise chain)는 그래프 밖이다. LangGraph의 thread 개념으로
   옮길 수 있지만, 그러려면 checkpointer가 필요하고 §6의 결정이 그것을 미룬다.
5. `OperatorAgentRuntime`은 turn마다 새로 만들어진다(그래프는 서비스당 한 번 컴파일된다).

## 11. 다음에 full AOP product를 만들 때 필요한 것

- **durable checkpointer**가 먼저다. 3·4의 잔여는 전부 「절차가 turn보다 오래 살 수 있는가」에
  걸려 있고, 그것 없이는 subgraph 실행이 곧 재실행이다. 붙일 자리는 이미 있다(`compileProcedure`가
  `BaseCheckpointSaver`를 받는다) — 필요한 것은 **`ConversationStore`와 같은 사실을 두 번 쓰지
  않는** 저장 계약이다.
- **compose를 표현 노드들로 쪼개기.** artifact 조립과 문장 선택이 한 함수에 있는 한, 절차별
  completion을 그래프가 관측할 수 없다.
- **handler 표의 공개 계약.** 지금 `HandlerName`은 닫힌 union이고 그것이 옳다. 제품이 되려면
  handler가 **입출력 스키마**를 갖고 정의가 그 스키마로 검증돼야 한다.
- **정의의 버전 이관 규칙.** 실행 중이던 절차의 정의가 바뀌면 무엇이 되는가 — 지금은 turn이
  요청보다 오래 살지 않아 물을 필요가 없고, checkpointer가 붙는 순간 첫 번째 질문이 된다.
- **절차별 텔레메트리.** `conversation_procedure` 로그 한 줄(procedure · version · readiness · ok)이
  이번에 생겼다. 절차의 성공률·중단 지점은 그 위에서 세어야 한다.
- 그리고 **만들지 않기로 한 것은 여전히 만들지 않는다**: natural-language compiler · visual editor ·
  business-user builder. 그 셋은 정의가 데이터라는 사실에서 자동으로 따라오지 않는다.

## 12. 검증

- agent-runtime **913 통과 · 실패 0** · typecheck clean · backend **3,884 통과 · 실패 0** ·
  frontend **2,762 통과**
- **마켓플레이스 호출 0 · WRITE 0 · 승인 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음
- 모델 호출은 parity 실행의 planner뿐(2 set × 1 pass ≈ 53회) + 브라우저 QA 4 turn
- Planner prompt/model은 **건드리지 않았다**(§8): `agent-plan-prompt/v16` · `gpt-5-2025-08-07`
  @ `minimal` 그대로
