# Agent Interaction Model v2 — Conversation as an Operating Workspace (2026-08-31)

reviewnary의 홈 대화를 「챗봇이 붙은 SaaS」가 아니라 **화면에 보이는 문의·상품을 자연어로 가리키고,
클릭하고, 그 객체에 대해 연속으로 일을 맡기는** AI Operating Workspace로 만드는 coherent refactor.
불변으로 지킨 것: QuerySpec deterministic execution · grounding/evidence safety · Knowledge Capture ·
Human Approval · marketplace WRITE 0 · org isolation · authoritative `InquiryDraftComposer`.
새 parallel agent engine 0.

## 0. P0 — org/session binding 감사와 수정

지시된 관측(「PO-QA org 화면에 Demo Org의 문의 93건·NAVER/Cafe24 상품이 보였다」)의 원인을 코드 전체
감사로 증명했다. **backend는 깨끗하다** — 감사한 모든 컨트롤러가 `principal.orgId()`로 org를 유도하고,
agent-run-state는 `(orgId, threadId)`로 키된다. 실제 노출 경로는 셋이었고 전부 닫았다:

1. **`getOrMock`의 무조건 fixture fallback** (`frontend/src/lib/apiClient.ts`) — 10개 read-only GET이
   **어떤 오류에서든**(401/403/500/timeout) NAVER+Cafe24 모양의 seed fixture를 라벨 없이 렌더했다.
   지시된 관측과 가장 잘 맞는 후보 중 하나다(다른 하나는 브라우저가 실제로 Demo Org로 로그인돼 있던 것 —
   93건은 seeder의 16건이 아니라 실축적 Demo Org 데이터의 크기다; 과거 화면 상태는 재현 불가라 단정하지
   않는다). 수정: fixture는 `VITE_USE_MOCKS=true` 빌드에서만; 그 외에는 오류가 전파되어 화면이 「읽지
   못했다」를 말한다 — `getMe`가 세션에 대해 이미 적어 둔 근거를 데이터에도 적용한 것.
2. **로그아웃이 세션 해체가 아니었다** — JWT만 지웠다. `reviewnary.conversation.current`(전역 키),
   `sellerops_bridge_token`(로컬 도우미 페어링), 연결 흐름 sessionStorage가 다음 identity로 넘어갔다.
   수정: `lib/sessionScope.ts`의 `clearSessionScopedState()`를 `logout()`이 호출하고, 대화 포인터는
   **org별 네임스페이스**(`reviewnary.conversation.current.<orgId>`)가 됐다. `ConversationProvider`는
   로그인 org가 바뀌면 thread·workingSet·focus 전부를 리셋한다.
3. **runtime의 org 격리가 위치적(positional)이었다** — 스토어 스코핑(`scopeFor(orgId)`)은 맞았지만
   기록에 org 단언이 없어 잘못 스코프된 스토어를 시끄럽게 잡을 방법이 없었다. 수정:
   `ConversationView.orgId` 스탬프 + 모든 load에서 단언(불일치 = 404, 존재를 확인해 주지 않는다).
   구 기록(스탬프 없음)은 스토어 스코핑에 계속 기댄다.

회귀 테스트: runtime `agentInteractionModel.test.ts` §0(두 org 토큰 — get/turn/list 전부 격리),
frontend `ConversationProvider.orgScope.test.tsx`(org별 키 · org 전환 리셋 · 로그아웃 해체).
라이브: Org B 로그인 시 PO-QA thread/artifact/focus 표시 0, 로그아웃 후 localStorage/sessionStorage
세션 키 0, PO-QA 재로그인 시 자기 스레드만 복귀.

## 1. Conversation Focus — 명시적 1급 상태

`ConversationView`/`TurnView.continuation`에 **`activeTask`**(`INSPECT` · `PREPARE_REPLY` ·
`REVISE_DRAFT` · `CAPTURE_KNOWLEDGE` · `APPROVE_REPLY`)가 추가됐다. Visible Working Set은 기존
`WorkingSetView`, Selected Entity는 `selectedInquiry`, Prepared Object는 `pendingPrepared`/
`pendingCapture` — 넷 다 conversation과 함께 영속되고 reload를 넘긴다. focus는 「마지막 tool」에서
추론되지 않는다. Inquiry identity ≠ work-item identity, product context는 anchor **곁에** 추가되며
selected inquiry를 덮지 않는다(기존 불변식 유지).

## 2. 자연어 선택 — `visibleSelection.ts` (model 0)

「배송 문의 봐줘」·「종이컵 문의」·「네이버 배송 문의」가 **보이는 집합 안에서** 결정론으로 해석된다.
per-sentence if문이 아니라 닫힌 class 셋: 채널 단어(제품의 3채널 map), topic 가족(**workload 필터와
같은 `TOPIC_WORDS` 표** — 세 번째 사본을 만들지 않았다), 행의 title/product 텍스트에 대한 literal
token. 문장이 집합 밖의 것을 이름 지으면(literal이 어떤 행에도 없음) **거절하고 플래너로** 넘어간다 —
추측하지 않는다. 유일하면 SELECT, 2건 이상이면 **후보를 보여준다**(집합이 후보로 좁혀져 ordinal·클릭이
그 위에서 동작). 플래너에 ephemeral ref를 주는 방식은 필요 없었다 — 결정론 해석으로 충분했고 플래너
호출 수는 늘지 않았다(§13).

## 3·9. CLICK == CONVERSATION FOCUS

행 클릭이 자연어 선택과 **같은 state transition**이다: `StartTurnRequest.select`(닫힌 필드)가
런타임에 가서 같은 anchor 적용 함수를 지나고, conversation과 함께 영속되며, transcript에는 **아무것도
추가하지 않는다**(행 자신의 하이라이트와 in-place 펼침이 피드백). thread가 보여준 적 없는 id는 hint일
뿐 fact가 아니다 — 기존 규칙 그대로 org-scoped READ 1회로 검증하고, 검증 불가면 아무것도 바꾸지
않는다. `[답변 준비]`·`[말투 다듬기]`·capture 저장/취소·후보 클릭 전부 같은 contract를 쓴다 — 숨은
상호작용 모델 0.

## 4. INSPECT ≠ WORKLOAD

선택(ordinal·label·pronoun·클릭)은 **INSPECT**다: 새 artifact `INQUIRY_DETAIL` 하나 — 행의 닫힌
사실들 + 고객 문장의 bounded excerpt(transient, 영속 시 제거·reload 시 그 문의의 detail에서 재독) +
[답변 준비]/[문의 화면에서 열기]. org 재조회 0, 목록 재출력 0, workload 변환 0. 「이 문의」·「이 고객」·
「아까 그 문의」·「이 문의 자세히」는 anchor의 INSPECT(pronoun 표, 문장 전체일 때만).

## §13. anchor 위의 PREPARE는 플래너를 쓰지 않는다

anchor가 있을 때 「뭐라고 답하면 좋을까」·「답변 준비해줘」·「이 상품 기준으로 답변 준비해줘」는
**직접 draft lane**이다: compose()에서 추출한 `prepareOneInquiry`(actionability gate → propose→generate
→ NO_ANSWER_BASIS면 Knowledge Capture 질문) 하나를 플래너 경로와 공유한다. 다른 객체를 이름 짓는
문장(「첫 번째 거 답변 준비해줘」, 채널·topic 단어)은 제외돼 플래너의 target 규칙으로 간다. 실측:
33초(플래너)였던 turn이 **0.2초 + draft 모델**이 됐고, 이전 라이브 QA가 「anchor를 보여주고 되묻던」
clarification 경로는 도달 불가가 됐다(재계약 §14 참조).

## 5·6·7. Assistant turn / 대기 / 목록 artifact

- 목록 행은 구조화 객체다: 제목(가장 큰 활자) + 상태 단어(우측) + `상품 · 채널 · 시간` 한 줄. 행 전체
  하이퍼링크 금지 — 행 = select/펼침, workspace는 **보조 아이콘**(`open` 아이콘, NavIcon에 추가).
- 근거 disclosure는 「확인한 자료 N」 → **「근거 N」**이 됐고, 내용 없는 generic 행(label만 「자료」에
  count·window 없음)은 걸러져 빈 bullet이 렌더되지 않는다. 의미 있는 근거가 없으면 disclosure 자체가
  없다.
- 대기: 전송 즉시 assistant 자리에서 실제 runtime stage(SSE)가 한 줄 activity로 움직이고(측정된 시계
  포함), 완료되면 같은 자리에서 답으로 바뀐다 — 이는 Chat UI/Motion v1이 이미 갖고 있던 것의 확인이고,
  fake progress·fake typing은 이번에도 0. planner JSON을 UI에 stream하지 않으며 token streaming은
  vendor 추상화 재설계가 필요해 이번 패키지에서 만들지 않았다(§6 지시대로). Stop 의미 무변경.
- 지시받은 「svg placeholder」는 현 코드에서 재현되지 않았다(문자 "svg"를 렌더하는 곳 없음, 콘솔 오류 0)
  — 근거 빈 bullet 정리로 함께 사라진 표면일 가능성이 크지만 단정하지 않는다.

## 11. 홈의 첫 문장은 실제 운영 진실

「오늘 먼저 확인할 일은 없습니다」류 문장의 소유자가 **둘**이었고(렌더되지 않는 `AgentBriefing`의
`briefingHeadline`과 `AgentHome.greetingLine`) 서로 다른 문장을 갖고 있었다 — 죽은 컴포넌트와 그
문장들을 퇴역시키고(`briefing.ts`는 disconnected 두 상수만 남음) 소유자를 하나로 했다. 오프너 turn은
proactive case가 0일 때 **같은 strict overview가 답한 실제 workload**(미답변 문의 N건 · 부정 리뷰
N건, 최대 3줄)를 말한다; 「없습니다」는 두 읽기가 모두 빈손일 때만이다. 인사말의 zero 문장은 제거됐다
(기다리는 일이 있는지는 오프너의 문장이고, 인사말이 그것과 모순될 수 없어야 한다). 라이브: 미답변 8건인
PO-QA 홈이 「오늘 미리 준비해 둔 일은 없지만, 지금 확인이 필요한 일이 있습니다」 + 두 줄을 열었다.

## QA가 드러내 닫은 결함 둘 (라이브에서 발견)

1. **anchor의 상품이 모든 turn에 실렸다** — 문의를 하나 고른 뒤 「최근 문의 8개 보여줘」가 상품 힌트를
   달고 나가 「이 상품의 근거로는 쓸 수 없습니다」라는 문장이 붙었다. 수정: `selectedInquiry.productId`
   힌트는 문장이 「이 상품」을 말할 때만 실린다(Conversation Object Integrity v1이 이 힌트를 도입한
   바로 그 경우). R5/R8(PRODUCTS 집합 크기 1)은 무변경.
2. **집합보다 큰 limit의 refine** — 플래너가 「최근 문의 8개」를 직전 5행 집합의 WORKING_SET refine으로
   표시해 5행만 답했다. 5행을 필터해서 8행이 나올 수는 없으므로 scope override에 **`NEW_LIMIT`**를
   추가했다(`scopeOverride.ts` — `NEW_PERIOD`·`EMPTY_SET`과 같은 자리, plan 토큰만 읽는다). 집합
   이내의 limit(「그중 3개만」)은 여전히 refine이다.

## §14. 재계약한 테스트 (약화 0)

marketplace write/approval/evidence safety 테스트는 하나도 손대지 않았다. 새 product contract와
충돌해 다시 쓴 것:

- `objectIntegrity.test.ts` A×3·E: ordinal이 selection summary가 아니라 **INQUIRY_DETAIL INSPECT**가
  됐고(문구 「N번째 문의입니다」), anchored 「답변 준비해줘」·「이 상품 기준으로 …」가 **plan 0**이 됐다
  (구 계약은 planner priorContext 토큰을 단언했다 — 그 관측 지점 자체가 사라진 것이 새 계약이다).
- `responseHygiene.test.ts` §6: 「그거 뭐라고 답할까」가 clarification-guard 문장이 아니라 anchor의
  초안으로 답한다 — §6의 원래 목적(같은 문의를 다시 묻지 않는다)의 더 강한 형태.
- `ConversationWorkspace.test.tsx`·`ConversationNav.test.tsx`: org-scoped 키와 「근거」 라벨.
- `AgentHome.test.tsx`: greeting zero 문장 제거 + workload 오프너(진짜 zero 케이스는 새 테스트로 유지).
- 삭제: 렌더되지 않던 `AgentBriefing.tsx`(+테스트)와 `briefing.test.ts`의 퇴역 함수 테스트.

## 검증

- **runtime** 74 files / 727 passed(23 skipped) · **frontend** 전체 suite green(재계약 반영) ·
  **backend** 무변경 + 전체 suite 실행(아래 결과 참조). 새 테스트: `visibleSelectionOf` 단위 ·
  label-INSPECT · ambiguity→ordinal · click-select 영속/transcript-silent · 미검증 id 무시 ·
  org 격리 · frontend click=select/highlight/plain-link fallback · org-scope/로그아웃 해체.
- **라이브 브라우저 QA** (disposable org 「PO-QA 인터랙션」, 실제 planner·draft 모델, 1440×900):
  시나리오 1–7 전부 통과. 실측 —
  - S1: 목록 turn(plan 1·judge·tool 1) → 「배송 문의 봐줘」 = **74ms, LLM 0, INQUIRY_DETAIL** →
    「이 고객한테 뭐라고 답하면 좋을까?」 = **LLM 0(플래너), clarification 0**, SHIPPING capture 질문.
  - S3: 판매자 문장 「보통 결제 후 2~3일 안에 출고해」 → candidate → [저장하고 계속] → 저장 →
    같은 문의 재개 → **GROUNDED, cited=true** → 「조금 더 부드럽게」 = **plan 0, v1→v2, 근거 동일**.
  - S2: 다른 행을 실제 클릭 → 「이 고객한테 …」가 **정확히 그 문의**의 '가닥' PRODUCT capture 질문으로
    답함(「어떤 문의인지 알려주세요」 0).
  - S5: 8행 집합에서 「배송 문의 봐줘」 → **후보 3건, 임의 선택 0**, 후보 클릭으로 선택.
  - S4: **새 대화**에서 목록 → 다른 배송 문의 클릭 → [답변 준비] → 저장된 기준을 그대로 인용한
    GROUNDED 초안(「보통 결제 후 2~3일 안에 출고됩니다」), 같은 기준 재질문 0.
  - reload: thread 복원, 초안 본문 재독(같은 저장 버전), reload 후 「이 문의 자세히」가 같은 anchor를
    INSPECT(plan 0).
  - S6: Org B 로그인 — PO-QA thread/focus/artifact 0, 홈은 B의 진실(미연결 헤드라인); 로그아웃 시
    세션 스코프 storage 0.
  - S7: 전송 즉시 assistant 자리에 실제 stage 진행(✓ 목록 + 측정 시계), Stop 같은 자리, 완료 전환 자연.
  - 콘솔 오류 0 · off-host 요청 0 (`localhost:5173`뿐).
- **모델·호출 수** (QA org 전체, `agent_llm_usage`): PLAN 5 · DRAFT 4 · JUDGE 2. 모든
  select/inspect/click/anchored-prepare turn은 **LLM 0**. **marketplace 호출 0 · WRITE 0**(QA org의
  sync job 0, 계정은 file-upload 모양뿐이라 구조적으로 불가) ⇒ evidence 행 없음.
- **cleanup**: QA org 두 개(본체 + 격리용 Org B)의 모든 행 삭제, `backend/.env.local` allowlist 원복,
  스택 종료(시작 전 상태), 스크린샷은 저장소 밖(scratchpad). Demo Org 무변경(문의 수 변화는 이 QA
  이전 시각의 타 활동분임을 `created_at`으로 확인).

## 정직하게 보고할 것

- **`agent-runtime/.runstore/` 삭제는 과했다.** QA org의 대화 파일을 지우려는 cleanup에서 gitignored
  로컬 파일 runstore 디렉터리 전체를 지웠다 — 운영자의 이전 로컬 dev 세션이 남긴 (Demo Org 스코프의)
  대화 스레드 파일도 있었다면 함께 사라졌다. 제품 데이터가 아니라 로컬 dev 편의 상태이고 DB·채널은
  무관하지만, 스코프 디렉터리만 골라 지웠어야 했다.
- QA org의 planner 첫 시도는 org allowlist(`SELLEROPS_AGENT_PLAN_ORG_IDS`) 때문에
  `PLANNER_CAPABILITY_OFF`로 실패했고, QA 한정으로 org를 추가했다가 원복했다 — 파일럿에서 새 판매자를
  열 때 같은 스위치를 만나게 된다(운영 결정, 코드 아님).
- `visibleSelection`은 v1에서 **INQUIRIES 집합만** 다룬다. 리뷰는 ordinal 선택(기존)만 있다.
- 「배송 문의 봐줘」가 **집합이 없을 때**는 여전히 플래너 문장이다(그 목록을 그리는 것이 맞는 답이다).
- token streaming은 만들지 않았다(§6의 허용 조건대로 stage activity → complete response).
- `NO_ANSWER_BASIS` reload의 일반 문장 한계, `totalElements` 등 앞선 패키지가 보고한 기존 성질은
  그대로다.
