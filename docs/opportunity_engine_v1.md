# Auth Entry Regression Closure + Opportunity Engine v1

2026-09-04 · branch `feat/proactive-operations-agent-v1` · base `7f8ffb3f`

두 가지를 닫는다. (1) 로그인 화면에서 Google · NAVER 로그인이 사라진 원인, (2) 반복 이슈 → 근거에서
끝나던 흐름을 **Issue → 근거 확인 → 개선 기회 → 준비된 다음 행동**까지 잇는 Opportunity Engine v1.

Retrieval / Knowledge model / Grounded Drafting / Approval / Guided Reply는 **무변경**. 마켓플레이스 호출 **0** ·
마켓플레이스 WRITE **0** · 승인 **0**. 이 패키지가 더한 LLM capability **0**(Opportunity는 전부 결정론이다).
브라우저 QA에서 Agent 플래너 호출 **2회**(대화 확인 2회 — 벤더에 나간 것은 판매자 문장 하나와 닫힌 계획 스키마뿐).

---

## 1. 로그인 회귀 — 버튼은 코드에서 사라진 적이 없다

### 감사

- `frontend/src/pages/Login.tsx`는 여전히 `<SocialSignInButtons intent="login" />`를 렌더한다. 이 컴포넌트는
  `GET /api/auth/social/providers`가 `true`로 답한 provider만 그리고, 둘 다 `false`면 **아무것도 그리지 않는다**
  (설계: "provider without BOTH id and secret does not exist — no bean, no endpoint, no button",
  `SocialLoginConfiguration.AnyProviderConfigured`).
- `git log -S"Google로 로그인"`: 버튼을 지운 커밋은 **없다**. `04811591`(Auth + Growth Instrumentation v1)에서 들어온
  뒤 `c35e4f12`(auth-shell polish)·`8cbcf59d`(AuthCard 한 줄)만 스쳤고 제거 diff는 0이다.
- backend/`.env.local`에는 네 변수(`SELLEROPS_OAUTH_GOOGLE_CLIENT_ID/SECRET`, `…_NAVER_…`)가 **이름과 값 모두 존재**한다
  (값은 읽지도 인쇄하지도 않았다 — 비어 있지 않다는 사실만 셌다).

### 원인

**배포 자세다.** Spring은 dotenv를 읽지 않으므로 backend를 `./gradlew bootRun`으로 바로 띄우면 `.env.local`이
적용되지 않고, 그 프로세스에서는 OAuth provider가 둘 다 "없음"이라 `/api/auth/social/providers` →
`{"google":false,"naver":false}` → 버튼 0. 직전 세션들의 로컬 QA는 backend를 그렇게 띄웠거나 QA 한정 override로
띄웠고(`tools/dev/.run/be.log` 계열), 판매자가 본 것은 그 배포였다. `tools/dev/local-stack.sh`는 정확히 이
함정을 자기 주석에 적어 두고 있다("a stack that skipped it would come up with … the OAuth providers … off —
looking healthy while being a deployment nobody configured").

### 결과

- 이번 패키지는 **auth 코드를 한 줄도 바꾸지 않았다**(새 auth system 0, 가짜 버튼 0).
- 스택을 house 방식(`tools/dev/local-stack.sh up`)으로 띄우자 `/api/auth/social/providers` = `{"google":true,"naver":true}`,
  `/login`에 「Google 계정으로 로그인」·「네이버 로그인」이 렌더되고(스크린샷 `login@1440.png`), 각 링크는
  `/oauth2/authorization/{google,naver}`이며 dev proxy를 지나 backend가 **302로 provider authorize URL**을 돌려준다
  (curl로 확인 — 실제 동의 화면·콜백은 이 세션에서 밟지 않았다).
- **남는 것**: 이 스위치는 배포별 사실이므로 "버튼이 보인다"는 `.env.local`을 소스한 프로세스에 대해서만 참이다.
  파일럿 호스트에서는 `deploy/pilot/pilot.env.example`의 같은 이름 넷을 채워야 한다(값은 저장소 밖).

---

## 2. Opportunity Engine v1

### 2-1. Issue와 Opportunity는 다른 객체다

| | Issue (기존) | Opportunity (신규) |
|---|---|---|
| 무엇 | 「접착 불만이 반복됩니다」 — 추출기가 리뷰에서 센 **신호** | 「'접착' 관련 안내를 FAQ에 보완하는 것을 검토하세요」 — 판매자가 **손볼 수 있는 곳** |
| 정체성 | `review_issues.id` | **`(issueId, kind)`** — 자기 id가 없다 |
| 저장 | 추출기가 쓴다 | **저장하지 않는다.** 매 읽기마다 이슈 + 판매자 지식에서 **도출** |
| 저장되는 것 | — | 판매자의 **결정**(accept/dismiss)과 준비된 초안뿐 (`improvement_opportunity`, V94) |
| 원인·효과 | 말하지 않는다 | **말하지 않는다** |

**생성 기준은 전부 결정론이고 한 파일이다** (`OpportunityRules`):

1. **게이트** — dismissed 아님 · lifecycle `RESOLVED` 아님 · `evidenceCount ≥ ReviewIssueThresholds.NEW_MIN_EVIDENCE(3)`.
   추출기 자신의 "one review is not an issue" 임계를 재사용한다. 이 게이트가 「evidence 없는 제안 0」의 구조적 근거다 —
   모든 Opportunity는 근거 행을 가진 이슈 위에서만 존재하고, 뷰는 그 이슈의 `/memory/{issueId}`를 든다.
2. **두 lane, 이슈당 최대 하나씩** —
   - GUIDANCE lane(고객에게 말할 수 있는 것): aspect가 안내로 답할 수 있는 것일 때만.
     `배송`→회사 운영 기준(ORG), `접착·설치·설명`→상품 사용법, `표면·색상·크기`→상품 설명. `포장`·`가격`은 **없음**
     (찌그러진 상자를 문장으로 고칠 수 없다). 문제가 `난이도`면 어디서든 사용법, `불일치`면 어디서든 상세 안내.
     ORG lane은 상품이 없어도 되고, PRODUCT lane은 `dominantProductId`가 없으면 **생성하지 않는다**(둘 곳이 없다).
   - PRODUCT lane(물건 자체): 문제가 `{파손, 결함, 균열, 탈락, 부족, 오염}`이고 상품이 있을 때 `PRODUCT_IMPROVEMENT_REVIEW`.
   - 그래서 `접착×탈락`은 둘 다(FAQ + 제품 검토), `포장×파손`은 제품 검토만, `배송×지연`은 운영 기준만.
3. **kind는 판매자 지식 상태가 가른다** — PRODUCT guidance에서 지식이 aspect를 **언급하지 않으면** `FAQ_SUPPLEMENT`,
   **언급하면** `PRODUCT_GUIDE_SUPPLEMENT`(답변 기준에는 있는데 구매 전 안내에도 보이는지); `불일치`는 항상 상세 보완.
4. **라이브가 고친 규칙 하나** — Demo Org에서 `배송×파손` 15건이 「배송 기준」에 갔다. 배송 중 파손은 *언제 나가나*의
   질문이 아니라 *깨진 물건을 든 고객*이므로 ORG lane에서 product-condition 문제는 **교환·반품·환불 기준**으로 간다.

**판매자 지식 연결은 retrieval이 아니라 mention check다** (`KnowledgeMentionCheck`): 그 상품의 active 상품 지식(또는
회사 운영 기준)을 추출기의 **같은 aspect 낱말**(`IssueVocabulary.keywordsOf`, 새 accessor)로 substring 검사한다 —
랭킹 0 · 임계 0 · 벤더 호출 0. 이슈마다 grounded retriever를 돌리면 읽기 한 번에 임베딩 19회를 쓰는 셈이고, 필요한
답은 「이 판매자가 이 축에 대해 무언가 써 두었는가」라 `contains`가 답한다. 결과는 `sources / mentions / excerpts(판매자
문장 ≤3, 200자)`이고 ORG는 유형이 맞는 기준(예: 교환·반품 유형)을 본문 낱말 없이도 mention으로 센다.

### 2-2. 판매자가 보는 것 (`OpportunityView`)

- **무엇이 반복됐는지** — 이슈 제목 · 근거 리뷰 수 · 기간 · 대표 상품 (전부 `ReviewIssueView`의 값).
- **왜 이 기회를 제안하는지** — `whyKo`: 근거 수/기간, `IssueChangeRules`가 내린 변화 라벨(있을 때만), 상품,
  그리고 지식 줄(「이 상품의 상품 지식 2건 중 '접착'을(를) 다룬 내용은 없습니다」). **사실 문장만**.
- **근거** — `/memory/{issueId}`(모든 인용은 거기 산다; 이 뷰는 고객 문장을 **들지 않는다** — 둘째 사본 금지).
- **다음에 무엇을 할 수 있는지** — `recommendationKo`(어디를 검토하라는 문장; 원인·효과 0)와 `nextActionKo`.

모든 문장은 `OpportunityDraftComposer` **한 파일**에서 나온다. 「원인은 리뷰가 말하지 않으므로 근거 리뷰를 직접
확인하세요」가 제품 검토 문장에 박혀 있는 이유다.

### 2-3. 준비된 행동은 초안까지 — 모델 0

- `accept` → 초안을 **결정론 scaffold**로 만든다: FAQ는 고객이 반복해서 묻는 것(질문)과 **빈 답변 칸**(「판매자님이
  채워 주세요 — 상품 지식에 이 내용이 없어 reviewnary가 대신 쓰지 않습니다」); 상세 안내문·운영 기준은 판매자 **자신의
  문장 발췌**(mention excerpts)를 옮겨 온다; 제품 검토 메모는 숫자·기간·판단 라벨과 검토 항목이다. 판매자가 고쳐
  쓸 수 있고(`PUT …/draft`, 200/4,000자), 다시 accept해도 고친 것을 덮지 않는다.
- 초안의 **목적지는 이미 있는 seam**이다: FAQ·운영 기준은 문의·리뷰 화면이 쓰는 그 `KnowledgeQuickAdd`로
  **판매자가 저장**(`POST /api/products/{id}/knowledge/sources` · `/api/org-knowledge/sources`,
  `SELLER_ENTERED_KNOWLEDGE`); 상세 안내문·검토 메모는 **복사**(reviewnary에는 상세페이지 WRITE가 없고 원하지도
  않는다; 클립보드가 없으면 성공했다고 말하지 않는다 — `lib/clipboard.ts` 그대로).
- **자동 마켓플레이스 수정·게시·submit 0.** `OpportunitySafetyFenceTest`가 이름으로 고정한다: 채널/HTTP 클라이언트 0 ·
  승인·ActionIntent·Publish·Executor 0 · `AgentLlm`/`ChatModel`/`prompt`/`embedding` 0 · 지식 writer
  (`ProductKnowledgeLibraryService`·`SellerOperationsKnowledgeService`·`KnowledgeCandidate`·`AnswerMemory`) 0 ·
  패키지 안의 유일한 `save(`는 자기 결정 테이블뿐.

### 2-4. 상태 모델 — annotation over truth

`improvement_opportunity` (V94): `org_id · issue_id(FK review_issues) · kind · status(ACCEPTED|DISMISSED) ·
draft_title · draft_body · decided_at`, 유니크 `(org, issue, kind)`. **행 없음 = OPEN.** 이슈가 dismissed/RESOLVED되거나
임계 아래로 떨어지면 도출이 멈추고 행은 inert하게 남는다(proactive_case 규칙). 모든 mutation은 쓰기 전에 **재도출**한다 —
증거가 지금 내지 않는 kind에 대한 결정은 404(「이 개선 기회는 지금 제안되지 않습니다」)이지 저장이 아니다.
`dismiss`는 초안을 버리고 기본 목록에서 빠지며(`includeDismissed=true`로만 보임 — 되돌릴 수 있는 유일한 곳이 이슈
화면이라 거기서는 보인다), `restore`는 행을 지운다.

### 2-5. 어디에 붙었나

- **`/memory/{issueId}`** — 근거 아래·기록 위에 「개선 기회」 섹션(`OpportunityList` → `OpportunityCard`, 테두리
  있음: 손이 필요한 객체). accept/dismiss/restore·초안 편집·저장/복사가 **여기에만** 있다. 근거 링크는 자기 페이지를
  가리키므로 이 화면에서는 렌더하지 않는다.
- **`/products/{id}`** — 「반복되는 문제」 바로 아래 「개선 기회 N건」 행 목록(`ProductOpportunities`): kind ·
  추천 문장 · 이슈 · 근거 수, 행이 `/memory/{issueId}`를 연다. `productSignals.issuesFor`(신호 카드가 쓰는 **같은**
  product-scoped 이슈 목록, public으로 승격)에서 시작하므로 신호 카드에 없는 이슈를 부를 수 없다. 읽기 실패·0건은
  **침묵**(둘을 구별할 수 없고 어느 쪽도 상품에 대한 사실이 아니다). 보류한 것은 세지 않는다.
- **Chat** — 감사 결과 필요한 seam은 셋이었고 전부 기존 모양이다: NeedKind **`IMPROVEMENT_OPPORTUNITY`**(플래너
  프롬프트 **v15** — 「개선할 만한 것」·「FAQ/상세에 보완할 거」는 이 kind, 「반복되는 문제가 뭐야」는 여전히
  REVIEW_SIGNAL; 원인·대책을 적지 말라고 가르친다), READ tool **`list_improvement_opportunities`**(카탈로그는 여전히
  100% READ, `ToolReachability` 행 1), artifact **`OPPORTUNITY_LIST`**. `ReviewOps`는 need 종류로 갈라
  (`reviewOpportunities.ts`) — 런타임은 아무것도 도출하지 않고 backend 행을 인용해 카드로 그린다; 해석된 상품이 있으면
  `productId`로 좁힌다. 대화는 accept/dismiss를 **하지 않는다**(결정은 근거가 있는 곳에서). evidence kind
  `IMPROVEMENT_OPPORTUNITY`는 scope gate에서 `LIST`, 시간 요구는 `CURRENT_STATE`.
  **라이브가 찾은 결함**: 판정이 SUPPORTED로 올린 finding 둘이 카드 위 산문에 그대로 반복됐다 ⇒ 근거 전부가 카드 행으로
  그려진 finding은 산문에서 뺀다(한 사실은 한 번만).

### 2-6. 라이브 QA (실제 Demo Org · 1440/1366/1152)

| 항목 | 결과 |
|---|---|
| 도출 | 이슈 **19** → Opportunity **7**(운영 기준 보완 3 · 상품 상세·안내 보완 2 · 제품 개선 검토 2), 전부 OPEN, 근거 없는 행 **0**(각 행의 issueId가 이슈 목록에 있고 `evidenceCount`가 일치하며 ≥3) |
| 상품 → 근거 | `/products/{전선몰딩}` 「개선 기회 7건」 y=623(1440) · 행 클릭 → `/memory/8f8fc8d3…` 도착, 카드 1 |
| accept | 「운영 기준 초안 준비」 → 초안 = 회사 교환·반품 기준 발췌(「수령 후 7일 이내, 개봉하지 않은…」) · **reload 후 「초안 준비됨」 유지** |
| dismiss / restore | 보류 → reload 후 「되돌리기」 유지 · 되돌리기 → OPEN · 종료 시 `improvement_opportunity` **행 0**(QA 잔여 0) |
| chat | 「최근 반복 문제에서 개선할 만한 것이 있어?」 → 플래너 1회 · 3.4초 · OPPORTUNITY_LIST 7행 · 행 집합 = API 집합 |
| 3폭 | product/memory/chat: **AA 위반 0 · 가로 스크롤 0 · 콘솔 오류 0 · off-host 0**(8787은 자기 런타임) |

**「답변 기준으로 저장」은 라이브에서 누르지 않았다** — 실제 Demo Org에 판매자 지식을 삽입하는 일이라 unit test로만
증명했다(`OpportunityCard.test`: quick-add가 초안으로 열리고 저장은 `createProductKnowledgeSource`로 간다).

### 2-7. 고치지 않고 보고

- **Opportunity는 이슈만큼만 참이다.** 라이브 「배송 파손」의 근거 인용 3건이 전부 「파손없이 잘 도착했네요」였다 —
  규칙 기반 추출기가 `파손` substring을 부정문에서도 잡는다. 이 패키지는 어휘를 넓히지도 좁히지도 않았다
  (`IssueVocabulary` 규칙: 측정된 라벨 없이 바꾸지 않는다). 카드가 근거 바로 아래에 있어 판매자가 볼 수는 있지만,
  **추출기 정확도가 Opportunity의 상한**이고 그것은 product-owner 결정(라벨 시드)이다.
- 상품 없는 PRODUCT-scope 이슈(`설치×난이도` 4건 등)는 Opportunity를 내지 않는다 — 둘 곳이 없다는 사실이지 누락이
  아니지만, 상품 결합이 늘면 저절로 나타난다.
- 근거 수는 이슈 총계다(product-scoped 화면에서도) — 신호 카드와 같은 숫자를 쓰기 위한 선택이며, 「이 상품의 행만」은
  `get_review_issue_evidence_summary`가 답하고 여기서는 부르지 않았다.
- 일회용 org가 아니라 **Demo Org에서 결정 row를 만들었다 지웠다** — 종료 상태 0행이고 판매자 지식·리뷰·문의는 무변경.
- 프론트 전체 실행 2회에서 `Reviews.test.tsx` 「narrowed to one product」가 연속 실패하고 단독·조용한 재실행에서
  통과했다(backend 3,825 테스트와 두 번째 vitest가 옆에서 도는 동안). 원인은 scope 문장을 `findBy`로 기다린 뒤 상품명을
  **동기** `getBy`로 읽는 줄 — 두 읽기 사이에 조회가 끼면 실패한다 ⇒ 그 한 줄을 `findBy`로 바꿨다(이 패키지가 그 파일에
  한 유일한 변경). 내 `CustomerMemory.test`의 같은 모양 한 줄도 같이 고쳤다. 부하 없는 전체 실행: **232 files / 2,747 / 실패 0**.
- 카페24/NAVER OAuth의 실제 동의 화면은 밟지 않았다(302까지만).

### 2-8. 검증

backend 신규 테스트 27(rules 11 · mention 4 · service 7 · fence 5) · runtime 신규 5(그래프 3 · 대화 2) · frontend 신규
13(card 8 · product 2 · memory 2 · artifact 2). 전체: backend **3,825** · runtime **840** · frontend **2,747** · 실패 0 ·
typecheck clean(frontend·runtime). 마이그레이션 **1**(V94, 로컬 DB 적용 — 첫 시도는 `review_issue`라는 없는 표를
참조해 Flyway가 롤백했고 `review_issues`로 고쳐 재적용). 마켓플레이스 호출 0 · WRITE 0 · 승인 0 ⇒ evidence 행 없음.
