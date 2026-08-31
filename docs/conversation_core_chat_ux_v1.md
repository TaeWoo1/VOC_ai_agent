# Reviewnary Conversation Core + Chat UX v1 (2026-08-31)

PO QA가 이름 붙인 대화 결함 다섯을 **root cause에서** 닫은 패키지. incremental patch가 아니라
interpretation 계약의 재설계이며, org isolation · Query API · evidence/grounding · Product/Org
Knowledge · Answer Memory · Knowledge Capture · `InquiryDraftComposer` · Human Approval ·
marketplace write safety는 전부 무변경이다. **backend 소스 0 · 마이그레이션 0 · marketplace 호출 0 ·
marketplace WRITE 0.**

## 0. PO QA가 관측한 실패와 감사로 확정한 root cause

1. **「최근 문의 5개」 → 「배송 관련 문의만 봐줘」가 같은 5건을 반복했다.** 두 원인이 겹쳐 있었다.
   (a) 플래너는 이미 닫힌 토큰 `filters.topic=SHIPPING`을 내고 있었지만 **ROWS 실행기에는 topic
   축이 없었다** — `InquiryRowsSpec`은 window·channel·status·order·limit만 들고, WORKING_SET
   refine은 직전 id 집합과 교집합만 낸 뒤 같은 행을 다시 그렸다(topic은 WORKLOAD lane에만 있었다).
   (b) 결정론적 FILTER lane 자체가 없어서 모든 refine이 8~25초짜리 full planner를 탔다.
2. **선택된 문의에 「이 고객한테 뭐라고 답하면 좋을까?」가 대화를 막았다.** `prepareIntentOf`의
   cue 표가 advisory 질문(뭐라고 답/어떻게 답)과 명령(답변 준비해줘)을 한 lane에 넣었고, 그 lane의
   actionability gate가 ANSWERED 문의에 「이미 답변된 문의라 새 초안은 만들지 않았습니다」로
   끝냈다. **ANALYZE라는 mode가 어휘에 없었다** — `RequestedAction`에도, direct lane에도.
3. **일반 대화가 closed workflow intent로 과수렴** — 1·2의 합성: FILTER는 refine 재실행으로,
   advisory는 PREPARE로 수렴할 수밖에 없는 어휘였다.
4. **UI**: 기반은 이미 chat-shaped였으나 평범한 대답(SUMMARY)까지 카드에 갇혔다.
5. **/agent 결함**: 레거시 `/agent`가 홈과 **같은 대화 스레드를 한 번 더** 레거시 free-text 폼 위에
   embed하고 있었고, panel의 「전체 화면」이 거기로 갔다 — 한 질문에 두 Agent surface.

## 1. ConversationTask 계약 (`agent-runtime/src/conversation/taskInterpreter.ts`)

```
mode  = ANSWER | LIST | FILTER | INSPECT | ANALYZE | PREPARE | REVISE | EXECUTE
scope = ORG | VISIBLE_SET | SELECTED_ENTITY
```

결정론으로 해석되는 것은 **이미 테이블 위에 있는 객체에 대한** INSPECT / FILTER / ANALYZE /
PREPARE / REVISE뿐이다. ANSWER·LIST·org-scoped FILTER·EXECUTE routing은 그대로 LLM planner의
것이고(`sellerops_operator_graph_v2.md` 계약 유지 — 결정론 goal planner는 이번에도 만들지
않았다), 문장별 if문은 없다: 모든 규칙이 닫힌 표(cue family · 채널 3종 map · **workload lane과
같은** `TOPIC_WORDS`)이며, 표가 문장을 **전부 소비하지 못하면** 플래너로 떨어진다.

- **`visibleFilterOf`** — 「배송 관련 문의만」·「네이버 것만」·「답변 안 한 것만」·「그중 최근 2개」와
  그 조합. consume-everything 파스: 닫힌 축 어휘(channel/topic/status/limit/order) + 닫힌 filler가
  모든 content token을 설명해야 하고, 축 하나 이상 + **refine 표현(「~만·그중·중에서·여기서·방금
  본」)**이 있어야 FILTER다(§9 — 「최근 문의 7개 보여줘」 같은 새 목록 요청은 이 lane이 아니다).
  **bare label + 보기 동사(「배송 문의 봐줘」)는 여전히 SELECTION lane의 것** — Agent Interaction
  Model v2 §2 무변경.
- **`analyzeIntentOf`** — advisory 질문의 닫힌 cue(뭐라고 답/어떻게 대응/답변 방향…). LIST·REVISE·
  SEND 단어가 섞이면 제외.
- `prepareIntentOf`는 **명령형만** 남겼다(답변 준비/작성/초안…). advisory cue 두 가족은 여기서
  빠져 ANALYZE로 갔다.

## 2. FILTER — visible set 위의 결정론 narrowing (LLM 0)

`ConversationService.applyVisibleFilter`: 직전 INQUIRIES 집합의 **화면에 있던 행**(persisted
history rows)에 축을 적용한다. channel/status는 행 자신의 닫힌 값으로, **topic은 제목·상품명
매치 우선 + 제목이 답 못 하는 행만 bounded detail READ(≤8, workload lane과 같은 in-process 비교,
미영속)**로 본문을 본다. order는 행의 receivedAt 재정렬, limit은 그 뒤 slice. 정직성 규칙:

- **집합보다 큰 limit은 refine이 아니다**(scopeOverride `NEW_LIMIT`과 같은 규칙 → 플래너).
- persistence가 행을 다 못 든 집합(>20행)은 이 lane이 만지지 않는다 → 플래너의 WORKING_SET 재독.
- 0건이면 직전 집합이 anchor로 남고 문장은 「…문의는 없습니다」(R2 유지).
- 새 working set은 좁힌 id·필터를 들고, **후속 refine은 그 위에 선다**.

플래너 경로도 고쳤다: `InquiryRowsSpec`에 `topic` 축 추가(계획의 `filters.topic`과 직전 집합의
topic을 carry), 교집합 뒤 `matchesTopic(제목·상품명)` 적용, limit은 topic 필터 **뒤에** in-process
적용, `total`은 필터된 수. 제목·문장·artifact `scope`·working set 모두 topic을 싣는다(플래너
경로는 bounded detail read를 쓰지 않는다 — 예산 안에서 제목/상품명 기준이고, 그렇게 적는다).

## 3. ANALYZE — advisory는 actionability gate의 지배를 받지 않는다

「뭐라고 답하면 좋을까」는 **조언 요청**이다. anchored inquiry에 대해:

- **DRAFTABLE** ⇒ 기존 direct PREPARE step 그대로(가장 강한 조언은 초안이다; capture 질문 포함,
  plan 0). 기존 §13 동작 보존.
- **그 외(ALREADY_ANSWERED · AWAITING_SEND · NOT_WORKABLE)** ⇒ `conversation/advisory.ts`:
  상태는 **사실로**(「이미 답변된 문의입니다.」 — 거절문이 아니다) 말하고, 판매자 자신의 corpus
  세 lane(운영 정책 `searchOrgKnowledge` · 상품 지식 `searchProductKnowledge` · 과거 답변
  `searchAnswerMemory` — draft composer가 읽는 그 seam들, 전부 org-scoped READ)을 질문 제목으로
  검색해 **출처 라벨 + 문서 제목 + bounded excerpt**(conflict 카드와 같은 `excerpt()` 한도)로
  답변 방향을 정리한다. 못 찾으면 정직하게 「…참고할 내용을 찾지 못했습니다」 + 「답변 기준 추가」.
  모델 0 · 쓰기 0 · 초안 저장 0.
- 플래너가 PREPARE로 routing한 advisory 문장(「첫 번째 문의, 뭐라고 답할까」)도 compose의 PREPARE
  루프에서 같은 guard로 advisory로 빠진다.
- **gate는 PREPARE/EXECUTE에만 남는다**: 「그럼 새 답변 준비해줘」는 여전히
  「이미 답변된 문의라 새 초안은 만들지 않았습니다.」

## 4. UI / surface 감사

- **SUMMARY는 카드에서 나왔다**: 평범한 대답은 assistant turn의 산문으로 렌더(조용한 제목 +
  문장들). 객체 artifact(목록·초안·승인)만 구조화 컨테이너 유지.
- **/agent 재정의**: embed된 두 번째 ConversationWorkspace와 레거시 free-text 폼(legacy
  `/api/agent-runs` goalText lane의 UI 진입점)을 제거 — 문장은 홈 대화의 것이다. 남는 것은
  **결정론 button lane**(닫힌 intent 2종 + 초안 shortcut + 계정 선택 + human checkpoint RunView)
  으로, 페이지 이름도 「정해진 작업」이 됐다. runtime의 legacy REST lane 자체는 무변경(계약·테스트
  유지); 사라진 것은 중복 UI뿐이다. `OperatorAnswerView`의 렌더 계약 테스트는 페이지 구동에서
  **컴포넌트 구동으로** 옮겨 유지했다.
- **panel 「전체 화면」 → `/`** (같은 스레드의 full-width가 홈이다).
- 진행 표시·bottom composer·Stop·접힌 근거·클릭 가능한 compact 행은 기존 그대로(이미 chat 계약).

## 5. Telemetry (실측, 라이브)

`conversation_turn`이 mode를 `requestedAction`으로 싣는다(VISIBLE_FILTER · ADVISORY ·
CLICK_SELECT · DIRECT_PREPARE · TONE_REVISION…). 라이브 실측 — 결정론 lane **11~24ms · LLM 0**
(VISIBLE_FILTER 11·11·15ms, CLICK_SELECT 12ms, ADVISORY 24ms/READ 2, gate 11ms); 플래너 turn
11.2~24.5초(전부 LIST/목록 — 목표대로 깊은 조사에만 강한 경로); DIRECT_PREPARE(draft 모델 포함)
7.0초, TONE_REVISION 8.4초.

## 6. 라이브 브라우저 acceptance (disposable org 「PO-QA 대화코어」, 1440×900, 실제 planner·draft 모델)

seed: 문의 7건(배송 제목 2 · 본문만 배송 1 · 규격 1 · 설치 1 · ANSWERED 2), file-upload 모양 계정
2(구조적으로 connector 불가). 실측 결과:

1. 「최근 문의 5개 보여줘」(plan 1) → **「배송 관련 문의만 봐줘」 = 3건 subset, 즉시, LLM 0** —
   본문만 배송인 행이 bounded detail read 1회로 포함됐다. 같은 5건 반복 없음. **PASS**
2. 답변된 「배송비는 얼마인가요」를 클릭으로 선택 → 「이 고객한테 뭐라고 답하면 좋을까?」 =
   「이미 답변된 문의입니다. …참고할 내용을 찾지 못했습니다.」(DONE · LLM 0 · READ 2) — 대화가
   막히지 않는다. **PASS** (이 org의 저장 기준은 출고 기간이라 배송비 질문에는 정직한 miss;
   passage가 있을 때 인용하는 모양은 unit test로 고정)
3. 「그럼 새 답변 준비해줘」 = gate 문장, 초안 0. **PASS**
4. 「최근 문의 5개」 → 「네이버 것만」(2) → 「답변 안 한 것만」(2) → 「그중 최근 2개」(2) — 전부
   즉시·LLM 0, 각 단계가 직전 집합 위. **PASS**
5. 행 클릭 → 「이 고객 자세히 봐줘」 = 정확히 같은 entity의 INQUIRY_DETAIL, plan 0. **PASS**
6. 회귀: capture 질문 → 판매자 문장 → [저장하고 계속] → **저장 기준을 그대로 인용한 GROUNDED
   초안(v1, 근거: 운영 정책 1 · 과거 답변 1)** → 「조금 더 부드럽게 써줘」 = v2, 사실 동일. **PASS**
7. 1440 스크린샷 4장으로 ChatGPT/Claude interaction 원칙 대조(§4) — cohesive turn · 우측 사용자
   bubble · 접힌 근거 · docked composer · compact 행 확인. 스크린샷은 저장소 밖(scratchpad).
8. 클릭 QA: `/agent`(정해진 작업, 대화 embed 0, 「홈 대화」 링크), panel 「전체 화면」→`/`(같은
   스레드 7 turn), 사이드바 스레드 전환, stack 재시작 후 reload에서 스레드·anchor 복원.
   콘솔 오류 0(React Router future-flag 경고 2건은 기존).

**모델 호출(QA org 전체, `agent_llm_usage`): PLAN 4 · DRAFT 2 · JUDGE 2.** sync job 0 ·
marketplace 호출 0 · WRITE 0 ⇒ evidence 행 없음. cleanup: QA org의 DB 행 전부 삭제,
runstore는 **해당 org scope 디렉터리만** 삭제(v2의 과잉 삭제 반성 반영), `backend/.env.local`
byte-identical 원복(planner/draft allowlist에 QA org를 임시 추가했었다), 스택 재기동·health 확인,
QA 전용 Chrome 프로필 종료. Demo Org 무변경(문의 수 변화는 상시 가동 중인 Self-Pilot routine
수집분).

## 7. 재계약한 테스트 (safety 약화 0)

- `agentInteractionModel.test.ts`: intent reader 테스트를 ANALYZE/PREPARE 분리 계약으로 재작성,
  `visibleFilterOf` 닫힌 문법 단위 테스트 추가. label-SELECTION 테스트는 marker 규칙 덕에 무변경.
- `queryAccuracy.test.ts` refine 2건: 구 계약(refine = backend 재독 + 플래너)을 새 계약(결정론 ·
  재독 0 · plan 0)으로 재작성 — 관측 지점(rowsParams 재호출)이 사라진 것이 새 계약이다.
- 신규 `conversationCore.test.ts` 9건: PO 실패 1·2의 재현과 폐쇄(본문 detail read 포함 subset,
  플래너 경로 topic, chained refine, ANSWERED advisory 2형, gate) + §9의 New-list Scope
  Integrity 3건.
- frontend: `/agent` 3개 테스트 파일을 intent-구동/컴포넌트-구동으로 재작성(§4).
- 검증: **runtime 737 · frontend 2,575 · 실패 0**; backend는 소스 무변경이라 실행하지 않았다.

## 8. 정직하게 보고할 것

- ~~플래너가 직전 집합의 channel/status를 fresh read에 끌고 간다~~ — **§9에서 닫혔다**
  (New-list Scope Integrity, 2026-08-31 같은 날 후속 패키지).
- FILTER lane은 v1에서 **INQUIRIES 집합만** 다룬다(리뷰 집합의 semantic filter는 플래너).
- ANALYZE의 grounded 인용은 라이브에서 미관측(위 §6-2) — 렌더·인용 계약은 unit test로 고정.
- 「작은/빠른 semantic interpretation LLM」은 만들지 않았다: 결정론 문법이 PO 시나리오 전부를
  LLM 0으로 덮었고, 문법 밖 문장은 기존 full planner가 맞는 답이다. 별도 fast-interpretation
  백엔드 capability는 필요가 관측되면 product-owner 결정으로.
- token streaming은 여전히 없다(stage progress → complete turn, §27 계약 그대로).
- QA 중 backend를 두 번 재시작했다(allowlist env 반영) — 코드가 아니라 배포 설정이고 원복됐다.

## 9. New-list Scope Integrity (2026-08-31, 같은 커밋)

§8이 보고했던 context contamination을 root cause에서 닫는다. 원칙: **명시적인 새 LIST는 ORG
scope의 새 working set이고 직전 visible set의 channel/status/topic/period를 계승하지 않는다;
계승은 명시적 refine 표현(「그중」·「여기서」·「방금 본」·「~만」)만 한다; selected entity는 새
LIST의 filter source가 되지 않는다.** 오염 경로는 둘이었고 둘 다 닫았다.

1. **voided refine은 base를 데리고 나간다** (`scopeOverride.ts`, 결정론). 플래너가 문장을
   follow-up으로 읽으면 그 plan의 filter 축은 「직전 집합의 base + 문장이 더한 것」이다.
   NEW_LIMIT/NEW_PERIOD가 그 refine을 무효로 만들면, **직전 집합의 값과 같은 축은 물은 것이 아니라
   물려받은 것이므로 ORG read 전에 떨어뜨린다** — 문장이 실제로 말한 축은 base와 다르거나 base에
   없다. 라이브 재현: NAVER·UNANSWERED 집합 위 「최근 문의 7개 보여줘」가 「네이버 답변 안 한
   가장 최근 7건 = 2건」이 되던 것 → org 전체 최근 7건. EMPTY_SET은 축을 유지한다(그 문장은
   진짜 refine이고 물려받은 frame은 판매자 자신의 직전 질문이다). 문장은 읽지 않는다 —
   닫힌 토큰 동등성 비교뿐.
2. **priorContext가 focus와 계승 가능 filter를 같은 것으로 말하지 않는다** (`priorLineOf`).
   「직전 작업 집합」 토큰 줄 뒤에 고정 지시문 한 줄: 괄호의 값은 화면 설명이지 이번 문장의
   조건이 아니며, 좁히는 문장만 WORKING_SET이고 새 목록 요청은 ORG + **이번 문장에 적힌 축만**
   적으라 — 괄호 값을 복사하지 말라. `contextLine`과 같은 성질(run state에 대한 닫힌 어휘,
   데이터 0)이라 payload floor 무변경, backend 프롬프트 무변경.
3. **결정론 FILTER lane도 같은 원칙을 따른다** (`taskInterpreter.visibleFilterOf`): refine
   표현(~만·그중·중에서·여기서·방금 본)이 있어야만 이 lane의 문장이다 — 「최근 문의 7개
   보여줘」는 축(limit·order)이 읽혀도 새 목록 요청이므로 플래너로 간다. 「7개만」의 「만」은
   개수의 만이지 narrowing의 만이 아니라서 limit span 소비 **후에** marker를 읽는다.

Selected entity는 감사 결과 구조적으로 이미 깨끗했다(`resolveRowsSpec`은 WORKING_SET에서만
`previous`를 읽고, `channelScopeOf`는 plan이 이름 지은 채널만 읽으며, anchor의 채널은 어느
목록 read에도 닿지 않는다) — 새 목록이 그려지면 selection이 떨어지는 기존 계약 위에 회귀
테스트만 더했다. regression: `conversationCore.test.ts` 「New-list Scope Integrity」 3건
(오염 chain = org 7건 + NEW_LIMIT 로그 + 집합 규칙 도달, counter-chain 「그중 최근 2개」는
여전히 LLM 0 refine, anchored 변형), `visibleFilterOf` 단위 4건. 라이브 검증은 §9-1.

### 9-1. 라이브 검증 (실제 플래너, 브라우저 — disposable org 「PO-QA 스코프정합」, 문의 7건 seed)

- **오염 chain**: 「최근 문의 5개」(planner 14.8s) → 「네이버 것만」(3건 · 34ms · LLM 0) → 「답변 안 한
  것만」(2건 · 19ms · LLM 0) → **「최근 문의 7개 보여줘」 = org 전체 7건**(양 채널 · 양 상태 · 2일 전
  행 포함, 「문의는 7건입니다 (답변 필요 5건 · 답변함 2건)」). 실행된 read는
  `channel:NONE · status:ALL · limit:7 · workingSet:false` — 원래 결함의 답은 「네이버 답변 안 한
  가장 최근 7건 = 2건」이었다.
- **counter chain**(새 대화): 「최근 문의 5개」 → 「네이버 것만」(13ms) → 「그중 최근 2개」 =
  **네이버 subset의 최근 2건**, 29ms · LLM 0 · plan 0.
- **anchored 변형**: 행 클릭(CLICK_SELECT 17ms · LLM 0)으로 문의 하나를 anchor한 뒤
  「최근 문의 7개 보여줘」 = 같은 org 전체 7건, read는 동일하게 `channel:NONE`.
- 라이브 세 turn 모두 플래너가 **스스로 ORG를 골랐다**(`operator_scope_override` 0회) — priorLine의
  집합 규칙이 프롬프트 수준에서 작동했고, 결정론 strip은 backstop으로 테스트가 증명한다(플래너가
  WORKING_SET+오염 축을 내는 fixture에서 NEW_LIMIT 후 채널·상태가 떨어져 org read가 된다).
- 플래너 LLM 3회 · draft 0 · **marketplace 호출 0 · WRITE 0**. cleanup: org DB 행 전부 삭제,
  runstore는 해당 org scope 디렉터리만, `backend/.env.local` byte-identical 원복, 스택 재기동.
  스크린샷 3장(`10-newlist-org7` · `11-refine-chain` · `12-anchored-newlist`)은 저장소 밖(scratchpad).
