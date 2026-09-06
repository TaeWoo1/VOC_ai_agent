# AOP Execution Closure v1

**2026-09-06 · LangGraph turn orchestration migration은 PASS · 새 Procedure 0 · 새 기능 0.**

직전 패키지에서 AOP 정의는 **데이터**가 됐지만 실행은 여전히 `directLane`과 `compose` 안에 있었다.
이 패키지는 그 간격을 닫는다 — **steps · precondition · terminal · interrupt가 설명 metadata가
아니라 실제 runtime path**가 된다.

Planner · WorldState · tools · Evidence · Draft · Approval · Executor semantics는 **그대로**다.

---

## 1. 실제로 실행되는 여섯 subgraph

| id / version | steps (실행 순서, *기울임 = optional*) | terminal | interrupt |
|---|---|---|---|
| `ONBOARD_CHANNEL` / v1 | world · gate · settle | BLOCKED_BY_PRECONDITION | — |
| `DAILY_WORK` / v1 | world · gate · investigate · settle | ANSWERED · BLOCKED · UNKNOWN | — |
| `ANSWER_INQUIRY` / v1 | **loadObject** · gate · *prepare* · *revise* · *approval* · *execute* · settle | ANSWERED · BLOCKED · WAITING_HUMAN | SEND_APPROVAL · KNOWLEDGE_ANSWER |
| `ANSWER_REVIEW` / v1 | **loadObject** · gate · *prepare* · *revise* · *approval* · *humanWait* · *execute* · settle | ANSWERED · BLOCKED · WAITING_HUMAN · UNKNOWN | SEND_APPROVAL · HUMAN_ACTION_ON_CHANNEL |
| `CAPTURE_KNOWLEDGE` / v1 | resume · settle | ANSWERED · WAITING_HUMAN | KNOWLEDGE_ANSWER |
| `IMPROVE_FROM_ISSUES` / v1 | investigate · evidence · settle | ANSWERED · UNKNOWN | — |

`CAPTURE_KNOWLEDGE`에 **wait step이 없는 것이 요점이다.** 질문을 put하는 것은 `ANSWER_INQUIRY`의
draft step이고(그래서 그 절차가 `KNOWLEDGE_ANSWER`를 함께 선언한다), 이 절차는 판매자가 **답했을 때**
도는 쪽이다. 답이 아니었던 문장은 이 절차의 turn이 아니므로 그대로 놓아 준다.

**step id는 state 채널과 겹칠 수 없다** — LangGraph가 거절한다. outcome을 정하는 step이 `terminal`이
아니라 `settle`인 이유이고, turn graph의 `chooseRoute`·operator graph의 `interpretGoal`과 같은 규칙이다.

## 2. AOP definition → graph mapping

```
ProcedureDefinition.steps[i] ──▶ StateGraph.addNode(step.id, handlers[step.handler])
                     .optional ──▶ ops.shouldRun(step.id, state, ctx)  (required step은 묻지 않는다)
                        순서    ──▶ chain edge
                    terminal   ──▶ 유일한 분기: settle된 step이 마지막으로 실행된 step
```

- **step은 구현을 담지 않는다.** 닫힌 `HandlerName`을 지목하고 `ProcedureRuntime`이
  `ConversationService`가 publish하는 `ProcedureOps` 표에 묶는다. publish되지 않은 handler를 지목한
  정의는 **컴파일 자체가 거절**된다.
- **어휘는 실행 모델이다**: `loadObject`(exact object load) · `investigate` · `evidence` ·
  `prepare` · `revise` · `humanWait` · `resume` · `validateApproval` · `execute` · `settle`.
- **entry condition은 닫힌 토큰 표**이고, 문장은 `procedureIntent.ts`에서 **한 번** 토큰으로 읽힌다.
  그 아래로 판매자의 말을 보는 코드는 없다 — router는 여전히 두 번째 planner가 아니다.

turn graph는 라우트를 하나 얻었다:

```
chooseRoute ─┬→ procedure ┬ (terminal) ──────────────→ END      ← 계획 이전. 이 turn이 곧 절차다.
             │            └ direct …                             ← 대상을 못 실었으면 그대로 놓아 준다
             └→ … → operator → procedure → compose → persist → END   ← 계획 이후. gate와 terminal.
```

두 방문은 **trail로 구분한다** — 노드는 자기가 어디서 들어왔는지 모르고, `route`는 이 turn이 어떻게
시작했는지를 계속 말해야 하기 때문이다.

## 3. Checkpoint schema / store

```ts
AopCheckpoint = {
  threadId,                    // `${conversationId}:${procedureId}` — 멈춘 두 절차는 서로를 resume하지 않는다
  conversationId,
  procedureId, procedureVersion,
  step, stepTrail,             // 어디서 멈췄는가
  refs,                        // workItemId · inquiryId · reviewId · productId · issueId ·
                               //   candidateId · channelCode · draftVersion — 전부 DB 키
  draftId, approvalId,         // 번호와 id이지 본문도 결정도 아니다
  terminal, absence, interrupt,
  updatedAt,
}
```

- **`sanitize()`는 whitelist다.** 선언되지 않은 필드는 통과하지 못하므로, 필드를 더하는 것은 이 파일을
  고치는 일이지 값이 조용히 나타나는 일이 아니다. `forbiddenKeysIn()`이 실제 write에 대고
  body·text·draft·token류의 부재를 단언한다.
- **store 셋**: Memory(기본 — chat turn은 요청보다 오래 살지 않는다) · File(프로세스를 넘는다,
  restart proof가 쓰는 것) · 그리고 seam 자체(`procedureCheckpoints` dep)라 배포가 고를 수 있다.
- **`claim()`은 exactly-once 게이트**다(이웃 `RunStore.claim`과 같은 계약). claim을 잃은 resume은
  **step을 하나도 실행하지 않는다** — 이것이 duplicate side effect 0의 구조적 근거다.
- **끝난 절차는 cursor를 지운다.** 자기 run보다 오래 사는 cursor는 나중 resume이 「아직 할 일」로
  오인할 바로 그 물건이다.

## 4. DB vs graph persistence ownership

| 사실 | 소유자 |
|---|---|
| 초안 버전 · fingerprint · 근거 · 승인 기록 · 지식 · 마켓플레이스 결과 | **backend DB** (변화 없음) |
| transcript · working set · pending human action · pending capture · activeTask | **`ConversationStore`** |
| 「이 절차가 어디까지 갔는가」 | **`AopCheckpointStore`** — cursor와 reference만 |
| 「이 turn이 어느 노드까지 갔는가」 | turn graph state (id · 닫힌 토큰 · trail) |

## 5. compose / directLane에서 제거한 procedure logic

**directLane에서 제거한 transition 넷** — 전부 업무 절차의 단계였다:

1. `pendingCapture` → `captureAnswerLane` ⇒ **CAPTURE_KNOWLEDGE.resume**
2. `prepared && tone` → `reviseTone` ⇒ **ANSWER_INQUIRY.revise**
3. `tone` without a draft → 「말투를 바꿀 초안을 찾지 못했습니다」 ⇒ **ANSWER_INQUIRY.settle**의 precondition
4. `analyzeIntentOf` → 「DRAFTABLE이면 초안, 아니면 advisory」 판단 + `prepareIntentOf` → `directPrepare`
   ⇒ **ANSWER_INQUIRY.loadObject → gate → prepare → settle**

**남긴 것은 dispatch다** — acquisition · freshness · referentless · ordinal/inspect · filter ·
prioritize · label select. 이것들은 orchestration이 아니라 「화면 위 객체에 대한 닫힌 의도」의
switch이고, 노드로 쪼개면 LangGraph가 아니라 switch문을 그래프로 그리는 일이 된다.

**compose에서는 precondition 재계산을 없앴다** — `phaseProcedure`가 절차를 고르고 gate를 세우며,
compose는 그 verdict를 읽어 문장과 걸음을 고른다(표현은 compose의 것이라는 경계를 지켰다).

## 6. Interrupt / approval semantics

```
interrupt(멈춤)  →  validateApproval(승인 기록에 대고)  →  execute(별도 step, 한 번)
```

- `interrupt`는 **일시정지이지 허가가 아니다.** cursor에 `approvalId`가 있어도 그것은 **id**이고,
  유효성은 매번 그 기록에서 읽는다 — 여기에 verdict를 담으면 resume이 아무도 두 번 주지 않은
  「예」를 물려받는다.
- `approval`/`execute` step은 chat 문장에서 **도달 불가**(`shouldRun` false). 승인 표면에서만 온다.
  문장이 무언가를 보낼 수 있었던 적은 없고, 이 이관도 그것을 바꾸지 않는다.

## 7. Restart / interrupt / resume proof

| 무엇 | 어떻게 |
|---|---|
| 정의의 step이 실제로 도는가 | `executionClosure.test.ts` §A — trail == 정의의 순서, 여섯 전부 |
| precondition이 실행을 멈추는가 | ANSWER_REVIEW gate 실패 ⇒ trail `[loadObject, gate]`, prepare·execute 미실행 |
| terminal이 선언과 맞는가 | 여섯 전부, 선언한 completion으로 끝난다 |
| cursor가 프로세스를 넘는가 | File store에 쓰고 **새 store 객체**로 읽어 같은 절차·step·refs |
| 두 번째 resume | `claim()` → `CONFLICT`, 그리고 claim을 잃은 run은 **step 실행 0** |
| duplicate side effect | 끝난 절차는 cursor 삭제 ⇒ 나중 resume이 이어받을 것이 없다 |
| 대화 차원의 restart | `restartResume.test.ts` — 같은 store 위 **두 번째 `ConversationService`**, 두 번째 resume 뒤 sync run 수 불변 |

## 8. 검증

- agent-runtime **922 통과 · 실패 0** · typecheck clean
- 라이브 parity(실 planner): selection **46/48** · holdout **13/14** — **실패 turn 집합이 이관 전과
  동일, 새로 깨진 것 0**
- 브라우저 4 turn(Demo Org, 재기동 후): 목록 23건 → 「2번째 문의입니다」 → 근거 없는 문의에 기준을
  되묻기 → 「조금 더 부드럽게 써줘」가 **ANSWER_INQUIRY.settle의 precondition**으로 「말투를 바꿀
  초안을 찾지 못했습니다」. 콘솔 오류 0 · off-host 0.
- **마켓플레이스 호출 0 · WRITE 0 · 승인 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음

## 9. 아직 legacy orchestration에 남은 business decision

정직하게 적는다.

1. **compose의 post-plan ANALYZE 가드.** 플래너가 advisory 질문을 `PREPARE`로 라우팅했고 대상이
   draftable이 아닐 때 advisory로 답하는 규칙 — pre-plan 쌍둥이는 `ANSWER_INQUIRY.settle`로
   옮겼지만 이쪽은 compose의 target 루프 안에 있다. 옮기려면 플래너의 target 루프 자체를 subgraph로
   보내야 하고, 그것은 별도 패키지다. (`semanticOwnership.test.ts`가 이 잔여를 이름으로 고정한다.)
2. **`compose`(~520줄)는 여전히 한 노드**다. 절차의 **판단**은 나왔고 **표현**은 안에 있다 —
   의도한 경계이지만, 절차별 completion을 그래프가 관측하려면 언젠가 쪼개야 한다.
3. **`ANSWER_REVIEW`의 loadObject/prepare는 chat lane에서 도달하지 않는다.** 리뷰 답글은 리뷰 답변
   작업 화면이 소유하고, 대화는 그 화면으로 보낸다. 정의는 그 절차의 전체 모양을 적고 있고, chat이
   도는 것은 gate와 settle까지다.
4. **`approval`·`execute` step은 아직 chat에서 실행되지 않는다.** 이것은 결함이 아니라 승인 경계다 —
   그러나 「AOP가 execute를 소유한다」고 말할 수 있으려면 승인 표면이 이 subgraph를 통과해야 하고,
   그 이관은 승인 계약을 건드리므로 이번에 하지 않았다.
5. **conversation별 직렬화**(`lanes` promise chain)는 여전히 그래프 밖이다.

## 10. 성공 기준에 대해

> 새 workflow를 추가할 때 ConversationService/compose에 별도 business-process if를 추가하지 않고
> AOP + subgraph만 추가할 수 있는 구조.

**지금 가능한 것**: 새 정의를 `procedures.ts`에 더하고, 필요한 step이 기존 `HandlerName` 안에 있으면
`ProcedureOps` 구현에 그 절차의 분기를 더하는 것으로 끝난다 — routing은 entry 표가, 전이는 컴파일러가
가져간다. `directLane`에도 `compose`에도 새 `if`는 필요 없다.

**아직 아닌 것**: 새 handler가 필요한 절차는 `HandlerName` union과 `ProcedureOps`를 함께 고쳐야 한다
(닫힌 union은 의도한 것이다 — 정의가 런타임이 publish하지 않은 행동에 닿을 수 없어야 한다). 그리고
표현은 여전히 compose가 소유하므로, 새 절차가 **새 종류의 화면 출력**을 요구하면 그쪽에는 손이 간다.
