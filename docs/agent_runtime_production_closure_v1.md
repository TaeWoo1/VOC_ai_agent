# Agent Runtime Production Closure v1

2026-09-06. **새 architecture도 새 기능도 아니다.** LangGraph turn orchestration과 AOP execution은
방향 PASS이고, 이 패키지가 묻는 것은 하나다 — **지금 런타임이 process · container · concurrency
경계에서도 옳은가.** Planner · WorldState · Procedure semantics · NeedKind · typed tools · Evidence ·
Draft · Approval · Executor fence · Helper는 **전부 무변경**이다.

---

## §1 Durable checkpoint — production ownership

**감사가 먼저 찾은 것은 성능 문제가 아니라 caller 0이었다.** `ConversationServiceDeps.procedureCheckpoints`는
seam으로 선언돼 있었지만 **production에서 그것을 넘기는 코드가 없었다** — `src/http/main.ts`는 그 필드를
주지 않고, 그래서 배포된 호스트의 모든 stopped procedure는 `MemoryAopCheckpointStore`에 있었다. 즉
**container replacement에서 cursor가 사라지고, replica 둘이면 서로의 cursor를 보지 못한다.** 파일 store는
로컬 restart proof에는 옳지만 그 둘 중 어느 것도 답하지 못한다(그리고 `.claim`은 `existsSync` 뒤
`writeFileSync`라 프로세스 사이에서 lock이 아니다).

**가장 단순한 것이 기존 PostgreSQL이었다.** `agent_runs`는 이미 org-scoped identity ·
optimistic-lock version · **진짜 claim**(`claimForResume`, 상태를 RESUMING으로 옮기는 UPDATE + 2분
crash lease)을 갖고 있고, 런타임은 이미 `HttpAgentRunStateClient`로 그 표에 말한다. 그래서 새 표 · 새
마이그레이션 · 새 엔드포인트 **0**이고, 바뀐 것은 셋이다:

| 무엇 | 어디 | 변경 |
|---|---|---|
| domain `PROCEDURE` | `AgentRunStoreService` | 허용 목록에 추가. **STRICT forbidden set**을 진다 |
| `WAITING_HUMAN`이 claimable | `AgentRunRepository.claimForResume` | 절 하나 |
| `SpringAopCheckpointStore` | `src/http/springStores.ts` | 기존 client 위의 domain-stamping adapter |

**domain을 나눈 이유는 fence다.** `CONVERSATION`은 자기 것 셋(`text` · `message` · `content` — 판매자가
친 문장, 우리가 쓴 문장, 판매자 자신의 지식이 될 문장)을 갖지만 **cursor는 자기 것이 없다**: ids, 닫힌
토큰, step 이름뿐이다. `PROCEDURE`로 두면 그 좁힘이 적용되지 않는다 — 라이브에서 확인했다(§5-C/D).

**status를 `AWAITING_APPROVAL`로 재사용하지 않았다.** 그러면 lock을 한 글자도 안 고치고 얻었겠지만
컬럼에 거짓말이 남는다 — 절차는 **지식 답변**을 기다리며 멈출 수 있고 그것은 승인이 아니다. 그래서
claimable 상태를 둘로 적었고, 그 둘이 이 제품이 사람을 기다리는 두 가지 방식이다. `CONVERSATION` 행도
`WAITING_HUMAN`에 쉬지만 **conversation store에는 claim 호출 자체가 없다**.

**저장 가능한 것은 여전히 cursor뿐이다.** `AopCheckpoint`는 conversationId · procedureId+version ·
step · stepTrail · refs · draftId · approvalId · terminal · absence · interrupt · updatedAt이고
`sanitize()`가 **whitelist**다. Draft body · evidence · approval truth · marketplace outcome · token은
쓸 자리가 없고, 백엔드가 독립적으로 한 번 더 거절한다.

**store는 요청마다 해석된다.** 다른 모든 durable store와 같은 이유로 — 내구성 있는 것은
backend-owned이고 **요청의 bearer를 진다** — `RunStores.procedureCursors`가 생겼고
`ProcedureRuntime.run(...)`이 store를 **호출마다** 받는다(컴파일된 subgraph는 비싼 쪽이라 그대로 한 번만
만든다). `APP_ENV=production`에서 `spring`이 아니면 포트가 열리기 전에 기동을 거부하는 그 provider가
이것도 정한다.

**로컬 두 store의 결함 하나를 함께 닫았다**: claim이 `delete`에서만 풀려서 **두 번째로 멈춘 절차는
영원히 resume 불가**였다. 저장된 cursor는 다시 claimable이다(backend 행은 claim→RESUMING, 다음
save→WAITING_HUMAN로 이미 그렇다).

---

## §2 Concurrent resume

**감사 결론: conversation은 어디에서도 직렬화되지 않는다.** 프로세스 안에도 lock이 없고, replica 사이에는
구조적으로 없다. 남은 보호는 행의 version인데 — **이 store가 그것을 스스로 무력화하고 있었다**:
`SpringConversationStore.save`가 version을 배우려고 save **안에서** 읽고 바로 쓰기 때문에, 그 사이에 다른
turn이 쓴 행 위로 **409 한 번 없이 조용히 덮어쓴다**. 실측으로 재현됐다(먼저 쓴 turn이 사라졌다).

그래서 merge는 409 핸들러가 아니라 **평범한 경로**가 됐다: 어차피 필요한 그 읽기가 「지금 저장된 것」을
말하고, transcript는 append-only라 합침이 모호하지 않다(identity는 turn id, bound는
`persistableTurn`이 이미 적용하는 그것). 움직이지 않은 대화에서 merge는 **항등**이고 쓰기는 이전과
바이트 동일하다. continuation(working set · pending action · active task)은 last-write-wins인데, 그것은
두 turn이 어느 순서로 와도 나왔을 결과다. 진짜로 진 guarded write는 **한 번만** 재시도한다.

**index는 더 흔한 충돌이었다.** org당 행 **하나**라 서로 다른 두 대화가 동시에 저장하기만 해도 부딪히고,
그 예외는 **대화가 이미 안전하게 저장된 뒤에** 던져져 판매자의 turn을 실패시켰다. 놓친 touch의 값은
「지난 대화」 목록에서 다음 저장까지 빠지는 것이고, 그쪽이 작은 잘못이다.

**AOP claim은 진짜 exactly-once다** — 백엔드의 원자적 UPDATE. 라이브에서 실제 Postgres에 **동시 4회**
claim을 던져 **CLAIMED 정확히 1 · CONFLICT 3**을 확인했고, claim을 잃은 run은 **step을 하나도 실행하지
않는다**.

---

## §3 Cross-surface AOP ownership

**감사 결과 orchestration 중복은 없다.** 문의·리뷰 workspace와 Chat은 UI entry가 다를 뿐 draft ·
precondition · approval · execute의 owner는 **백엔드 하나**다 — chat의 draft lane은 자기 docblock이
적어 둔 대로 「리뷰 화면이 하는 것과 같은 두 호출」을 하고, 승인·실행은 `conversationWriteFence`가
이름으로 막는다.

**하지만 한 질문이 두 곳에서 답해지고 있었고, chat 쪽이 틀렸다** — 「지금 이 리뷰로 가이드형 답변을
시작할 수 있는가」. 백엔드는 그것을 한 규칙으로 정하고(`canStartSubmissionRun`: RESPONSE_NEEDED ·
승인 있음 · **채널이 아직 답변하지 않음** · **취득 계보가 MARKETPLACE**) mint가 같은 규칙으로 409를
낸다. 리뷰 화면은 Pilot Release Closure v1에서 그것을 **읽도록** 고쳐졌는데, 대화는 여전히 **채널
capability만** 보고 스스로 정하고 있었다 ⇒ 채널에 이미 답변이 달린 리뷰에 승인이 서 있으면 대화가
「판매자센터에서 이 리뷰의 답글 입력칸에 그대로 넣어 두겠습니다」라고 약속했고, **어떤 mint도 그 약속을
지킬 수 없었다**.

수정은 화면을 chat 경로에 태우는 것이 아니라 **대화가 이미 손에 든 그 응답을 읽는 것**이다: 승인은 섰는데
서버가 `canStartSubmissionRun`을 주지 않으면 서버의 닫힌 이유(`CHANNEL_ALREADY_ANSWERED` ·
`SOURCE_NOT_EXECUTABLE`)로 사실과 다음 걸음을 말하고 **[복사]는 그대로 남는다**. 토큰은 화면에 나오지
않는다. 문장은 두 곳에 있고 그것은 중복이 아니라 **register의 차이**다(패널 한 줄과 대화 문장은 같은
말투가 아니다); 중복이었던 것은 **규칙**이고 그것은 이제 하나다.

`replyApprovalStateOf`는 남긴다 — 그것은 서버가 준 prep을 **분류**하는 read-side 술어이고, mint보다
**엄격한 방향으로만** 다르다(mint는 `state == APPROVED`만 보고, 이쪽은 version+fingerprint 바인딩까지
본다).

---

## §4 compose 잔여 ANALYZE guard — verdict: **procedure decision**

AOP Execution Closure는 이 판단의 **pre-plan 쌍둥이**를 subgraph로 옮기고 **post-plan 쪽을 compose 안에
남겨** 두었다. 그 자리는 `analyzeIntentOf(hints.text)`로 **판매자의 문장을 다시 읽고** target의
actionability를 스스로 비교하고 있었다 — 한 규칙의 두 구현이고, 둘 중 하나만 절차의 것이었다.

판정은 presentation이 아니다: 그것이 고르는 것은 **어느 business step이 도는가**(판매자 corpus를 읽는
advisory냐, production draft path냐)이고, 그 선택은 planner가 그 객체에 닿았든 결정론 lane이 닿았든
같은 선택이다. 그래서 `src/aop/answerStep.ts`로 옮겼고 **두 lane이 그것에 묻는다**. compose에 남은 것은
그 결과의 **렌더링**이며, compose 전체 분해는 하지 않았다.

**토큰은 셋이 아니라 둘이다**(`PREPARE` · `ADVISE`). REFUSE가 없는 이유는 `directPrepare`와
`prepareOneInquiry`가 각각 **초안을 만들기도 하고 만들 수 없는 객체를 거절하기도** 하며 둘 다 같은
`inquiryDraftPrecondition`을 지나기 때문이다 — 여기에 거절 토큰을 두면 그것을 정하는 두 번째 자리가
생긴다.

부수 효과로 **판매자의 문장은 이제 turn당 정확히 한 번 읽힌다**(route 시점의 `procedureIntentOf`).
`semanticOwnership.test.ts`의 `analyzeIntentOf(` 보유 파일 목록이 3 → **2**로 줄었고, 그 목록이 이
성질을 고정한다.

---

## §5 Proof

### 오프라인 (CI, 벤더 호출 0)

`test/aop/productionClosure.test.ts` — 전부 **실제** `HttpAgentRunStateClient` + 백엔드 계약을 HTTP
층에서 재현하는 fake 위에서 돈다. "container replacement"는 **version 캐시가 빈 새 client + 새
`ProcedureRuntime`**이고, "두 replica"는 그 둘의 경주다.

| 성질 | 결과 |
|---|---|
| production은 backend-owned cursor store를 해석한다 | PASS |
| 저장된 cursor = `PROCEDURE` · `WAITING_HUMAN` · 키 == `CHECKPOINT_KEYS` · 금지 키 0 | PASS |
| 다른 org는 보지도 이어받지도 못한다 (load null · claim CONFLICT) | PASS |
| fresh process가 cursor를 찾아 **같은 절차**를 이어받고 **같은 객체**(refs)로 일한다 | PASS |
| 동시 claim ×3 → CLAIMED **정확히 1** | PASS |
| replica ×2 resume → `resume` step **정확히 1회** | PASS |
| 끝난 절차: cursor 삭제 · 두 번째 resume이 그 run의 어떤 step에도 닿지 못함 | PASS |
| claim을 잃은 run은 **step 0** | PASS |
| 다시 저장된 cursor는 다시 claimable (절차는 두 번 멈출 수 있다) | PASS |
| cursor는 approval **id**만 들고 verdict를 들 자리가 없다 | PASS |
| 서지 않는 승인은 **execute 이전에** run을 멈춘다 | PASS |

`test/conversation/conversationStore.test.ts` — 한 대화 위의 두 turn이 **둘 다 남는다**(옛 코드에서
먼저 쓴 turn이 사라지는 것을 확인한 뒤 남긴 테스트) · 진 index write가 이미 성공한 저장을 실패시키지
않는다. `test/conversation/acceptanceClosure.test.ts` §3 — 채널이 이미 답변한 리뷰에 승인이 서 있어도
**guided 약속을 하지 않고** 서버의 이유를 말한다(옛 코드에서 red 확인).

### 라이브 (실제 Postgres · 일회용 org · 마켓플레이스 0)

제품 자신의 `POST /api/auth/signup`으로 만든 `@example.invalid` org에서 `/api/agent-run-store`에 대고:

- **A** `PROCEDURE` cursor 저장 → `PUT 200` · domain `PROCEDURE` · status `WAITING_HUMAN` · snapshot 키 **13**
- **B** **동시 4회 claim** → `CONFLICT · CONFLICT · CLAIMED · CONFLICT` — **정확히 하나**
- **C** `PROCEDURE`에 `turns[].text` → **400**
- **D** 같은 키가 `CONVERSATION`에는 **200** — domain이 fence다
- **E** fresh 읽기가 `ANSWER_INQUIRY / step prepare / refs {workItemId, inquiryId, draftVersion}` · `DELETE 204`
- **F** 끝난 절차의 두 번째 resume → `GET 404` · `claim 404`

### 라이브 planner parity (Scenario Eval 회귀 0)

스택을 이 커밋으로 재기동한 뒤 실 planner로(`gpt-5-2025-08-07` @ `minimal`, prompt v16 무변경):

| pass | selection | holdout |
|---|---|---|
| 이관 전(`aop`) | 46/48 | 13/14 |
| pass 1 | 44/48 | — |
| **pass 2** | **46/48 — 실패 turn 집합 문자 그대로 동일** | **13/14 — 동일** |

**pass 1의 두 추가 실패를 숨기지 않는다**: 둘 다 `NO_CHANNEL` world의 planner 변동이었다
(「아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?」가 `EXPLAIN_CAPABILITY`로 계획돼 채널을 되물었고,
「내가 해야 할 일 정리해줘」는 답이 옳았는데 plan이 도구 둘을 불러 EVIDENCE가 붙었다). **코드를 한
글자도 바꾸지 않은 pass 2가 이관 전과 동일한 집합을 냈다** — 이 두 turn은 앞선 패키지도 pass 사이에서
흔들린다고 적어 둔 그 자리다. **새로 깨진 것 0.**

### 라이브 브라우저 (Demo Org, 1440×900@2×)

4 turn: 리뷰 목록 → 「그중 첫 번째 자세히 보여줘」(정확한 객체) → 문의 큐 → 「첫 번째 문의, 뭐라고
답하면 좋을까」. 마지막 turn이 **§4의 규칙대로** draft path로 가서 근거 부족을 말하고 되묻는다(context
bar가 그 문의를 이름으로 든다). **콘솔 오류 0 · off-host 0.**

**쓰기 발자국(라이브 세션 전체):** 마켓플레이스 호출 **0** · 마켓플레이스 WRITE **0** · 승인 **0** ·
실행 **0** · `inquiry_reply_draft`/`review_reply_draft` 신규 행 **0** · 마이그레이션 **0**. 일회용 org에
남긴 run-store 행은 정리했다. ⇒ evidence 행 없음.

### 스위트

backend **3,886** · agent-runtime **938** · 실패 **0** · typecheck clean.

---

## §6 남은 single-process assumption (정직하게)

1. **대화 turn 사이에는 여전히 lock이 없다.** 한 대화의 두 turn이 동시에 돌면 각자 상대의 turn이 없는
   view에서 답한다. transcript는 둘 다 지키지만 두 답은 서로를 모른다 — replica를 넘는 lock 없이는
   고칠 수 없고, 판매자가 두 문장을 동시에 보냈다는 사실 자체가 그렇다.
2. **AOP claim은 cursor가 이미 있을 때만 잡힌다.** 같은 절차의 **첫** 실행 둘이 동시에 돌면 둘 다
   실행된다. 그 경로의 쓰기는 append-only draft version이고 propose는 item 기준 멱등이지만, 이것은
   1의 다른 얼굴이지 별개의 보호가 아니다.
3. **`FileAopCheckpointStore`의 `.claim`은 원자적이지 않다**(`existsSync` → `writeFileSync`)이고
   디렉터리는 컨테이너와 함께 사라진다. 그래서 production은 그 kind로 기동하지 않는다.
4. **`RunStoreProvider.scopeCache`**는 file/memory kind 전용이라 production에서는 비어 있다.
5. **`MemoryConversationStore` / `FileConversationStore`는 last-write-wins**다 — dev 전용이고, merge는
   backend store에만 있다.
6. 파일럿 compose는 런타임 replica **하나**다. 이 패키지가 replica를 늘리지는 않는다; 늘려도 cursor와
   claim이 더 이상 깨지지 않는다는 것이 §1–§2의 내용이다.

## §7 고치지 않고 보고

- **compose는 여전히 한 노드**다. §4가 옮긴 것은 그 안에 남아 있던 마지막 **절차 판단**이고, 표현은
  그대로다.
- `ANSWER_REVIEW`의 `loadObject`/`prepare`, 그리고 `approval`·`execute` step은 여전히 chat lane에서
  도달하지 않는다(승인 계약을 건드려야 하는 일이고, 이 패키지는 건드리지 않는다).
- 라이브 parity의 두 flaky turn(위 §5)은 planner 변동이며 이 저장소가 고정하지 않는다.
- 백엔드의 `canStartSubmissionRun` 계산에는 draft version/fingerprint 바인딩이 없다(승인이 서 있는
  동안 새 버전 저장이 409이므로 오늘은 도달 불가한 조합이다). 런타임의 술어가 그보다 엄격한 쪽이라
  판매자에게 나가는 약속은 안전하지만, **두 곳이 같은 규칙을 서로 다른 정밀도로 적는다**는 사실은
  남는다.

## §8 Architecture freeze

§1–§5가 통과했으므로 **Agent runtime architecture는 FREEZE**한다. 다음은 구조 리팩터링이 아니라
manual pilot QA와 실제 workflow 검증이다.
