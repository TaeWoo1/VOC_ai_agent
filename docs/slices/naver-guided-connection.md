# Slice Contract — NAVER Guided Connection (Guided-Connection G3)

> Status: **RATIFIED (v1, 2026-07-19) — 오프라인 구현 착수: G3-A + G3-B. G3-C/D 게이트 유지.**
> (원 상태: DRAFT — 제품 오너 리뷰 대기 2026-07-08.) 비준 세부는 **§0**. 이 문서는 **assisted NAVER
> 가이드 연결 파일럿**의 G3
> 실행 계약이다. 오프라인 구현·로컬 커밋은 착수하되 **라이브 NAVER 액션은 없다**. 대상은 **셀러 소유 NAVER 커머스 API 애플리케이션 발급
> 흐름**(type=SELF)이며, **미래 SellerOps 솔루션-제공자 OAuth 연동 모델로 문서화하지 않는다**
> (`docs/product-scope-v1.md` §6.1). **실제 NAVER 사용은 마켓 정책 게이트 뒤에 유지**된다(§14).
>
> 상위 계약: 제품 원칙 `docs/product-scope-v1.md` §1.2·§6.1, 프론트 여정·완료기준 `docs/sellerops_frontend_spec.md`
> §16.7·§16.9·§16.10·§16.11·§17-B G3, capability 진실 `docs/multi-channel-connector-roadmap.md` §4.1·§11,
> 런타임 경계·인증 불변식 `docs/sellerops_local_agent_runtime_adr.md` §3·§4, 브리지 `docs/slices/local-agent-bridge.md`(G1),
> 프로젝션 `docs/slices/browser-projection-v0.md`(G2). 본 문서는 그 위에 **가이드 상태 엔진 + 안전 자격증명
> 등록 + 첫 수집 합성** 계약을 소유한다.

베이스라인: Product Shell `3006e447b91de72f5e3627da75f390c74d92bfac`, Local Agent Bridge G1
`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`, Browser Projection V0 `a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`.
**G3는 렌더러-중립이다**: G1(페어링·관측)에 **의존**하고, **최소 하나의 승인된 렌더러 위에서** 동작한다 —
**기본 렌더러 = ACTION_WINDOW**(`docs/slices/action-window-v1.md`, 승인된 기본 production 설계이나 미구현),
**선택 렌더러 = PROJECTION**(G2 `a0e4f6f`, 채널·정책 게이트가 허용할 때만). **가이드 상태 엔진(§8)은 두
렌더러가 공유**하며, **마켓별 로직이 PROJECTION에 직접 의존하지 않는다.**

---

## 0.1 개정 (Amendment v1.1, 2026-07-31) — **주문 API 연결은 Local Agent가 필요 없다** ⭐ 현행 계약

> 제품 오너 결정(우선순위 ① 현재 태스크). **이 §0.1이 아래 본문의 readiness gate 관련 서술보다 우선한다.**
> 본문 §5.A·§8의 `readiness_checking`/`agent_unavailable`/`renderer_unavailable`/`naver_login_required`/
> `naver_reconnect_required` 및 "Local Agent 페어링·가용을 준비 요건으로" 두는 서술은 **HISTORICAL(대체됨)** 이며
> **현행 주문 연결 계약이 아니다.** 구현: `feat/naver-api-issuance-tutorial-reliability-v1` (`f60328a`, `726a03f`).

- **주문(ORDER) API 연결은 Local Agent 없이 완주한다.** 가이드 리듀서에서 readiness gate(브리지/렌더러/
  NAVER-로그인)를 **제거**했다. Local Agent(G1 페어링 + 판매자센터 로그인 + Action Window)는 **연결 완료 후
  REVIEW_IMPORT 설정에서만** 필요하며, 최초 주문 연결의 게이트가 아니다.
- **현행 흐름**: `check_saved_credential` → (백엔드 capability **읽기 전용** 재개) → ①저장키+과거 sync 성공 시
  `completed` 복원(재실행 없음) / ②저장키만 있고 미완료 시 `connection_testing` **사용자 CTA** / ③키 없음 시
  3-경로 fork → **API 발급 튜토리얼**(공식 API센터 새 탭 + 체크리스트 + 단계별 도움말; 기존 앱은 재사용 안내,
  둘째 앱 생성 유도 금지) → 자격증명 입력 → 저장 → **연결 테스트 1회** → **첫 ORDER_SUMMARY sync 1회** →
  capability 결과 → `completed`.
- **capability 토큰**: ORDER_READ = 실제 sync 결과(성공 시에만 AVAILABLE + identityConfirmed);
  REVIEW_IMPORT = **SETUP_REQUIRED**(Local Agent 미페어링) ↔ **GUIDED_CONFIRMATION**(페어링) — **FE 오버레이**로
  페어링에 의해서만 전환(백엔드 정책값 GUIDED_CONFIRMATION 불변, 백엔드 변경 없음); REVIEW_REPLY =
  **NOT_ENABLED / UNVERIFIED**(자동 전송 없음); INQUIRY_READ = **INTEGRATION_PENDING**.
- **완료 후 새로고침·재진입 = 읽기 전용 복원**: 백엔드 capability 스냅샷만 읽어 완료 화면을 복원한다. **연결
  테스트·첫 sync를 재실행하지 않는다** → NAVER 토큰 mint 0 / order API 호출 0 / 신규 sync job 0. 상태가
  불완전하거나 sync 실패면 자동 재실행하지 않고 **사용자 CTA로만** 재시도한다. capability 조회 실패 시
  fail-safe(fork)로 안내하며 허위 완료·자동 sync 없음. React StrictMode에서도 test/sync 중복 0.
- **프라이버시**: Client Secret은 `api.storeCredential`로만 전달(리듀서/이벤트/sessionStorage/localStorage/로그
  미영속·미로깅); 튜토리얼 progress는 단계 id만(자격증명 값·account id 저장 금지); 재개 슬라이스는
  `{phase, path}`만.
- **API센터 UI 문구**: 행동 중심 hedged 문구 유지. 미확인 메뉴명·버튼명·주문 API 그룹명·정확한 URL은 **추측
  하드코딩 금지** — 라이브 walkthrough에서 operator read-only 관찰로 확정. (외부 참조는 API센터 URL 상수 1개.)
- **개발환경 신뢰성**: 프론트는 same-origin `/api` + Vite proxy(`SELLEROPS_BACKEND_ORIGIN`)로 단일화한다.
  절대 `VITE_API_BASE_URL`(stale 포트)로 로그인 실패하던 원인을 제거했고, preflight가 stale `VITE_API_BASE_URL`·
  포트 불일치를 **FAIL**한다. 브리지 flag OFF/DOWN이어도 주문 위저드는 정상이며, 브리지 상태는 REVIEW_IMPORT
  capability에만 반영된다. 실행 도중 backend 포트 변경 금지(고정 포트 + 프록시 타깃 일치 검사).

### 0.1.1 live walkthrough 기록 (sanitized) — 4회 halt, 라이브 액션 0

operator walkthrough는 지금까지 **네 번 halt됐고, 어떤 라이브 NAVER 액션도 발생하지 않았다**: NAVER
connection test = **0회**, ORDER_SUMMARY sync = **0회**, 자격증명 입력·저장 = **0**, NAVER API 호출 = **0**.
단일-사용 승인은 어느 시도에서도 **소비되지 않았다**. 1~3차는 precondition에서 막혔고, **4차는 모든
precondition을 처음으로 통과한 뒤(환경 바인딩·UI 로그인·런타임 일치 PASS) product-scope 블로커에서 credential
입력 직전에 멈췄다.**

- **1차(2026-07-31, ABORTED):** ① 프론트 API base가 stale(`VITE_API_BASE_URL`가 죽은 포트) ② 최초 주문
  연결에 **잘못 포함된 Local Agent readiness gate**. 둘 다 v1.1 개정에서 구조적으로 제거.
- **2차(2026-08-01, PRECONDITION_FAILED):** 프론트 origin 불일치(`127.0.0.1:5173` vs `localhost:5173`) —
  백엔드 CORS 허용 origin은 `http://localhost:5173` 하나뿐(`SELLEROPS_CORS_ORIGIN` 기본값)이라 `127.0.0.1`에서
  교차-origin 요청은 CORS 403(라이브 재현: 127.0.0.1→403 / localhost→200). 부차 원인: preflight가 실제 UI
  로그인을 검증하지 않고 `/health`·proxy만으로 PASS 선언.
- **3차(2026-08-01, ENVIRONMENT_IDENTITY_UNVERIFIED):** operator가 완료를 보고했으나 승인된 disposable 백엔드/DB
  에는 아무 흔적이 없었고(NAVER account/credential/sync/order = 0), 실 sellerops(:5432)에도 이번 run의 write는
  없었다(credential leak 0, external write 0). **확정 결함:** operator가 실제 조작한 브라우저 탭이 승인된
  프론트엔드/백엔드/DB/런타임과 동일한지 **암호학적·런타임 수준으로 바인딩되지 않았다.** stale 탭이나 다른
  환경은 **하나의 가능한 발현일 뿐** 단정하지 않는다. 결과적으로 operator가 다시 product-path 통합 검증자
  역할을 하게 되었다.
- **4차(2026-08-01, HALTED_PRE_CREDENTIAL — product-scope 블로커):** Environment Binding v1 이후 첫 시도로
  **모든 precondition을 통과**했다: env-binding smoke PASS, UI 로그인 PASS, 승인된 disposable 런타임(runId/git/
  dbAlias/backend origin) 일치, 배너·handshake 정상, baseline 0 유지. operator가 **credential 입력 직전에
  HALT**했고 라이브 액션은 0(credential 입력·저장 0, connection test 0, ORDER_SUMMARY sync 0, NAVER API 호출 0).
  **블로커 = API 발급 tutorial UX가 제품 요구와 불일치.** 현재 구현은 **정적 체크리스트형 설명**이지만, product
  owner가 요구한 tutorial은 **실제 NAVER API센터 페이지를 Action Window로 열고 단계별로 실제 컨트롤을 강조하는
  guided walkthrough**다(수동 진행은 항상 유지 — 자동 클릭/체이닝 금지, fail-closed 규칙 준수). 승인은
  **미소비로 기록하되 코드·범위 변경으로 폐기** — 재사용 금지, 향후 라이브는 새 bootstrap + 새 단일-사용 승인 필요.

**구조적 개선(2차, closed):** preflight의 유일 승인 origin = `http://localhost:5173` 강제(127.0.0.1 → FAIL);
실제 브라우저 UI 로그인 smoke를 최종 필수 게이트로 추가; 모든 dev env 파일의 절대 `VITE_API_BASE_URL` 금지;
sanitized runtime manifest; 회귀 self-check.

**구조적 개선(3차 — Environment Binding v1, closed):** 탭↔런타임을 **run identity로 바인딩**한다. bootstrap이
불투명 `walkthroughRunId`(자격증명·토큰 아님)를 1개 생성해 backend env·frontend env(`VITE_WALKTHROUGH_RUN_ID`)·
정확한 operator URL(`?walkthroughRun=<id>`)에 주입한다. ① 백엔드 **read-only `/api/walkthrough/context`**
(walkthrough 모드 전용 — production에서는 bean 부재 → 404; DB URL/secret/token/raw id 미노출); ② FE는 credential
form 진입 전 **URL runId == FE runId == backend context runId + origin 일치**를 모두 요구, 불일치면
`WALKTHROUGH_ENVIRONMENT_MISMATCH`로 fail-closed(자동 복구·다른 backend 탐색 없음); ③ **operator-tab handshake**
(runId+tabNonce+origin, **DB write 0**, sanitized 로그만) 성공 전에는 form·account bootstrap·NAVER 호출 금지;
④ 항상 보이는 **disposable 배너**(runId·gitSHA·dbAlias·backend origin·NAVER 호출 수)로 화면 runId를 CLI manifest와
육안 대조; ⑤ **page-load write 제거** — seller account 생성을 명시적 credential 제출로 지연(로드·새로고침·handshake
DB write 0); ⑥ preflight가 context runId·git 일치 + 브라우저 env-binding smoke(정확 URL→배너 runId→wizard,
0 NAVER 호출)를 최종 게이트로 요구하고 **phase별 단일 operator 행동 + expected runId/git/dbAlias**를 출력한다.
**operator 행동은 phase의 entrypoint 계약으로 결정된다**(§0.2.2): 이 guided-connection phase(`NAVER_GUIDED_CONNECTION`,
`FRONTEND_URL`)에서만 bound `/connect/naver?walkthroughRun=<id>` URL을 출력하고, calibration phase는
`CLI_LAUNCHED_DEDICATED_WINDOW`(SellerOps가 전용 Chrome 창을 엶)이라 frontend URL을 **절대 출력하지 않는다**. 도구:
`tools/naver-local/{bootstrap.sh, run-backend-local.sh, run-frontend-local.sh, env-binding-smoke.mjs, preflight.sh,
preflight-selfcheck.sh}`. **향후 라이브는 코드/프로세스 재시작으로 기존 승인 폐기 → 바인딩 완료 + 새 runtime
manifest 생성 후 새 단일-사용 승인 필요.**

> **승인 규칙 정본:** live-run 승인(Standing Safety Contract · Approval Manifest · 한 줄 `Seated and ready.` ·
> lifecycle · READ_ONLY vs WRITE)은 이제 [`docs/sellerops_live_approval_contract.md`](../sellerops_live_approval_contract.md)
> 에 한 번만 정의된다. 이 슬라이스는 그 계약을 참조하며 승인 규칙을 재기술하지 않는다. bootstrap/preflight가
> Approval Manifest를 준비·표시하면 기본 승인은 한 줄이고, 상세 승인이 필요한 예외는 정본 §3에 있다. 아래
> §0.1.1의 과거 walkthrough 기록에 남은 긴 승인문은 **당시 기록**이며 현재 표준이 아니다.

## 0.2 개정 (Amendment v1.2, 2026-08-01) — **API 발급 tutorial = Action Window guided walkthrough** ⭐ 현행 계약

> product owner 결정(우선순위 ① 현재 태스크). 4차 walkthrough halt의 블로커(§0.1.1)를 해소한다. §0.1의 "API 발급
> 튜토리얼(공식 API센터 새 탭 + 체크리스트)" 서술은 이제 **텍스트 fallback**을 가리키며, **기본 경험은 Action
> Window guided walkthrough**다. **오프라인/합성 전용 — 라이브 API센터 관찰·credential 입력·connection test·sync
> 없음.** 정확한 NAVER selector·메뉴명은 여전히 **미확정(candidate)** 이다.

- **무엇을 바꿨나.** `처음 발급` 경로에서 `화면을 보며 안내받기`(guided) 와 `텍스트로 직접 진행하기`(text) 를
  고른다. text = 기존 정적 체크리스트(불변). guided = **실제 API센터를 전용 브라우저로 열어 단계별로 실제 컨트롤을
  강조하는 Action Window**. 리듀서는 **1 phase(`application_issuance_guided`) + 1 event(`APPLICATION_ISSUANCE_MODE`)**
  만 추가했고 기존 전이(`account_store_choice_required → application_issuance`, saved/existing/have 경로)는 **바이트
  불변**이다.
- **기존 Action Window 인프라 재사용.** contract는 v2에 **intent `API_ISSUANCE_GUIDANCE`(ref 없음) + carrier
  `issuance`(fail-closed 교차-attach 방지)** 만 추가(신규 status/event/blocker 없음). 런타임은 `initial-import`을
  거울삼은 격리 엔진(`collector/src/action-window/api-issuance/`)이고, 페이지 감지는 **기존 `observe-api-center.ts`
  분류기 재사용**(모든 규칙 `LIVE_DOM_CALIBRATION_PENDING`). FE는 `OperationRunTimeline`·`ActionWindowControlPanel`·
  `AgentPairingPanel`을 재사용.
- **14개 필수 상태**(도메인 state machine → v2 계약 투영): `opening · waiting_login · locating_applications ·
  existing_app · empty_state · guiding_create · guiding_api_group · guiding_app_detail · guiding_credentials ·
  return_to_sellerops · guidance_complete · target_not_found · page_mismatch · operator_aborted`. 실제 UI 상태를
  **관찰해 분기**한다(앱 존재→`existing_app`/열기, 없음→`empty_state`/생성) — 사전 질문·고정 경로 없음. 로그인 미완/
  타깃 미발견/예상 밖 페이지는 **복구 가능한 park**, 취소는 `operator_aborted`. `guidance_complete`는 **발급 안내가
  끝났다는 뜻일 뿐, credential 저장·연결 완료가 아니다.**
- **Local Agent 경계.** guided sub-flow(`application_issuance_guided`) **에서만** Local Agent를 페어링한다(전용
  Chrome + overlay). **주문 API 연결은 여전히 Agent-free**(§0.1 불변): credential 입력·test·sync·saved/existing
  경로는 브리지에 의존하지 않는다. Agent 미가용 시 guided → **text fallback** 항상 제공.
- **금지(구조적으로 보장).** 자동 클릭·입력·제출 0, 앱 자동 생성 0, API 그룹 자동 선택 0, Application ID/Secret
  **DOM 값 읽기 0**(census는 counts/booleans만; wire는 opaque 16-hex sig만 — 원시 값이 sig로 오면 `target_not_found`
  로 fail-closed), clipboard·스크린샷·로그로 Secret 수집 0. source-guard 테스트가 click/read 토큰 부재를 강제한다.
  Secret 화면에서는 **위치만 강조**하고 값은 셀러가 SellerOps 마스킹 폼에 직접 입력한다.
- **라이브에서 확정할 selector 목록(현재 candidate).** page-category 규칙(login=password, credential_issuance=
  readonly, app_detail=editable, app_list=list container), existing-vs-empty(application-entry row count>0),
  control selector(`create_app`·`open_app`·`api_group`·`credentials`·`return`), probe branch(app_list→진행, 그 외→
  page_mismatch). 모두 라이브 G3-C walk 확정 대상 — 지금은 합성 fixture로만 검증.
- **v1.2 live wiring (2026-08-01, 합성 검증 완료 · 라이브 접속 0).** issuance 엔드포인트를 **Local Agent
  bootstrap에 등록**(`agent-bridge.ts`의 `apiIssuance` 캐리어 — export/reply/import과 **정확히 하나만** 상호배타;
  dev flag `--dev-action-window-issuance`는 production에서 OFF, fixture 드라이버) + **실제 Chrome 드라이버**
  `NaverIssuanceDriver`(`src/action-window/naver-issuance-driver.ts`; 전용 프로필·overlay·observer·census 재사용;
  창 열기·surface 분류·target highlight·사용자 이동/새 탭 감지만; 자동 click/input/submit 0; ID/Secret은 **영역
  존재만 구조 signature로 감지, 값 읽기 0**; URL은 host 카테고리로 축약해 로그/전송 안 함) + **게이트드 라이브
  진입점** `cli/run-api-issuance-live-naver.ts`(`--i-understand-this-opens-live-naver` 필수 + `screenApiCenterUrl`
  사전 fail-closed + import 시 inert; **이번 유닛에서 실행하지 않음**). 오프라인 fake-Page 테스트가 실제
  엔진·세션을 구동해 Secret-read=0·click=0를 증명. **다음 = read-only 라이브 관찰로 위 candidate selector
  보정** — 승인은 정본 계약(`docs/sellerops_live_approval_contract.md`)의 READ_ONLY Approval Manifest +
  한 줄 `Seated and ready.`. 보정은 **2단계로 분리**됐다: **Phase A `API_CENTER_STRUCTURE_OBSERVATION`**
  (`observe-api-center.ts`, 관찰·census·구조 힌트만 — highlight 0) → 결과를 selector adapter에 반영하고
  `SELECTORS_CALIBRATED=true`로 만든 뒤에야 **Phase B `API_ISSUANCE_HIGHLIGHT_PROOF`**
  (`run-api-issuance-live-naver.ts`, 실제 컨트롤 highlight 증명). 각 phase는 별도 manifest+승인이다.
  **1차 calibration prep(run wt-d44e9…/approval apr-e2b1…, 2026-08-01)은 `REVOKED_BEFORE_ACTION`
  (사유 `INCOMPLETE_PREREQUISITES_AND_PHASE_MISMATCH`)** — 필수 URL·정확한 CLI/driver·phase가 확정되지 않은
  채 PREPARED됐던 것이 원인. 라이브 액션 0(창 0·NAVER 호출 0·credential 0). 이후 approval-prerequisite 게이트
  (`collector/src/cli/approval-manifest.ts`)가 PREPARED를 "즉시 실행 가능" 상태로만 허용하도록 강화됨.
- **Multi-Surface 보정기(`calibrate-api-center.ts`)로 Phase A를 확장** — 한 승인으로 여러 surface를 순회하며
  operator의 hover+hotkey(`Ctrl+Shift+K`)로 실제 target 후보를 수집(raw는 gitignored `.calibration/`, 로그는
  sanitized 요약만). **1차 라이브 보정 시도(run wt-6b5e4…/approval apr-c337…, 2026-08-01)=`CALIBRATION_CAPTURE_FAILED`**:
  page classifier 관측은 유효(5건)했으나 **target 후보 0건**. 원인 = 캡처 리스너를 stage 시작(이동 전)에 설치해
  navigation/new-tab으로 소멸 → hotkey가 받을 리스너 없음. 라이브 안전 0(NAVER 호출·write·credential read·자동
  클릭 모두 0), 승인 CONSUMED. **단순 재시도 금지 → 코드 수정(reliability v1)**: 최신 탭 event-driven **re-arm** +
  값 노출 없는 **capture 확인 UX** + **4단계 계약**(`app_list → app_detail_anchor → api_group → credentials`;
  `return_path`는 API센터에 복귀 컨트롤이 없으므로 calibration/`SELECTORS_CALIBRATED`에서 제외, 마지막은 "SellerOps
  탭으로 직접 돌아가세요" UI 안내로 처리).
- **2차 라이브 보정 시도=`CALIBRATION_CAPTURE_FAILED`(again)** — host OK(`apicenter.commerce.naver.com`,
  host-screen 무관) / Ctrl+Shift+K **toast 안 뜸**(operator 페이지에 리스너 없음) / navigation은 URL path 변경
  (`/manage/list → /manage/detail;id=…`, 진짜 top-level 이동, iframe SPA 아님) / `stagesArmed=1`(stage 시작 초기
  arm만 성공, 이후 operator 이동으로 리스너 소멸). 라이브 안전 0(NAVER 호출·write·credential read·자동 클릭 모두
  0), 승인 CONSUMED. **원인**: re-arm이 stage 시작·wait 직전 2회만 실행되고, `waitForStageSentinel`이 stage 내내
  sentinel을 blocking-poll → **wait 도중 operator가 이동하면 재-arm이 뒤따르지 않아** hotkey가 리스너 없는 문서에
  떨어짐. event hooks(`page.on("load")`/`framenavigated`)는 이 이동에서 실제 브라우저에서 **발화하지 않음**.
  **수정(reliability v2)**: `waitForStageSentinel(stage, onTick)`로 시그니처를 바꿔 **poll tick마다 최신 탭을
  re-arm + kind 재주입**(≈1s 이내, `IS_CAPTURE_ARMED`로 idempotent) — event hooks는 best-effort 보조로만 유지.
  회귀 테스트는 **wait 도중 navigation → tick 전 hotkey=0캡처 → onTick tick 후 hotkey=성공/stage advance**를
  실제 orchestrator로 재현. `SELECTORS_CALIBRATED`는 여전히 미설정(라이브 재보정 필요, 새 승인 게이트).
- **3차 라이브 보정 시도=`CALIBRATION_CAPTURE_FAILED`(crash, not capture-miss)** — v2 per-tick re-arm이 실제로
  발화했으나, operator가 **evaluate 도중 이동**하면 execution context가 파괴되어 `page.evaluate`가 reject하고,
  이 rejection이 **uncaught → calibrator 프로세스 crash**(Chrome 닫힘). 라이브 안전 0(NAVER 호출·write·credential
  read·자동 클릭 0), 아티팩트 미기록(캡처 전 crash), 승인 CONSUMED. **수정(reliability v2.1)**: `buildPageSessionDeps`
  의 모든 page-bound seam을 `safeEval`/`safeVoid`로 감싸 **navigation race(“Execution context was destroyed”/
  “Target closed”/frame detached)를 삼키고 fail-closed fallback 반환**(census→EMPTY, captured→null⇒capture-required,
  armed-check→true⇒그 tick arm skip; 값/셀렉터 노출 0, 최초 1회만 sanitized name 로그) + `void main().catch`
  최상위 가드(ctx는 finally에서 이미 close). seam 단위 테스트(evaluate/url가 reject하는 fake Page → 모든 seam
  throw 없이 fallback)로 crash 지점을 직접 커버. 독립 리뷰 HIGH=0 MED=0. **여전히 라이브 재보정 필요(새 bootstrap +
  새 단일-사용 승인); `SELECTORS_CALIBRATED` 미설정.**

### 0.2.1 개정 — **polling/evaluate re-arm 모델 RETIRED → init-script event-driven capture** ⭐ 현행 capture 계약

> 세 번의 라이브 실패(§0.2 1·2·3차)는 하나의 근본 원인 — **Node가 in-page 리스너를 설치/재설치하려 한다**는 설계 —
> 의 서로 다른 증상이었다(리스너가 navigation으로 소멸 / wait 도중 재설치 부재 / 재설치 evaluate가 navigation과
> race하여 execution context 파괴·crash). 이 재보정 시도들을 버그 목록이 아니라 **폐기 근거**로 기록한다: 위
> 세 증상은 재설치를 Node polling에 두는 한 제거 불가능하다. capture 모델을 **race-immune**하게 교체했다.

- **새 정식 capture 계약(구현: `calibration-inpage.ts`/`calibration-binding.ts`/`calibrate-api-center.ts`, 오프라인):**
  - **`BrowserContext.addInitScript`** 로 capture 리스너(hover·passive-click·hotkey 3종, capture phase)를 **한 번**
    설치한다 → Playwright가 **모든 새 document(navigation/reload/new-tab)와 모든 child frame에서, 페이지 자체 스크립트
    보다 먼저 자동 재실행**한다. operator가 어디로 이동하든 리스너는 항상 살아 있으며 **Node 재-arm이 존재하지 않는다.**
    document당 idempotent(`window.__soCalInstalled__` 플래그; 새 realm은 플래그가 없어 정확히 1회 설치).
  - **`BrowserContext.exposeBinding`** 로 두 `window` 함수를 모든 frame에 설치: stage pull(`__soCalStage__`,
    현재 `{nonce,kind}` 읽기 전용)과 capture push(`__soCalCapture__`, 구조 전용 payload를 fire-and-forget으로 Node에
    전달). init script는 상수 보간으로 두 이름을 참조(divergent 하드코딩 금지).
  - **Node 검증(fail-closed, 절대 throw 안 함)**: frame URL host allow-list(`api_center_host`/`naver_auth_host`)
    → active-tab(newest) → active stage 존재 + `stageNonce` 일치 → **nonce당 first-valid만** 채택(tab/frame 중복
    무시). frame category는 `source.frame === source.page.mainFrame()`로 **권위적으로 재도출**(payload 주장 신뢰 안 함).
  - **census만 `page.evaluate`로 남는다** — 그리고 **settled checkpoint(stage 시작 / ready)에서만** 호출된다(polling
    루프 아님). `safeEval`/`safeVoid` 래핑 유지. capture-required toast도 settled 1회. **polling `page.evaluate`가
    navigation과 race할 지점이 더는 없다.**
  - 폐기된 경로(명시 제거): 퍼-틱 `onTick` re-arm, `IS_CAPTURE_ARMED` 재-arm 게이트, `context.on("page")`/
    `page.on("load")`/`framenavigated` 이벤트 재-arm, `ARM_CALIBRATION_CAPTURE`/`READ_CAPTURED_TARGET`/
    `READ_CLICK_OBSERVED`/`RESET_CAPTURE`/`buildSetTargetKind`.
- **회귀 테스트**: RUN_INTEGRATION real-Chromium 계약 테스트가 (#1) navigation/reload/new-tab/child-frame 자동 설치,
  (#2) 재-arm 0으로 top·child frame hotkey capture 성공, (#3) flow 도중 navigation에서 unhandled rejection·crash
  0을 고정한다. Node 채널 유닛 테스트가 host/tab/nonce/first-valid 거부 + 권위적 frame category + throwing
  `source.frame.url()` 삼킴을 고정한다. 값(`.value`/text/HTML)·클립보드·스크린샷·생성/차단 클릭 0(source-guard가
  세 파일 모두 스캔).
- **안전 불변식 유지**: 값 미판독(자격증명 위치만), sanitized 요약만 로그(원 셀렉터·값·URL 금지; raw는 gitignored
  `.calibration/`), 자동 로그인·클릭·발급 0. **`SELECTORS_CALIBRATED`는 여전히 false** — 라이브 재보정은 새 bootstrap +
  새 단일-사용 승인 필요. (본 개정은 오프라인 구현·테스트만; 라이브 실행·push·PR 없음.)

### 0.2.2 개정 — **phase별 operator ENTRYPOINT 계약(공통 boilerplate 제거)** ⭐ 현행 preflight 출력 계약

- **폐기된 승인(sanitized):** 2차 Phase A calibration prep(run `wt-895df…`/approval `apr-1ca6…`, git `654e663`,
  2026-08-02, disposable `naver_walkthrough`)은 preflight PASS로 PREPARED 되었으나 라이브 액션 직전
  **`REVOKED_BEFORE_ACTION`** 으로 폐기. 사유 **`PHASE_OPERATOR_ENTRYPOINT_MISMATCH`**: preflight PASS가 phase와
  무관하게 주문 연결용 `/connect/naver?walkthroughRun=<id>` URL을 유일 `operator URL`로 출력했는데, Phase A의 실제
  operator entrypoint는 **calibrator CLI가 여는 전용 Chrome**이다. 라이브 액션 0(live Chrome 0, API센터 접속 0,
  NAVER 호출/write/credential 0, selector artifact 0, 승인 미소비). backend/frontend는 폐기 시 종료.
- **근본 원인:** preflight PASS 블록이 **모든 phase에 대해** frontend URL 한 줄을 무조건 출력 — CLI-launched
  calibration phase에는 존재하지 않는 행동을 지시.
- **수정 = phase별 entrypoint 계약(순수 `approval-manifest.ts`).** phase마다 하나의 entrypoint를 선언한다:
  - `API_CENTER_STRUCTURE_OBSERVATION` → `CLI_LAUNCHED_DEDICATED_WINDOW`, cli `src/cli/calibrate-api-center.ts`,
    frontend URL 출력 금지. 표시: "승인 후 SellerOps가 전용 Chrome 창을 엽니다 — 열린 창에서 직접 로그인·이동 후 hotkey 캡처".
  - `API_ISSUANCE_HIGHLIGHT_PROOF` → `CLI_LAUNCHED_DEDICATED_WINDOW`, cli `src/cli/run-api-issuance-live-naver.ts`,
    frontend URL 출력 금지.
  - `NAVER_GUIDED_CONNECTION` → `FRONTEND_URL`. **이 phase에서만** bound `/connect/naver?walkthroughRun=<id>` 출력.
  - Approval Manifest에 `entrypointType`·`entrypointCommandId`·`operatorActionSummary` 추가. `validateEntrypointContract`가
    manifest 생성 **전에** FAIL: type/CLI 불일치(`ENTRYPOINT_TYPE_MISMATCH`/`ENTRYPOINT_CLI_MISMATCH`), CLI entrypoint에
    frontend URL(`FRONTEND_URL_IN_CLI_ENTRYPOINT`), frontend entrypoint에 CLI-only 설명(`CLI_DESC_IN_FRONTEND_ENTRYPOINT`).
  - preflight PASS는 phase의 `entrypointType`으로 **단일 operator 행동만** 출력(URL은 FRONTEND_URL phase에서만). 원
    command·API센터 raw URL은 로그/manifest 미노출(host 카테고리·sanitized commandId만). 승인 안전 enforcement·live
    driver는 불변.
- **테스트**: `approval-manifest.test.ts`(Phase A/B manifest에 frontend URL 0, guided만 URL 방출, 4개 mismatch→FAIL,
  PREPARED 후 추가 입력 0) + `preflight-selfcheck.sh`(GUIDED만 bound URL, PHASE_A는 전용 Chrome 행동 + frontend URL 0).
  (본 개정은 오프라인 구현·테스트 + phase-aware preflight 출력 검증만; 라이브 실행·push·PR 없음.)

### 0.2.3 개정 — **hotkey calibration 반복 중단 → Visual Recon(redacted-screenshot) 전환** ⭐ 현행 calibration 전략

- **동기(sanitized):** `3f4f94d`에서 라이브 Phase A hotkey calibration 1회 수행(4 stage walk, crash/abort 0 —
  init-script 신뢰성 모델 입증) 결과 **1/3만 resolved**(create_app matchCount=1; api_group matchCount=3
  unresolved_multiple; credentials matchCount=0 unresolved_none). 어떤 대상도 stableId/testAttr 없음. hotkey로
  operator가 요소를 하나씩 지목하는 방식은 API센터 DOM에서 안정 selector를 얻지 못함. **`SELECTORS_CALIBRATED=false` 유지.**
- **전환:** operator가 요소를 직접 선택하는 대신, SellerOps가 **민감정보를 먼저 가린 실제 화면을 캡처**하고 Claude가
  redacted 이미지 + 제한된 구조 정보를 함께 검토해 selector 후보를 찾는다. hotkey capture는 즉시 재실행하지 않는다.
- **구현(오프라인만):** 순수 코어 `collector/src/action-window/api-issuance-calibration/visual-recon.ts`
  (`verifyRedaction` fail-closed 게이트 + `mayScreenshot` + `sanitizeVisualSummary` no-leak + `evaluateSelectorCandidate`
  5조건), in-page 문자열 스크립트 `visual-recon-inpage.ts`(redaction apply/verify 오버레이 + 구조-only census;
  page를 떠나는 값은 정수/불리언뿐 — redaction 검출용 텍스트 read는 count만 반환, 원문 미방출), 게이트된 CLI
  `collector/src/cli/capture-api-center-visual.ts`(inert on import).
- **강제 순서(fail-closed):** operator `ready` → 모든 frame에 opaque 오버레이 적용 → 카테고리별·frame별 커버리지 검증
  → **PASS일 때만** viewport 스크린샷(버퍼, `path:` 옵션 없음) → 사후 재검증(오버레이 유지 확인, regression 시 이미지 폐기)
  → gitignored `.calibration/visual/`에 redacted PNG + sanitized JSON 저장. **redaction 검증 실패 = 스크린샷 0(HALT).**
- **redaction 대상:** input/textarea/select 값, password/readonly/`code`/`pre`, Client ID/Application ID/Secret 영역,
  복사-연결 값 상자, 식별 텍스트(이메일/계정/스토어 id), header/footer 크롬. 고정 UI 라벨은 보이도록 남긴다.
  **credentials 값/필드는 selector 대상 아님** — 섹션/라벨/컨트롤 위치만. 값은 redaction 뒤 Claude에게도 안 보인다.
- **테스트:** `visual-recon.test.ts`(verdict fail-closed 9종, hostile no-leak, 채택 게이트 5조건),
  `visual-recon-guard.test.ts`(in-page 반환 정수-only + 금지 sink 부재; CLI gated + `.screenshot(`는 `mayScreenshot`
  게이트 뒤 + `path:` 옵션 없음), `capture-api-center-visual.test.ts`(오케스트레이터 fakes: HALT/pass/사후-regression 폐기/
  ready당 1회/skip/abort). collector 오프라인 스위트 전체 green.
- **미수행(명시):** 라이브 runtime·스크린샷·API센터 접속·selector 채택·`SELECTORS_CALIBRATED=true`·push/PR 없음.
  다음 라이브는 새 single-use 승인 필요.

### 0.2.4 개정 — **Visual Recon을 approval-manifest/preflight 계약의 1급 phase로 배선** (오프라인)

- **동기:** §0.2.3의 Visual Recon 드라이버(`capture-api-center-visual`)는 **자체 플래그 게이트 + 자체 runId**만
  가진 독립 CLI였고, `approvalId`+PREPARED manifest를 발급하는 preflight/approval-manifest 계약과 **미배선**
  이었다. 그 계약은 `API_CENTER_STRUCTURE_OBSERVATION` phase를 **hotkey 드라이버**에 고정하고 있어, 그대로 preflight를
  돌리면 hotkey 드라이버 manifest가 나와 Visual Recon 계약과 모순된다. → 제품 오너 결정: **기존 phase 재지정이 아니라
  새 phase 추가**로 hotkey 경로를 보존한다.
- **변경(collector + tools만, 마이그레이션/백엔드/contract 없음):** 새 calibration phase **`API_CENTER_VISUAL_RECON`**
  추가(`approval-manifest.ts`): 드라이버 `capture-api-center-visual`, 액션 `REDACT_SENSITIVE_REGIONS`/
  `CAPTURE_REDACTED_VIEWPORT`(highlight/click-observe 불가), CLI-launched dedicated-window 엔트리포인트
  `capture-api-center-visual`(frontend URL 없음). manifest에 `captureScreens`(=드라이버 고정 `VISUAL_RECON_SCREENS`
  단일 출처), `artifactCategory`=`.calibration/visual/`(gitignored), `screenshotPolicy`="redacted viewport only",
  `structuralSummaryPolicy`="sanitized closed-vocabulary only", `hotkey`=""(없음), `operatorPresenceRequired`=true,
  `expiresAt`=process-lifetime. **hotkey 강제 없음**; artifact 경로는 `.calibration/visual/` sink 하위만 허용
  (아니면 `ARTIFACT_PATH_UNSAFE`), 화면 세트 자기일치 위반은 `VISUAL_SCREENS_MISMATCH`. 원본 URL은 host 카테고리로만.
- **preflight:** 기존 generic calibration 분기가 그대로 처리(phase/entrypoint를 tested manifest에서 도출) + Visual
  Recon 전용 요약(redact-then-capture·screens·gitignored sink·미커버 시 HALT) 출력.
- **테스트:** `approval-manifest.test.ts`에 Visual Recon 6종 추가(PREPARED 필드, highlight 거부, sink-외 경로 거부,
  cli/driver 확정, dedicated-window·원본 URL 부재, 스펙=`VISUAL_RECON_SCREENS` 드리프트 가드). collector 6034 green,
  typecheck clean.
- **미수행(명시):** 라이브 runtime·스크린샷·API센터 접속·selector 채택·`SELECTORS_CALIBRATED=true`·push/PR 없음.
  라이브 준비(격리 DB/backend/frontend/bootstrap/preflight·전용 Chrome)는 **다음 턴** + 새 single-use 승인.

### 0.2.5 개정 — **Visual Recon LIVE 검증 완료 + 6개 fixed-label selector 채택** ⭐ 현행 calibration 상태 (HEAD `a256c91`)

실제 NAVER API센터에서 Visual Recon(redacted-screenshot) 라이브 검증을 완료했다. 최종 결과·결정만 기록한다.

- **redaction 계약 real-NAVER 검증 완료:** 계정 핸들 / API호출 IP / Client ID(애플리케이션 ID 값)는 가려지고,
  **공개 스토어명·일반 앱 설명은 노출**된다. 뷰포트 밖 요소·미렌더 노드(접힌 계정 메뉴)는 캡처 대상 아님으로
  처리해 오탐 HALT 없음. 캡처 직후 오버레이 자동 제거. `app_detail/api_group/credentials`는 동일 페이지의
  viewport checkpoint, `app_list`만 별도 페이지로 안내.
- **6개 fixed-label target 모두 live `matchCount=1`:** `애플리케이션 등록`(register), `애플리케이션 ID`(app_detail
  섹션 앵커), `API 그룹`(섹션), `애플리케이션 ID`(credentials 라벨), `보기`, `복사`. `app_detail` 섹션은 본문
  `애플리케이션` heading이 사이드바 그룹라벨+브레드크럼과 3중복이라, 고유한 `애플리케이션 ID` 라벨로 앵커한다.
- **`다시사용`(reactivate)은 미검증:** 측정 시점에 일시중단 앱이 없어 register-state로 `0`. 일시중단 앱에서 별도 측정 필요.
- **채택:** 위 6개를 `collector/src/action-window/api-issuance-calibration/visual-recon-adopted.ts`에 **채택**했다
  (선택자는 candidate 제안을 그대로 재사용해 드리프트 방지, frozen `evaluateSelectorCandidate` 게이트로 채택 가능성
  기계 증명). `다시사용`(0 live)·`시크릿` 라벨(CREDENTIAL_VALUE_TARGET 차단)은 제외.
- **경계(핵심):** 이 6개는 **reviewer/tutorial용 Playwright `role=`/`text=` selector**다. Phase B issuance
  highlight driver(`NaverIssuanceDriver`)가 쓰는 `CANDIDATE_TARGET_SELECTORS`(create_app/open_app/api_group/
  credentials/return)는 **CSS `querySelectorAll` 기반의 클릭 대상 selector**로 **완전히 별개**이며, `open_app`·
  `return`은 아직 미측정이다. 따라서 이 채택은 issuance selector를 보정하지 않는다.
  → **`SELECTORS_CALIBRATED=false`가 정확한 현재 상태**(그 플래그는 issuance highlight 계약용). 채택은
  `api-center-adapter.ts`/`CANDIDATE_TARGET_SELECTORS`를 건드리지 않았다.
- **미완료(명시):** ① create_app/open_app/api_group/credentials/return용 **실제 CSS(클릭 대상) selector 보정**,
  ② **Phase B `API_ISSUANCE_HIGHLIGHT_PROOF`**(highlight proof). 이 둘을 완료하는 커밋에서만
  `SELECTORS_CALIBRATED=true`로 전환한다.
- **다음 큰 개발 단위 = `NAVER API Issuance Highlight Selector Calibration`** (issuance clickable selector
  라이브 보정 → highlight locator 교체 + 조건 충족 시 `SELECTORS_CALIBRATED=true` → Phase B highlight proof).
  → **이 단위는 §0.2.6에서 착수·구현되었다** (아래가 현행 calibration 상태로 §0.2.5의 driver-selector 서술을 갱신).

### 0.2.6 개정 — **Phase-B highlight selector 보정 + read-only selector-probe 단계** ⭐ 현행 calibration 상태

`NAVER API Issuance Highlight Selector Calibration v1` 단위. Phase B highlight driver를 실제 강조 가능한 4개
컨트롤 기준으로 보정하고, driver 자체 locate 메커니즘을 라이브로 검증할 **read-only selector probe** 단계를
추가했다. **오프라인/합성 전용 — 라이브 highlight 실행·클릭·credential 입력 없음.**

- **highlight locator 보정(드리프트 없음):** 새 순수 모듈
  `collector/src/action-window/api-issuance-calibration/issuance-highlight-selectors.ts`가 4개 highlight target을
  **고정 라벨 locator**(`{candidateQuery, exactText}` — 구조 쿼리 + 고정 NAVER 라벨)로 매핑한다. `create_app`·
  `api_group`·`credentials`는 §0.2.5의 visual-recon **채택 세트에서 그대로 파생**(단일 소스, `VISUAL_RECON_LABEL_PROBES`
  재사용, 앱이름/credential값/좌표 비의존) → live `matchCount=1` 근거 위에 `live_confirmed`. NAVER 컨트롤은 aria-label/
  id가 없어 **고정 라벨이 유일한 value-free 앵커**다. **§0.2.5의 "driver는 CSS `[data-aw-target]` 픽스처를 쓴다"
  서술을 이 개정이 갱신한다** — highlightable target은 이제 fixed-label locator를 쓴다(합성 픽스처 아님).
- **`open_app` 미보정(정직한 분리):** 기존 앱 "열기"는 그 앱의 정체성에 의존(고정 라벨 없음)이라 `no_fixed_label`로
  두고 locator 없음 → **existing-app 경로 = `not_ready`**, **new-app 경로(create_app→api_group→credentials) =
  `ready_candidate`**. driver는 `open_app`을 fail-closed(`count:0`)로 처리해 존재-앱 분기가 **복구 가능한
  `target_not_found` park**(오강조·클릭 0)로 멈춘다.
- **`return`은 selector 대상에서 제거 → 안내 전용:** API센터에 복귀 컨트롤이 없으므로 NAVER DOM을 조회하지 않고
  "SellerOps 탭으로 돌아가세요" 오버레이만 표시, 합성 고정 signature(HEX16, 페이지 요소 비파생) 반환. `guidance_complete`
  는 튜토리얼 종료를 뜻할 뿐 credential 저장·연결 아님(마켓 액션 0).
- **fixed-label locate = value-free OUTPUT:** driver는 `buildFixedLabelLocateScript`(visual-recon-inpage)로 라벨을
  대조하고 **`{count, sig}`만 반환**(텍스트/값 미반환; sig=tag+문서index+childCount 구조 해시). 별도 소스가드로
  value-free 출력 증명. 읽기전용 `probeTargetMatch(target)`(count+highlight 가능 여부, 태깅·오버레이·클릭 0) 추가.
- **새 read-only 단계 `API_ISSUANCE_SELECTOR_PROBE`:** 게이트드 CLI `collector/src/cli/probe-issuance-selectors.ts`
  + 순수 orchestrator. 각 화면에서 operator가 이동·ready하면 각 target의 고정 라벨 matchCount·highlight 가능
  여부만 측정(강조·클릭·값 읽기 0, sanitized 정수/불리언 출력). **`allowsHighlight:false`라 `SELECTORS_CALIBRATED`
  없이도 PREPARE 가능** — 이 단계가 driver 메커니즘을 라이브 확인하는 근거이자, 이후 플래그 전환의 선결 조건이다.
- **`SELECTORS_CALIBRATED`는 여전히 false, `api-center-adapter.ts` 무변경.** 전환 조건: ① selector-probe가 driver
  자체 메커니즘으로 각 calibrated target을 라이브 `matchCount=1` 확인 **AND** ② `open_app` 보정 → 그 뒤 Phase B
  highlight proof. 지금 커밋은 어느 것도 하지 않는다.
- **게이트·리뷰:** collector 전체(typecheck + 6138 tests) 그린; 독립 적대적 리뷰 **HIGH=0 MED=0**(2 LOW 반영:
  candidateQuery 드리프트 핀 + 텍스트-읽기 스니펫은 감사된 fixed-label locate만 허용). **라이브 highlight 실행·
  클릭·credential 입력·push/PR 없음.** 완료 후 **fresh `API_ISSUANCE_SELECTOR_PROBE` runtime을 PREPARED**까지만
  만들고 승인 대기.

### 0.2.7 개정 — **selector-probe LIVE 검증(3개 fixed-label) + open_app 구조 앵커 후보** ⭐ 현행 calibration 상태

`API_ISSUANCE_SELECTOR_PROBE`를 실제 NAVER API센터에서 라이브 실행하고(단일-사용 승인 소비), `open_app`에 value-free
구조 앵커 후보를 추가했다. **`SELECTORS_CALIBRATED`는 여전히 false, `api-center-adapter.ts` 무변경.**

- **selector-probe LIVE 검증 완료(2026-08-02, 실제 NAVER, 읽기 전용):** 운영자 승인("Seated and ready.") 하에
  gated 읽기전용 probe를 3개 화면에서 실행. **driver 자체 fixed-label locate 메커니즘이 각 calibrated target을
  라이브 `matchCount=1`로 해석**: `create_app`(애플리케이션 등록)=1, `api_group`(API 그룹)=1, `credentials`(애플리케이션
  ID)=1 (`uniqueCalibrated:3 nonUniqueCalibrated:0`). `open_app`=0(당시 미보정). **강조·태깅·클릭·값 읽기·credential
  입력 0**, sanitized 정수 출력만, host category만, 브라우저 종료·아티팩트 0. → 플래그 전환 선결 ①(probe가 driver
  메커니즘으로 calibrated target 라이브 확인) = create_app/api_group/credentials에 대해 **충족**.
- **`open_app` = value-free 구조 앵커 후보(불확정):** 기존 앱 열기는 그 앱 정체성에 의존이라 고정 라벨 없음 → 대신
  **단일 애플리케이션-엔트리 ROW**(`OPEN_APP_STRUCTURAL_SELECTOR` = driver의 app-entry row 가설과 동일, 테스트로 핀)를
  **구조 selector COUNT**로 매칭(텍스트/값 읽기 전혀 없음). NAVER 1-앱/스토어면 유일. `status:"structural_candidate"`
  (`LIVE_DOM_CALIBRATION_PENDING`, screenshot 미확인 → 채택 게이트에서 `NOT_UNIQUE`+`SCREENSHOT_TARGET_UNCONFIRMED`로
  unadoptable). **existing-app 경로는 여전히 `not_ready`.**
- **가이드 vs 측정 분리(핵심 안전 경계):** `structural_candidate`는 **guided-highlightable 아님**(`isGuidedHighlightTarget`
  = live_confirmed만). 라이브 guided walk(`NaverIssuanceDriver.locate/highlight/armObserve`)는 미확정 앵커를 **절대
  강조하지 않고** `open_app`에서 fail-closed park(`target_not_found`)한다 — 구조 locate 스크립트조차 실행 안 함. **읽기전용
  `probeTargetMatch`만** 후보를 측정(측정 ≠ 강조; 이것이 후보의 승격 근거). 독립 리뷰 MEDIUM(라이브 guided runner가
  미측정 앵커를 강조할 수 있음)을 이 게이트로 해소.
- **미완료:** ② `open_app` 앵커의 라이브 유일성 확인(다음 probe run이 `structuralCandidatesUnique`로 측정) → 유일하면
  승격 → 그 뒤에만 플래그 전환 + Phase B highlight proof. broad row selector가 라이브에서 다수 매칭될 가능성 있음(그때는
  구조 관찰로 앵커 정밀화 또는 new-app 전용 범위).
- **게이트·리뷰:** collector 전체(typecheck + 6144 tests) 그린; 독립 적대적 리뷰 HIGH=0, MEDIUM(guided 미측정 앵커
  강조)= **수정 완료**. **라이브 highlight·클릭·credential·push/PR 없음.** 완료 후 fresh `API_ISSUANCE_SELECTOR_PROBE`
  runtime을 PREPARED(이제 `open_app` 구조 앵커도 측정)까지만 만들고 승인 대기.

### 0.2.8 개정 — **`SELECTORS_CALIBRATED=true`(new-app 경로 한정) + Phase B는 신규 앱 경로로 범위 확정** ⭐ 현행 calibration 상태

2차 selector-probe 라이브 결과로 `open_app` 구조 앵커가 유일하지 않음이 확인되어, **제품 오너 결정: Phase B를
new-app(신규 앱 생성) 경로로 한정**하고 `SELECTORS_CALIBRATED`를 그 범위에서 전환했다.

- **2차 probe 라이브(2026-08-02, 실제 NAVER, 읽기 전용, 승인 소비):** 3개 fixed-label 재확인 `matchCount=1`
  (uniqueCalibrated:3). **`open_app` 구조 앵커 = 44 매칭(non-unique) → `structuralCandidatesUnique:0`.** broad
  app-entry-row selector가 페이지의 nav/menu/list 행 44개를 잡아 **유일 해석 실패**. guided gate로 강조 0.
- **`SELECTORS_CALIBRATED` = `false`→`true`(new-app 한정, `api-center-adapter.ts`):** 라이브 driver는 더 이상
  `CANDIDATE_TARGET_SELECTORS`(합성 fixture 마커로 강등)로 강조하지 않고 calibrated fixed-label registry로 강조한다.
  `create_app`/`api_group`/`credentials`는 **읽기전용 probe 2회로 라이브 `matchCount=1` 증명** → 이 3개에 한해 플래그
  전환. **플래그 전환 선결 ①②를 new-app 경로에 대해 충족**으로 간주(② open_app은 범위 제외).
- **`open_app`/existing-app 경로 = v1 범위 제외:** `structural_candidate`(44 non-unique) 유지, `not_ready`.
  `isGuidedHighlightTarget` 게이트로 라이브 guided walk는 open_app에서 **fail-closed park**(강조 0). ⇒ **Phase B
  highlight proof는 빈-앱 스토어(생성 분기)에서만 유의미**; 기존 앱 있으면 open_app park.
- **Phase B highlight proof(`API_ISSUANCE_HIGHLIGHT_PROOF`) = implementation complete / live proof PENDING —
  requires empty-app store.** new-app 경로 구현·보정 완료(플래그 전환 + guided highlight 준비). **라이브 proof는
  보류**: NAVER는 앱 삭제 불가(비활성화만)라 **빈-앱 스토어가 없어** 생성 분기를 실증할 수 없다. PREPARED manifest/
  임시 runtime은 **회수**(단일-사용 grant **미소비**); 향후 라이브는 **빈-앱 스토어 + 새 bootstrap + 새 단일-사용
  승인** 필요. 우회 proof 없음.
- **existing-app 경로는 계속 `not_ready`**(open_app `structural_candidate` 44 non-unique, v1 범위 제외).
- **게이트·리뷰:** collector typecheck + 6145 tests 그린; 독립 리뷰(플래그 전환) **PASS HIGH=0 MED=0**(1 LOW 반영:
  플래그 값 핀). **라이브 highlight·클릭·credential·push/PR 없음.**
- **향후 open_app 재개 시:** app_list-with-app 구조 관찰로 좁고 안정적인 value-free 앵커 확정 → 재-probe → 유일하면
  승격(existing-app 경로 복귀). 현재는 new-app 한정.

### 0.2.9 개정 — **`NAVER Existing-App Guided Connection v1`: open_app = 강조가 아닌 NAVIGATION 안내, 두 경로 모두 `ready_candidate`** ⭐ 현행 issuance 상태

0.2.8은 `open_app`(기존 앱 열기)을 라이브에서 유일 해석 실패(44 매칭)한 구조 앵커 후보로 두고 existing-app 경로를
`not_ready`로 남겼다. 본 단위는 **접근을 바꿔** 기존 앱 판매자도 튜토리얼을 완료하게 한다: **특정 앱 행을 강조하려는
시도를 폐기**하고, `open_app`을 **강조 타깃이 아닌 NAVIGATION 안내**로 재정의한다.

- **`open_app` = NAVIGATION 안내(강조·selector 제거).** `ISSUANCE_HIGHLIGHT_TARGETS`에서 제거 → 이제 강조 컨트롤은
  `create_app`/`api_group`/`credentials` 3개뿐. `OPEN_APP_STRUCTURAL_SELECTOR`·`structuralSelectorFor`·
  `buildStructuralLocateScript`·`structural_candidate` 상태 **전부 삭제**(코드에서 미측정 구조 앵커 기계 제거). `open_app`은
  `ISSUANCE_GUIDANCE_ONLY_TARGETS`(+`ISSUANCE_NAVIGATION_TARGETS`)에 편입.
- **런타임 흐름(engine/driver/session):** 기존 앱 존재 → step2에서 **안내 문구**("연결할 애플리케이션을 직접 열어주세요")
  오버레이만 표시(합성 `OPEN_APP_GUIDANCE_SIG`, NAVER DOM 질의 0). 드라이버는 **판매자의 `app_list → app_detail`
  전환만 관찰**(sanitized 페이지 CATEGORY 폴링; 클릭·태그·값읽기 0). 관찰 후 엔진이 **`VERIFY_OPEN` 재-probe**로
  app_detail을 **검증한 뒤에만** step2 완료 처리하고 **calibrated `api_group`/`credentials` 강조 흐름을 재사용**.
- **잘못된 페이지·다중 전환 = recoverable park.** `VERIFY_OPEN`이 app_detail이 아니면 `page_mismatch`(login이면
  `waiting_login`) 회복 park — step2 미완료, api_group 미강조. `REQUEST_STEP_RECHECK`로 상단부터 재-probe 복구.
- **두 경로 모두 readiness 반영:** `issuancePathReadiness`가 이제 **`new_app`·`existing_app` 모두 `ready_candidate`**
  (existing-app의 강조 타깃 api_group/credentials가 live_confirmed; open_app은 강조 없는 안내 단계라 보정 대상 아님).
  `SELECTORS_CALIBRATED`는 계속 `true`(강조 컨트롤 3개가 유일 근거) — existing-app이 **새 selector를 추가하지 않음**.
  FE는 정적 위저드(`NAVER_EXISTING_APP_TUTORIAL`)가 이미 기존-앱 단계를 보유 → 계약 enum(stepId/copyKey/targetKind)
  불변, FE 변경 없음.
- **게이트·리뷰:** collector typecheck 그린 + 전체 **6144 tests 그린**. 독립 적대적 리뷰 HIGH=0 MED=0. **라이브
  highlight·클릭·credential 값읽기·push/PR 없음.** 완료 후 existing-app live-proof runtime을 **PREPARED까지만** 만들고
  승인 대기.
- **정직한 한계(라이브 미검증):** `open_app`의 실제 `app_list→app_detail` 관찰은 **오프라인 fake로만 증명**; 라이브
  전환 관찰·타이밍은 미확인(별도 gated 승인 필요). new-app 경로의 Phase B highlight proof도 여전히 PENDING(0.2.8).

### 0.2.10 개정 — **`NAVER Post-Navigation Highlight Reliability v1`: 라이브 부분 증명의 갭(guide 레이스) 봉합** ⭐ 현행 issuance 상태

0.2.9의 existing-app 흐름을 **라이브에서 부분 증명**(실 NAVER 스토어, 단일사용 승인 소진, 2회 재현)한 결과: existing-app
분기 + `open_app` 안내 + 관찰된 `app_list→app_detail` 전환 + `VERIFY_OPEN`(일시적 unknown fail-closed park + auto-recheck
복구) + **step 2 완료**까지는 라이브 성립. **그러나** step 2 직후 `guide(api_group)`의 고정라벨 locate가 **app_detail probe
~7ms 뒤 execution-context-destroyed로 throw**(`aw_issuance_drive_error {reason:"Error"}`) → 런이 park 없이 idle로 멈춤
(recheck로도 복구 불가). 근본 원인: **`guide()`에 locate 전 `settle()`이 없어** 아직 정착 중인 nav 직후 페이지에서 in-page
read가 발화. 동일 고정라벨 locate는 페이지가 수동 안정화되면 라이브 유효(selector-probe에서 api_group matchCount=1 확인). 본
단위는 이 **선재(先在) 신뢰성 갭**을 코드로 봉합한다(라이브 실행 없음).

- **guide는 locate 전에 surface를 settle한다.** 세션 `guide()`가 locate/highlight 전에 `driver.settleSurface?.()` 호출
  (`NaverIssuanceDriver.settleSurface` = `waitForLoadState('networkidle')` 바운드, value-free). fixture는 no-op(기록만).
  → nav 직후 아직 정착 중인 페이지에서 고정라벨 read가 발화하지 않는다. **api_group 뿐 아니라 create_app/credentials 등 모든
  강조 단계에 target-generic으로 적용**(guide 경로가 타깃 불변).
- **nav 레이스 throw = recoverable `page_mismatch` park.** settle에도 read가 nav를 race하여 throw하면, 세션
  `onDriveError`가 (기존의 로그-후-idle 대신) **엔진 `onDriveFault()`로 위임** → `page_mismatch`(UI_DRIFT) 회복 park +
  `CLEAR_HIGHLIGHT`(반쯤 붙은 태그 제거). 런이 barrier 없이 멈추지 않는다. `RUN_FAILED` 아님.
- **`REQUEST_STEP_RECHECK`로 정상 재개.** drive-fault park는 (앱 목록으로 상단 재-probe하지 않고) **같은 강조 타깃을
  재-guide**한다: `recheck()`가 `guideFaultTarget`을 기억해 settle→locate→highlight를 재실행(판매자는 이미 올바른 상세
  페이지에 있으므로 목록으로 되돌리면 dead-end). fixture에서 최초 locate throw→park→recheck→highlight 성공→완료를 재현.
- **영구 오류는 무한 재시도하지 않음.** 연속 drive-fault를 `MAX_CONSECUTIVE_DRIVE_FAULTS=3`로 바운드
  (`consecutiveDriveFaults`, 정상 highlight마다 0으로 리셋). 캡 초과 시 `guideFaultTarget`을 비워 recheck가 **재-guide 대신
  상단 재-probe**로 폴백 → throw하는 locate를 재실행하지 않음(자동 recheck 루프도 발산 불가). 캡까지도 회복 park 유지,
  `RUN_FAILED` 없음.
- **중복 highlight·observer arm 방지.** 강조 태그 스크립트가 매 태깅 전 기존 `data-aw-target`을 모두 제거(멱등),
  drive-fault는 `CLEAR_HIGHLIGHT`를 먼저 반환, 세션 `autoBusy` 직렬화로 동시 guide/arm 없음. **재-guide는 barrier가 아닌
  자동(RUNNING) stage로 재-locate**하므로 settle 대기 중 도착한 recheck가 두 번째 관찰을 arm하지 못한다(highlight 전에
  barrier를 노출하지 않음) → 재-guide가 중복 강조/이중 arm을 남기지 않음(테스트: 회복 후 `highlight:api_group`·
  `observe:api_group` 정확히 1회).
- **surface-close = 재-guide latch 해제.** drive-fault로 무장된 `guideFaultTarget`은 어떤 non-fault park(login/probe
  mismatch/surface close)에서도 해제 → 판매자가 창을 닫았다 다시 열면 recheck가 (잘못된 페이지에서 재-guide하지 않고)
  상단부터 재-probe로 정상 복구(독립 리뷰 MEDIUM 반영).
- **게이트·리뷰:** collector typecheck 그린 + 전체 **6152 tests 그린**(+8 신뢰성 테스트: settle-before-locate, 레이스
  park, recheck 회복, highlight-phase 레이스, create_app 분기, surface-close latch 해제, 영구-오류 캡, 계약 유효성). 독립
  적대적 리뷰 **HIGH=0**(MEDIUM 1건=surface-close latch 반영; LOW 반영=자동 re-locate stage·step index). **계약 불변**
  (새 stage/status/enum/마이그레이션 없음; `page_mismatch`·`REQUEST_STEP_RECHECK` 재사용). **FE 변경 없음.** **라이브 실행·
  push/PR 없음.** 완료 후 existing-app Phase B live-proof runtime을 **fresh PREPARED까지만** 만들고 승인 대기.

### 0.2.11 개정 — **`NAVER Existing-App Same-Page Guidance v1`: app_detail 상의 api_group·credentials를 클릭 barrier가 아닌 viewport CHECKPOINT로** ⭐ 현행 issuance 상태

0.2.10의 봉합(settle+park+bounded recheck) 뒤에도 **라이브 재시도(2026-08-02)에서 `api_group` locate가 여전히
execution-context-destroyed로 throw**됐다: NAVER app_detail SPA가 `networkidle` 뒤에도 재렌더되어 in-page read를
파괴. 오버레이가 mount 전에 실패 → 조작자 화면에 아무 안내도 안 뜸. 근본 재설계: **app_detail 진입 후에는 NAVER 클릭을
기다리지 않는다.** open_app만 실제 전환을 관찰하고, `api_group`/`애플리케이션 ID`는 **같은 페이지의 viewport checkpoint**로
처리한다.

- **타깃 분류(신규, `issuance-driver.ts`):** `ISSUANCE_TRANSITION_OBSERVE_TARGET = open_app`(유일 관찰 대상) vs
  `ISSUANCE_CHECKPOINT_TARGETS = [create_app, api_group, credentials, return]`(`isCheckpointTarget`). `OBSERVE_
  USER_CLICK_TRANSITION`은 이제 **open_app 전용**.
- **checkpoint 처리(각 단계):** ① 페이지 안정화(`settleSurface`) ② 섹션 locator 확인 ③ 섹션으로 scroll(오버레이 mount가
  `scrollIntoView(center)` 수행 — `overlay.ts`, 중복 스크롤 없음) ④ 오버레이로 위치 안내("여기입니다 → SellerOps에서
  '다음'") ⑤ **NAVER 요소 클릭을 기다리지 않음**(observer arm 제거) ⑥ **SellerOps '다음'으로 진행**.
- **엔진(`issuance-engine.ts`):** checkpoint의 `onTargetHighlighted`는 `{observe}` 대신 **`"NONE"`(정지·대기)** 반환 →
  observer 무장 없음. barrier에서의 `REQUEST_STEP_RECHECK`는 checkpoint면 **`advanceCheckpoint`("다음": STEP_COMPLETED
  후 다음 컨트롤 guide)**, open_app이면 **재관찰**(`{observe}`). `resume`은 checkpoint를 **재-guide**(재정착·재locate·재scroll·
  재overlay), open_app은 재관찰. **open_app은 그대로** 전환 관찰 barrier(`{observe}` + `VERIFY_OPEN`) — 불변.
- **드라이버(`naver-issuance-driver.ts`):** `armObserve` = **완전 no-op**(클릭 observer 제거; 유일 관찰 open_app은 category
  poll). `observeUserAction`은 open_app만 `observeLeftApplicationsList`; checkpoint는 호출 안 됨(도달 시 fail-closed).
  **bounded in-page 재시도** `evalWithSettleRetry`(settle→read; exec-context throw 시 재settle+재read,
  `MAX_INPAGE_RETRIES=2`, 재시도 간격 옵션화) — 모두 실패해야 throw → 엔진 recoverable park. 오버레이 라벨을 "확인 후
  SellerOps에서 '다음'"으로 갱신.
- **회복은 in-place 재-guide(독립 리뷰 M1 반영):** open_app 뒤 런은 app_detail에 상주하므로, checkpoint park의 회복을
  **상단 재-probe로 하면 app_detail이 `page_mismatch`로 오분류되어 dead-end**가 된다. 그래서 `recheck`는 **checkpoint를
  guide 중일 때 park면 그 섹션을 제자리에서 재-guide**(re-settle→re-locate→re-scroll→re-overlay)한다 — 일시적 locate miss
  (`target_not_found`), `page_mismatch`, surface-close, exec-context throw **모두** 동일 경로로 self-heal(화면에 섹션이 오면
  즉시 성공). checkpoint가 아닌 park(초기 probe/login/open_app 전환)만 상단 재-probe. **0.2.10의 guideFaultTarget latch +
  consecutiveDriveFaults cap 제거**(체크포인트 모델에선 dead-end 원인) — "bounded"는 이제 드라이버 `evalWithSettleRetry`
  (attempt당) + **명시적 '다음' 회복(auto-loop 없음)**이 담당.
- **매니페스트(`approval-manifest.ts`):** 새 read-only 능력 **`REVEAL_SECTION_IN_VIEWPORT`**(섹션 scroll, value-free) 추가 +
  `OBSERVE_USER_CLICK_TRANSITION` **open_app 전용** 명시.
- **자동 recheck 의존 제거:** checkpoint는 park가 아니라 barrier이므로 "park에서 10초 auto-recheck" 루프로는 진행되지 않는다 —
  진행은 **명시적 '다음'(REQUEST_STEP_RECHECK) 한 번씩**. 즉 minimal-bridge-client의 auto-recheck 스팸 의존이 구조적으로
  제거됨(라이브 구동은 checkpoint마다 명시적 advance; auto-recheck는 park 회복에만).
- **게이트·리뷰:** collector typecheck 그린 + 전체 **6158 tests 그린**(+checkpoint 계약 3 + bounded-retry 드라이버 2 +
  in-place 회복 3; 회귀 갱신). 독립 적대적 리뷰 **HIGH=0**; **MEDIUM 1건(M1: checkpoint park가 상단 재-probe로 dead-end)
  반영 = in-place 재-guide로 수정**; LOW 반영(observeUserAction fail-closed). **계약 불변**(새 stage/status/enum/마이그레이션
  없음). **FE 변경 없음.** **라이브 실행·push/PR 없음.** api_group/credentials의 existing-app 라이브 증명은 이 재설계 뒤에도
  **미증명(다음 gated 승인 필요)**.

### 0.2.12 개정 — **`NAVER SPA-Stable Guidance Runtime v1`: fixed-label 탐색을 `page.evaluate` 문자열 → Playwright locator 기반으로** ⭐ 현행 issuance 상태

0.2.11의 checkpoint 모델은 라이브에서 **회복(recoverable park + in-place 재-guide)까지 증명**됐으나, `api_group`
locate가 **`settle(networkidle)` + `evalWithSettleRetry`(3회)를 뚫고도 지속적으로** execution-context-destroyed로
throw(라이브 #4에서 2회, 한 번은 settle 47초 뒤) → **오버레이가 끝내 mount 안 됨**. 근본 원인: **raw `page.evaluate`는
SPA의 client-side(soft) navigation을 넘어 재-resolve하지 못한다** — 대형 `document.querySelectorAll` IIFE가 soft-nav에
걸리면 컨텍스트가 파괴되며 즉시 throw. 이번 단위는 **탐색(resolution) 자체를 Playwright locator로 이관**해 봉합한다.

- **SPA-안정 탐색(`naver-issuance-driver.ts`, `resolveFixedLabelTarget`):** `page.evaluate` 문자열 방식의 탐색을
  제거하고 **locator 기반**으로 교체 — ① `page.locator(candidateQuery, { hasText: exactLabelRegex(label) })`로 fixed
  라벨을 좁혀 **`first().waitFor({ state:"attached", timeout: LOCATOR_TIMEOUT_MS })`**(auto-wait, soft-nav를 넘어
  재-resolve — **실제 봉합점**) ② **`count()`로 유일성** 강제(≠1 → `{count}` → target_not_found park) ③
  **`scrollIntoViewIfNeeded()`**(읽기 전용, 클릭 아님)로 섹션 표시 ④ **그제서야** 감사된 value-free tag+sig IIFE
  (`buildFixedLabelLocateScript`)를 이미 resolve된 유일 요소에 실행(bounded 재시도) → 오버레이 tag를 안정적으로 연결.
  **매 attempt마다 `activePage()` 재-resolve**(새 탭 등 context/frame 변경 추종). locator **timeout → `{count:0}`**
  (bounded target_not_found park, 무한 대기 없음); tag IIFE가 계속 throw하면 마지막 오류 전파 → `onDriveFault` recoverable
  page_mismatch. **매칭 의미 불변**(정확 라벨 = 정규화 텍스트 exact) + **anti-drift sig 불변**(locate/highlight sig 비교
  유지) + **value-free OUTPUT 불변**(텍스트/값은 감사 IIFE 안에서만).
- **VERIFY_OPEN bounded polling(`probeSurfaceSettled`):** app_detail SPA가 hydration 중 **일시적 `unknown`**으로
  분류되어 **첫 read에서 오분류→park**하던 라이브 #4 플레이크를 봉합. 이제 sanitized 페이지 category를 **정본 landing**
  또는 bounded 횟수(`VERIFY_MAX_POLLS`)까지 폴링 후 결정. 끝내 정착 안 하면 마지막 probe 반환 → 엔진 recoverable
  page_mismatch(무한 대기·잘못된 통과 없음, fail-closed 유지). 세션 `VERIFY_OPEN` 드라이브가 `probeSurfaceSettled ??
  probeSurface`를 사용(드라이버 없는 스크립트 픽스처는 단일 read로 폴백 — 엔진 결정 불변, 타이밍만).
  - **[독립 리뷰 H1 반영] `credential_issuance`를 정본 성공 landing으로 수용.** existing 앱의 상세 페이지는 이미 발급된
    Application ID/Secret을 **read-only로** 표시 → 공유 분류기 precedence상 `app_detail`이 아니라 **`credential_issuance`**
    로 분류(read-only가 editable를 이김, `observe-api-center` §precedence). 엔진 `onOpenAppVerified`가 `app_detail`만
    받으면 **existing-app 셀러를 dead-end**시키므로, **`app_detail` 또는 `credential_issuance`** 둘 다 상세 페이지 도달로
    수용(하류 api_group locate가 fail-closed라 페이지가 틀리면 recoverable park). `isVerifyResolved`도 두 category +
    `login`에서 폴 종료.
  - **[독립 리뷰 H1 반영] 폴당 15초 settle 스톨 제거.** `probeSurfaceSettled`가 매 폴마다 15초 `settle(networkidle)`을
    돌려 never-idle SPA에서 최대 ~3분 무응답이 되던 문제를 **최초 1회만 settle → 이후 짧은 간격의 경량 `readSurface`(settle
    없음) 재읽기**로 수정.
- **공식 재사용 live-proof CLI(`src/cli/issuance-live-proof.ts`, 신규):** 스크래치패드 `issuance-*-runner.mjs`(임시
  브리지 클라이언트)를 **커밋된 게이트 CLI로 정리**. 브라우저 드라이버가 **아님** — `run-api-issuance-live-naver`가 이미
  연 로컬 `/bridge/ws`에 붙어(페어→ws-ticket→ws) issuance 런을 adopt하고 FE처럼 구동: **START_RUN + '다음'
  (REQUEST_STEP_RECHECK) 두 개의 무해 가이드 명령만** 전송, **sanitized 프레임(status/step/blocker)만** 출력. 진행은
  **명시적 sentinel 파일**(조작자가 오버레이를 본 뒤 touch)당 **'다음' 1회** — **auto-recheck 없음**(0.2.11 요구 계승).
  `hasLiveRunApproval` 게이트 + import-시 inert(직접 실행에서만 main). 소스 가드 추가(값/URL/셀렉터 무유출, 마켓 액션 없음).
- **게이트·리뷰:** collector typecheck 그린 + 전체 **6195 tests 그린**(+locator-timeout bounded park, +unknown→app_detail
  hydration VERIFY, +credential_issuance landing 완료, +live-proof CLI 소스 가드; 기존 회귀 갱신). 독립 적대적 리뷰
  **HIGH 1건(H1: credential_issuance landing이 오분류·스톨) 반영**(위 두 bullet) + **MEDIUM 1건(M2: `count()`가 retry
  try 밖) 반영**(모든 locator op을 단일 try에 넣어 soft-nav 재시도) + LOW 반영(L3: 오해 소지 픽스처 시퀀스 제거). L4
  (hasText vs accName)/L5(probeTargetMatch 미하드닝)/L6(CLI)는 안전(park-only/비회귀)으로 관측 기록. **계약 불변**(새
  stage/status/enum/마이그레이션 없음), **FE 변경 없음**, **라이브 실행·push/PR 없음.** api_group/credentials의 existing-app
  **오버레이 렌더링 라이브 증명은 이 봉합 뒤에도 미증명(다음 gated 승인 필요)** — 이번엔 탐색이 locator 기반이라 soft-nav에
  강함.

### 0.2.13 개정 — **`NAVER Overlay-Mount SPA Hardening v1`: overlay MOUNT를 SPA-safe로 + app-detail 구조 분류 보강** ⭐ 현행 issuance 상태

라이브 #5(0.2.12 뒤)에서 **탐색(locator)은 성공했으나 `mountOverlay`의 raw function-form `page.evaluate`가 soft-nav에
걸려 throw** → api_group 오버레이가 끝내 mount 안 됨(빠른 ~85ms un-retried throw = 탐색 아님, mount임을 타이밍으로 진단).
또한 존재-앱 상세 페이지가 **로딩 중 `app_list`로 오분류**(폼 입력 신호 없음, ID/Secret이 평문). 이 단위가 둘 다 봉합.

- **overlay mount SPA-safe(`overlay.ts`):** `mountOverlay`의 `page.evaluate`를 **`runEvaluateResilient`(bounded 재시도
  `MOUNT_EVAL_RETRIES=2`)**로 감쌈 — transient nav 오류(`isTransientNavError`: "Execution context was destroyed"/frame
  detached/target closed 메시지 substring, 제어용으로만 읽고 로깅/방출 없음)면 짧게 쉬고 재시도, 비-transient는 즉시 전파.
  모든 mount는 이전 오버레이를 제거하므로 **중복 없음**.
- **atomic tag→mount + paint 검증(`naver-issuance-driver.ts`):** `resolveFixedLabelTarget`에 `afterTag` 콜백 추가 →
  `highlightTarget`이 오버레이 mount를 afterTag로 넘겨 **tag와 mount를 같은 retried try·같은 재해결된 active page에서
  원자적으로** 수행. tag와 mount 사이 soft-nav로 context가 파괴되면 그 attempt가 **재-tag+재-mount**(stale/lost tag에 mount
  안 함). **[리뷰 HIGH] mount 뒤 `overlayMounted(page)` 검증**: `mountOverlay`는 tag가 사라지면 `if(!target) return`으로
  **조용히 no-op**(그리고 mount의 내부 재시도가 fresh context에서 실행되면 throw를 그 no-op으로 바꿔버림) → 오버레이 없이
  "highlight 성공"으로 보고되는 **fail-OPEN**. paint 안 됐으면 retryable 오류를 던져 원자 재-tag+재-mount 강제, 소진 시
  `onDriveFault` recoverable page_mismatch (fail-CLOSED, `naver-live-import-driver`의 `verifyOverlayVisible` 패턴 차용).
  locator timeout→`{count:0}`(target_not_found park). anti-drift sig 유지.
- **whenSettled refcount(`issuance-session.ts`):** `autoBusy` boolean→**`busyCount` refcount**. START_RUN 드라이브와 그것이
  spawn한 detached `watchBarrier`가 동시에 "busy"를 소유 → boolean은 먼저 끝난 쪽이 지워버려(overlay mount의 bounded 재시도가
  실제 macrotask sleep을 span하자 표면화된 플레이크) `whenSettled`가 조기 반환. 각 소유자가 진입 시 ++ / finally에서 -- 하는
  카운터로 **전체 체인이 정착해야 0** → 결정적. (테스트 결정성 훅; 프로덕션 동작 불변.)
- **app-detail 구조 분류(`observe-api-center.ts`, 리뷰 finding #1):** census에 **value-free boolean `appDetailMarkerPresent`**
  추가 — 요소 accessible-name을 **KNOWN 고정 라벨**(`APP_DETAIL_MARKER_LABELS = ["API 그룹","애플리케이션 ID"]`,
  calibrated api_group/credentials exactText 재사용)과 EXACT 비교해 **boolean만** 반환(매치 텍스트 유출 없음; fixed-label
  probe와 동일 패턴, OUTPUT은 observe-api-center "emits only enums/buckets/booleans" 테스트로 별도 가드). **[리뷰 MEDIUM]
  marker candidate set에서 `th`/`a`/`button` 제외** — app-LIST는 테이블이라 컬럼 헤더(`th`)가 정확히 "애플리케이션 ID"/"API
  그룹"일 수 있고 앱 행은 이름이 user data인 링크/버튼 → 리스트를 app_detail로 오분류(심하면 컬럼 헤더를 highlight)할 수 있어
  heading/label류(`h*`/`dt`/`dd`/`label`/`legend`/`span`/`div`…)로 한정. `classifyApiCenterPage` precedence에
  **marker→app_detail**(editable 다음, app_list 앞) 브랜치 추가 → 존재-앱 상세가 폼 입력 없이 평문이어도 app_detail로 분류.
  잔여 false-match도 fail-closed(하류 api_group locate가 못 찾아 target_not_found park).
- **게이트·리뷰:** collector typecheck + 전체 **6204 tests** 그린(+overlay-mount 회복·영구실패 park·**silent no-op fail-open
  검증·영구 no-op park** 4, +classifier marker 3, +census marker value-free 2; 회귀 갱신). 독립 적대적 리뷰 **HIGH 1(mount가
  no-op으로 fail-open) 반영**(overlayMounted 검증) + **MEDIUM 1(marker th/a/button false-match) 반영**(candidate 한정) + LOW
  기록(runEvaluateResilient trailing dead-throw·공유 mountOverlay 스코프·watchBarrier pre-acted 미처리 rejection = 기존/무해).
  **계약 불변**(새 stage/status/enum/마이그레이션 없음), **FE 변경 없음**, **라이브 실행·push/PR 없음.** 존재-앱 오버레이 렌더링
  라이브 증명은 이 봉합으로 **기대되나 여전히 미증명(다음 gated 승인 필요)**.

### 0.2.14 개정 — **`API Issuance Live Runtime Reset`: 확정된 라이브 사실 baseline (현행)** ⭐ 현행 issuance 상태

누적된 라이브 시도(0.2.10–0.2.13, 여러 gated 세션·소진된 grant) 뒤, 정본을 **확정된 사실만** 담는 clean baseline로 리셋한다.
아래 목록 외의 원인·진단은 **가설**이며 정본에 확정 원인으로 기록하지 않는다.

**확정된 라이브 사실:**
- **open_app 전환은 라이브 성공** — 존재-앱 브랜치에서 SellerOps가 seller의 `app_list → app_detail` 전환을 관찰하고 step 2를 완료한다.
- **app_detail 분류는 페이지가 fully-loaded일 때 성공** — 상세 페이지가 완전히 로드된 뒤 sanitized category가 `app_detail`로 확정된다(로딩 중에는 `app_list`/`unknown`로 읽힐 수 있음).
- **api_group / credentials 하이라이트 타깃은 matchCount=1** — 캘리브레이션된 fixed-label 타깃이 유일하게 해석된다.
- **Playwright locator search는 정상** — comma-list candidateQuery + `hasText` 조합이 정상 동작함(합성 Playwright 진단으로 확인). 탐색 메커니즘은 실패 지점이 아니다.
- **overlay는 아직 라이브 표시 성공 0회** — api_group/credentials 오버레이가 실제 화면에 렌더된 적이 없다.
- **throw 지점 미확정** — api_group guide의 오류가 **tag / signature / mount / visibility-verify** 단계 중 어디서 발생하는지 **아직 확정되지 않음**.

**다음 단위 = `Overlay Root-Cause Isolation v1` (오프라인 구현 → 단일 라이브 진단):**
- resolve → scroll → tag → mount → visible-check **각 단계에 safe stage telemetry** 추가.
- 각 단계는 **오류 name + 민감정보 없는 고정 reason enum만** 기록(페이지 값/텍스트/URL/셀렉터 무유출).
- **상태 기계 · selector · bridge · runner는 변경하지 않는다**(순수 관측 추가만).
- 목표: **단 한 번의 gated 라이브 진단**으로 정확한 실패 단계만 확정한다(수정은 그 다음 단위에서).

---

## 0. v1 비준 (Ratification 2026-07-19) — 오프라인 구현 착수

제품 오너가 본 계약을 **NAVER SmartStore v1 흐름으로 비준**한다(우선순위 ① 현재 태스크 결정 +
`docs/action-window-runtime/naver-smartstore-v1-plan.md`). 아래를 넘어서는 UX는 발명하지 않는다.

- **착수 범위 = G3-A + G3-B (오프라인)**: 가이드 상태 엔진 + 합성 흐름(§19 G3-A), 안전 자격증명 등록·연결
  테스트·첫 sync를 **기존 백엔드 경계 어댑터/합성**으로(§19 G3-B). **G3-C(라이브 정찰)·G3-D(하드닝)은 여전히
  게이트** — 별도 PO 승인 + 단일-사용 G6 + §14 정책 해명 선결. **라이브 NAVER·브라우저·원격 git 없음.**
- **가이드-여정 상태 머신 = FE 소유 순수 모듈**(`frontend/src/lib/guidedConnection/`, 렌더러-중립,
  오프라인). §8 의미 상태를 그대로 따르되 **라이브 DOM 감지(§9)는 G3-C까지 유예** — G3-A/B에서 발급 하위
  단계는 **사용자-구동 가이드 전이**(합성 픽스처)로 진행하고 FE는 라이브 상태를 감지하지 않는다. 이는
  frontend/CLAUDE.md의 "runtime owns semantic state"와 **충돌하지 않는다**: 본 상태는 AW **런(run)** 계약이
  아니라 **온보딩 여정** 오케스트레이션이며, sanitized 신호(페어링 상태·API 결과)만 소비한다.
- **[CONFLICT 해소] 리뷰 export 준비 스텝**: DRAFT §16은 NAVER 리뷰 수집을 G3 범위 밖(Action Window 별도
  트랙)으로 둔다. v1 위저드는 **"리뷰 export 준비(readiness) 스텝"**을 포함하되, 이는 리뷰 수집을 G3 안에서
  재구현하는 것이 **아니라** 연결 완료 후 **기존 라이브-검증된 Action Window export 트랙으로의 준비/핸드오프
  표시**다(실제 수집·클릭·다운로드는 여전히 AW 트랙·감독형·게이트). 근거: 우선순위 ① + v1 plan §7.
- **재사용(신규 백엔드 능력 없음)**: 기존 백엔드 경계(`credentials`/`test-connection`/`sync`), FE apiClient,
  bridge 페어링 상태, 기존 연결-상태 어휘(§3.2의 3종은 발명·통합하지 않고 완료 시 매핑만 — 통합은 별도 과제).
- **불변식 계승(테스트 강제)**: Secret 무영속·무로깅(§11·§17.4), 사용자 결정 건너뛰기 금지(§17.2), 미지 상태
  **fail-closed**(§17.3), `completed`는 **등록+테스트+sync 후에만**(§12), **0건 vs 실패 구분**(§12). 자동
  로그인·Secret 추출·클립보드·2FA/CAPTCHA 우회·**cropped/projection UI 없음**(v1 기본 = 실제 로컬 Chrome +
  Action Window 오버레이).
- **구현 위치**: `frontend/src/lib/guidedConnection/*`(순수 상태 머신·타입·합성 픽스처) +
  `frontend/src/` 위저드 UI. **검증: FE typecheck + 단위 테스트(§18) — 라이브 NAVER 불필요(§17.10).**

> **✅ RULED 2026-07-21 (PO) — v1은 G3-A/B에서 완료되고, G3-C/D는 POST-v1이다.** 본 §0 비준이 곧 **NAVER v1
> 온보딩 기준**이다: `ConnectNaver` 위저드 + 안전 자격증명 폼 → Vault → `test-connection` → `sync` →
> 대시보드. **API 센터 ①②단계는 튜토리얼 안내 + 셀러 자기확인(self-attestation)** 으로 출시하며 **라이브
> API-센터 DOM 감지는 v1에 불필요**하다 — **G3-C.1·G3-C.2는 v1 게이트가 아니다**(라이브 API-센터 관측은
> **진단·도구 보정 증거일 뿐** 제품 경로가 아니다). §20-(3)의 G3-C 착수·플래그 활성·SUPERVISED_ACTION 범위는
> 그에 따라 **POST-v1로 연기**된다. ⚠ 경계 불변: **API 센터는 가이드 튜토리얼 지원 전용** — 자동 발급·자동
> 연동 없음, **SellerOps는 API-센터 페이지에서 Client ID/Secret을 절대 읽지 않음**, 셀러가 앱을 직접
> 생성/열고 값을 **수동 복사**한다. **신규 발급 앱에 대한 assisted end-to-end 워크는 POST-v1**(Vault·로컬 DB
> 변경 — 별도 PO 승인 + 신규 단일-사용 G6 필요, v1-검증으로 주장 금지). 상세: v1 plan §8-B9 · §9 · §10.

---

## 1. 목적 (Purpose)

G3는 **assisted(제품 오너 관찰) 사용자**를 셀러 소유 NAVER 커머스 API 애플리케이션 발급 흐름을 통해 안내하고,
**첫 실주문 수집까지** 완료시킨다. G1(관측·페어링) 위에, **승인된 렌더러**(기본 ACTION_WINDOW; 선택 PROJECTION)
위에서 단계 정의·사용자 통제 vs 자동 경계·안전 자격증명 등록·연결 테스트·첫 주문 수집을 얹는다. **자동 로그인·
자동 클릭·코치마크·2FA/CAPTCHA 처리·자동 Secret 추출·클립보드는 넣지 않는다**(§16). 이 파일럿은 **셀러 소유
앱 경로**이며 솔루션-제공자 모델이 아니다.

## 2. 제품 성공 기준 (Product success criterion)

Frontend Spec §16.10의 6단계를 **모두** 통과해야 성공이다. **키 발급만으로는 성공이 아니다.**
1. SellerOps에서 NAVER 커머스 API 흐름을 연다.
2. 애플리케이션 발급을 사용자에게 안내한다.
3. Client ID·Client Secret을 **안전하게 등록**한다.
4. SellerOps 연결 테스트를 통과한다.
5. **첫 실주문 데이터 수집**을 수행한다.
6. SellerOps에 수집 결과를 표시한다.
> 완료 전이는 **③ 등록 성공 + ④ 테스트 통과 + ⑤ 수집 결과**가 모두 성립할 때만(§8 completed, §12).

## 3. 현행 저장소 증거 (Current repository evidence)

> 파일 경로·라인 확인(2026-07-08 정찰). 분류: 구현됨 / production 런타임 배선 / 라이브 검증 / 문서만 / 미래.

### 3.1 재사용 가능 (있음)
- **NAVER OAuth/토큰 클라이언트 (구현됨, 플래그 OFF 기본 → 미배선)**: `backend/.../connector/naver/NaverTokenClient.java`
  — bcrypt 전자서명(`Base64(BCrypt.hashpw(clientId+"_"+timestamp, salt=clientSecret))` `:101-112`) →
  `POST /external/v1/oauth2/token`(`grant_type=client_credentials`, `type=SELF`, `:177-206`), 토큰 캐시.
  `NaverApiConnector.java`(`KIND="NAVER_API"`, ORDER_SUMMARY만, `implements ConnectionVerifier`),
  `NaverOrdersClient.java`(2-콜 `/product-orders/last-changed-statuses`→`/query`). `@ConditionalOnProperty
  sellerops.connector.naver.enabled=true`(기본 false → mock). **공식 인증 메커니즘과 정확히 일치**(§4 대조).
- **자격증명 등록 엔드포인트 + Vault (배선됨)**: `POST /api/seller-accounts/{accountId}/credentials`
  (`SellerAccountCollectController.java:88`, write-only·마스킹 반환) → `CollectControlService.storeCredential`
  (`:272-284`, 템플릿 검증 후 `vault.store`) → `CredentialVault.java`(envelope 암호화, master key env
  `SELLEROPS_VAULT_MASTER_KEY`, 키 없으면 fail-closed). 엔티티 `ConnectorCredential`.
- **NAVER 자격증명 템플릿 (배선됨)**: `CredentialTemplates.java:47-53` — `client_id`(비밀 아님),
  `client_secret`(`secret=true`), `authType="API_KEY"`. **백엔드가 폼의 진실 원천.**
- **연결 테스트 (배선됨; NAVER만 실검증)**: `POST /api/seller-accounts/{accountId}/test-connection`
  (`:81`) → `CollectControlService.testConnection`(`:305-344`, 상태 `SUCCESS/FAILED/UNSUPPORTED/NOT_CONFIGURED`,
  안전 사유 `INVALID_CREDENTIAL/TEMPORARY_PROVIDER_ERROR/PROVIDER_UNAVAILABLE`). NAVER만
  `verifyConnection`→live 토큰 mint/discard(`NaverTokenClient.verify` `OK/INVALID/RATE_LIMITED/UNAVAILABLE`).
- **수집 트리거·결과 (배선됨)**: `POST /api/seller-accounts/{accountId}/sync`(`:49`) → `manualSync` →
  `SyncRunExecutor`; 결과 `SyncJob.status` `RUNNING/SUCCESS/PARTIAL/FAILED` + counts `success/skipped/failed`
  (`:245-250`). **빈 수집/dedup = SUCCESS**(0건과 실패 구분).
- **첫 주문 표시 (프론트 배선됨)**: `frontend/src/pages/Orders.tsx`(요약 대시보드 `/api/orders/summary`),
  `ChannelDetail.tsx`(`api.manualSync` 버튼·run-history `SyncRunView`·last-synced).
- **감독형 클릭·후보-인덱스·서명·안전 상태감지 유틸 (구현됨, collector-local)**: `naver/session-verdict.ts`
  `classifySessionVerdict`(5-state enum), `naver/export-classify.ts` `planExportAction`(no-click 레이아웃),
  `naver/session-probe.ts`/`export-probe.ts`(sanitized 신호·bucket enum), `naver/account-store-resolver.ts`
  (`ResolverDecision`·`clickCandidateIndex`·정확히 1클릭), **`esm/esm-candidate-signature.ts`(버전드 salted
  서명 — 불일치 시 `UI_CHANGED` + 0클릭; 감독형 단일-클릭 핵심 안전 프리미티브)**, `naver/review-usage-confirm.ts`
  `scanReviewUsageConfirmCandidates`(no-click 후보-인덱스 배지). **전부 sanitized(enum/boolean/16-hex).**
- **프로젝션 API (프론트 클라이언트 배선됨; 에이전트-측은 seam만 — State B)**: `frontend/.../projectionClient.ts`
  (`start/stop/requestControl/releaseControl/requestTargetSwitch/sendInput/subscribe/frameRendered`,
  capabilities `{view,control}`), `useProjection.ts` 훅은 **구현·커밋**(`a0e4f6f`). **단 정상 Local Agent
  제품 부팅은 프로젝션 소스를 생성·주입하지 않는다**(`resolveAgentBridgeConfig`가 `projection` 미설정 →
  `/projection/ws` 404) — production-runtime 미배선(browser-projection-v0 §22.8). PROJECTION 렌더러는 **선택**
  이며, 미배선이어도 기본 렌더러 ACTION_WINDOW로 G3가 성립한다(§5.A).
- **sanitized 로깅·핑거프린트 (배선됨)**: `collector/src/log.ts` `FORBIDDEN_KEY_SUBSTRINGS`
  (`token/password/passwd/cookie/authorization/secret/credential/session`), 프로젝션 프라이버시 테스트
  금지목록, `naver/account-fingerprint.ts`(one-way 16-hex, raw 식별자 미저장).

### 3.2 부재/격차 (이 슬라이스가 세움)
- **가이드 상태 엔진 부재**: NAVER API 센터 발급 흐름을 단계 상태로 안내·감지·재개하는 오케스트레이터 없음.
- **프로젝션↔가이드 브릿지 부재**: G2는 화면 투사·입력만; 어느 단계인지·다음 행동을 구동하는 계층 없음.
- **합성 NAVER-유사 픽스처 부재**: NAVER API 센터 흐름을 흉내낸 마켓-무관 합성 픽스처 없음(§18에서 생성).
- **세 가지 연결 상태 어휘 불일치 (보고)**: backend `ChannelConnectionStatus`(CONNECTED/DEGRADED/EXPIRED/
  DISCONNECTED/NEEDS_REAUTH) · backend `ChannelStatus`(카드 intent) · collector `ConnectionStatus`
  (PENDING_USER_LOGIN…ACCOUNT_MISMATCH, collector-local). G3 가이드 상태(§8)는 이 셋을 발명·통합하지 않고
  **별도 가이드-여정 상태**로 두되 완료 시 기존 엔드포인트/상태에 매핑한다. 어휘 통합은 별도 과제 — 보고만.
- **stale 주석 보고**: `CollectControlService.java:324-335` "no connector implements this yet"는 **오기**
  (NaverApiConnector가 verifier 구현). 정정은 G3 범위 밖 — 보고.

## 4. 공식 NAVER 흐름 증거 (Official NAVER flow evidence)

> **공식 커머스 API 센터·SmartStore 도움말만** 사용해 확인한 현행 요구. UI-특정/불안정 세부는 **라이브
> assisted 정찰 필요**로 표기. 출처는 §부록.

**확인된 사실(공식/광범위 교차확인):**
- API 센터: `apicenter.commerce.naver.com`(문서 `/ko/basic/commerce-api`). 가입 시 **개발업체 계정명·
  장애대응 연락처·약관 동의**.
- **발급은 통합매니저(integration manager) 권한으로만 가능**(부매니저 불가).
- 애플리케이션 등록: **앱 정보 + API 호출 IP + API 그룹**(상품/주문(판매자)/판매자정보 등) 추가 → 등록 후
  **Client ID(애플리케이션ID)·Client Secret(시크릿) 발급**. **스토어별 애플리케이션 최대 1개.**
- 인증: **OAuth2 client_credentials**, **bcrypt 전자서명**(`clientId + "_" + timestamp`를 password로, Client
  Secret을 salt로 bcrypt→base64 = `client_secret_sign`) → `POST https://api.commerce.naver.com/external/v1/
  oauth2/token`(`type="SELF"` = 셀러 소유), 13자리 ms timestamp, 응답 `access_token`을 Bearer로 사용.
  → **저장소의 `NaverTokenClient` 구현과 정확히 일치**(§3.1, 상호 검증).
- 셀러 소유(type SELF) vs 솔루션-제공자: 셀러 소유 앱은 `type=SELF`. 솔루션-제공자 앱 등록은 **별개 경로**
  이며 본 파일럿 범위 밖(미래 모델, product-scope §6.1).

**라이브 assisted 정찰 필요(불안정/UI-특정 — 가정 금지):**
- API 센터 각 화면의 **현행 정확한 문구·레이아웃·버튼 위치**.
- 발급 흐름 내 **2FA/사람 검증**의 정확한 지점·형태.
- **스토어 애플리케이션 인증(스토어 인증)** 정확한 단계.
- 애플리케이션 **활성/비활성/만료** 정확 조건.
- **API 그룹 체크박스 정확 라벨**·권한 세분.
- API 호출 IP 설정의 정확한 요구(고정 IP 필요 여부·SellerOps 측 값).

## 5. 여정 단계 (Journey phases)

### A. 준비 (Readiness) — 렌더러-중립
> **⚠ HISTORICAL (대체됨) — §0.1 참조.** 아래 "Local Agent 페어링·가용을 주문 연결의 준비 요건으로" 두는
> 서술은 **현행 주문 API 연결 계약이 아니다.** 주문 연결은 Local Agent 없이 완주하며, 페어링·렌더러·NAVER
> 로그인 준비는 **연결 완료 후 REVIEW_IMPORT 설정 트랙에서만** 요구된다.
G3 준비 요건은 특정 렌더러가 아니라 아래로 정의한다:
- **Local Agent 페어링·가용**(G1);
- **가이드 상태 엔진 가용**(§8);
- **최소 하나의 승인된 렌더러 가용**;
- **기본 렌더러 = `ACTION_WINDOW`**(실제 창 직접 행동);
- **선택 렌더러 = `PROJECTION`**, **채널·정책 게이트가 허용할 때만**(G2 `{view,control}` 협상).
- 사용자 권한·NAVER 계정 준비(통합매니저 권한 — §4), 기존 연결 감지(이미 연결된 NAVER 계정?),
  SellerOps 측 콜백/IP/설정 값 준비(고정값이면 SellerOps가 제시), **데스크톱 환경**.
> **프로젝션 capability는 시작 조건이 아니다.** 프로젝션이 없어도 기본 렌더러(ACTION_WINDOW)로 여정이
> 시작될 수 있다. 마켓별 로직은 렌더러에 직접 의존하지 않는다(§8 상태 엔진 공유).

### B. NAVER 애플리케이션 발급 (Issuance)
- API 센터 접근 → 계정/스토어 선택 → 애플리케이션 생성 → API 그룹·권한 검토 → 필요 네트워크/IP 설정 →
  최종 사용자 확인 → **Client ID·Secret 발급**.

### C. SellerOps 연결 완료 (Completion)
- 안전 자격증명 입력 → 등록(Vault) → 연결 테스트 → 첫 주문 sync → 결과 표시 → 연결·스케줄 상태.

## 6. 행위자 경계 (Actor boundary)

각 스텝을 `USER_REQUIRED` / `SELLEROPS_AUTOMATED` / `SELLEROPS_GUIDED` / `SUPERVISED_ACTION` / `UNSUPPORTED`로
분류. 원칙(ADR §4): **결정적 편의는 자동화; 계정 선택·권한·동의·불확실 의도는 사용자; 로그인·2FA·CAPTCHA·
계정잠금·사람검증은 절대 우회 안 함.**

| 스텝 | 행위자 | 근거 |
|---|---|---|
| 프로젝션 워크스페이스 열기·준비 체크 | SELLEROPS_AUTOMATED | 로컬 소유 화면 |
| API 센터 화면으로 이동(상태 감지 신뢰 시) | SELLEROPS_GUIDED | 신뢰 낮으면 사용자 안내 |
| NAVER 로그인 | USER_REQUIRED | ADR §4 우회 금지 |
| 2FA·CAPTCHA | USER_REQUIRED | 우회 금지 |
| 계정/스토어 선택 | USER_REQUIRED | 자동화 영구 금지(ADR §4) |
| API 그룹·권한 검토 | USER_REQUIRED | 동의·판단 |
| 결정적 비-비밀 값 채우기(안전 시) | SUPERVISED_ACTION | 감독형 단일 입력(서명 일치 시) |
| 최종 앱 생성·동의 | USER_REQUIRED | 명시적 의도 |
| 발급된 Client ID 입력(검토된 필드) | USER_REQUIRED(입력) / SELLEROPS_GUIDED(안내) | §11 |
| Client Secret 전용 비밀 필드 입력 | USER_REQUIRED | 자동 추출 금지(§11·§16) |
| 자격증명 저장 동의 | USER_REQUIRED | 분리 동의(product-scope §1.2) |
| Vault 등록·연결 테스트·첫 sync·결과 표시 | SELLEROPS_AUTOMATED | 기존 백엔드 경계 |
| 자동 로그인·자동 Secret 추출·무인 클릭 | UNSUPPORTED | §16 |

## 7. 초기 자동화 경계 (Initial automation boundary)

**SellerOps 자동:** 필요한 로컬 프로젝션 워크스페이스 열기 · 준비 체크 제시 · **SellerOps 고정값 제공** ·
상태 감지가 신뢰될 때만 이동 · 안전할 때 결정적 비-비밀 값 채우기 · 완료 상태 감지 · **사용자가 입력한
자격증명을 안전 제출** · 연결 테스트 · 첫 주문 수집 시작 · 결과 표시.
**사용자 필수:** 로그인 · 2FA·CAPTCHA · 계정/스토어 선택 · API 그룹·권한 검토 · 최종 앱 생성·동의 · 명시적
자격증명 저장 동의 · **Client Secret을 SellerOps 보안 필드에 직접 입력**.
> **첫 파일럿에서 자동 Client Secret 추출·클립보드 접근을 구현하지 않는다.**

## 8. 가이드 상태 머신 (Guided state machine)

> 셀렉터·현행 UI 문구를 발명하지 않는다. **의미 상태**만. raw URL·셀렉터·DOM·계정/마켓 식별자를 프론트
> 이벤트·영속 상태에 인코딩하지 않는다(§3.1 프라이버시 계승).

각 상태 정의(안전 증거 / 사용자 설명 / 기대 행위자 / 허용 다음 행동 / 완료 조건 / 타임아웃·실패 / 재개):
> **⚠ HISTORICAL (대체됨) — §0.1.** 아래 `readiness_checking`/`agent_unavailable`/`renderer_unavailable`/
> `naver_login_required`/`naver_reconnect_required` 게이트 상태들은 **현행 주문 연결 리듀서에서 제거**되었다
> (구현: `f60328a`·`726a03f`). 현행 진입은 `check_saved_credential` → capability 읽기 전용 재개 → 3-경로 fork.
- **readiness_checking** — 증거: 페어링·가이드 상태 엔진·**최소 1개 승인된 렌더러**·데스크톱 boolean.
  행위자: SELLEROPS_AUTOMATED. (기본 렌더러 ACTION_WINDOW; PROJECTION은 선택 — §5.A.)
- **agent_unavailable** / **renderer_unavailable** — G1 페어링/렌더러 가용 상태 매핑. 행위자:
  USER_REQUIRED(실행/페어링). `renderer_unavailable`는 **승인된 렌더러가 하나도 없을 때만**(PROJECTION 단독
  부재는 ACTION_WINDOW 가용 시 차단 사유 아님).
- **naver_login_required** — 증거: 세션 verdict enum(NOT_LOGGED_IN). 행위자: USER_REQUIRED. 우회 금지.
- **authority_or_eligibility_unresolved** — 통합매니저 권한/자격 불명(감지 신뢰 낮음 → fail-closed 안내).
- **account_store_choice_required** — 계정/스토어 선택. 행위자: USER_REQUIRED(자동 선택 금지).
- **application_list** / **application_creation** / **permission_review** — 발급 하위 단계(coarse). 행위자:
  USER_REQUIRED(검토·생성). 안전할 때 SUPERVISED_ACTION(결정적 비-비밀 값).
- **final_user_confirmation** — 앱 생성·동의. USER_REQUIRED.
- **credential_issued** — 발급 완료 감지(coarse 신호, 값 미포함). 다음: SellerOps 자격증명 입력.
- **sellerops_credential_entry** — Client ID/Secret 입력 표면(§11). USER_REQUIRED.
- **credential_registration** — Vault 등록(`POST …/credentials`). SELLEROPS_AUTOMATED. 완료: 마스킹 상태.
- **connection_testing** — `test-connection`. 완료: `SUCCESS`.
- **first_order_sync** — `sync`. 완료: `SyncJob` `SUCCESS`(0건 포함) 또는 `PARTIAL`.
- **completed** — ③+④+⑤ 성립 후에만. 결과 표시.
- **recoverable_ui_drift** — 서명 불일치/UI 변경(§9 fail-closed) → 사용자 확인 요청.
- **unsupported_state** — 감지 신뢰 부족 → 안내·수동 확인(fail-closed).
- **terminal_failure** — 복구 불가(사람 개입). 안전 사유 코드만.
- 공통: **타임아웃/실패 시 사용자 안내 + 재시도**; **재개는 안전 의미 진행만 복원**(§13).

## 9. 상태 감지 전략 (State-detection strategy)

평가·분리(가정 금지, **fail-closed**):
- **coarse URL-origin/path 분류**: **로컬 에이전트 내부에서만** 유지(프론트로 raw URL 미전달; `UrlCategory`
  류 enum만 — `session-probe.ts` 패턴).
- **접근성/DOM 상태 분류**: sanitized 신호(boolean/bucket)만(`extractProbeSignals` 재사용).
- **가시 후보 열거 + 후보 서명**: `account-store-resolver.ts`·`esm-candidate-signature.ts`(버전드 salted
  서명) 재사용 — **서명 불일치 시 0클릭 + `recoverable_ui_drift`**.
- **기존 감독형 후보-인덱스 패턴**: `scanReviewUsageConfirmCandidates`(no-click 배지) 재사용.
- **페이지 변경·팝업 감지**: G2 `target_changed`(opaque handle) 재사용.
- **신뢰 부족 시 사람 확인**: 임계 미만이면 `unsupported_state`로 fail-closed.
> **assisted 정찰 전에는 안정 셀렉터를 가정하지 않는다**(§4 라이브 정찰 필요). 상태 감지는 **fail-closed**
> — 모르면 진행하지 않고 사용자에게 넘긴다.

## 10. 가이드 UI (Guided UI)

최종 스타일 없이 사용자 가시 구조: 진행·현재 단계 · **SellerOps 행동 vs 사용자 행동** 구분 · 투사 브라우저
영역(G2) · 짧은 안내문 · **프라이버시/로컬-전용 인디케이터**(G2 계승) · **제어-소유자 인디케이터** · 재시도 ·
수동 확인 · 도움/assisted-핸드오프 상태 · 일시정지·재개 · 완료 결과. **최종 코치마크 스타일·범용 AI 해석
없음**(§16). 셀러 언어. raw URL/DOM/식별자 미표시.

## 11. 안전 자격증명 입력 (Secure credential entry)

- **Client ID**는 검토된 SellerOps 필드에 입력 가능. **Client Secret은 전용 비밀 필드** 사용.
- Secret은 **프론트 localStorage·로그·분석·스냅샷·SellerOps가 캡처한 프로젝션 프레임·브리지 이벤트에 절대
  기록하지 않는다.** (G2 프레임/입력 무영속·무로깅 계승; §3.1 forbidden 키.)
- Secret은 **기존 보안 백엔드 자격증명 등록 경계**(`POST /api/seller-accounts/{accountId}/credentials` →
  `CredentialVault`)로만 전송. **저장 후 재표시 안 함**(마스킹만). **실패 제출도 Secret 미에코**.
- 등록 성공은 **상태로만** 표현. **명시적 자격증명 저장 동의** 필요.
> **자동 클립보드 읽기·페이지-비밀 추출 없음.** 사용자가 NAVER 화면에서 값을 확인해 SellerOps 필드에 직접 입력.

## 12. 연결 테스트·첫 sync (Connection test & first sync)

**신규 백엔드 능력 발명 없이** 기존 경계 조합:
- 연결 테스트: `POST /api/seller-accounts/{accountId}/test-connection`(NAVER 실검증기). 셀러 안전 실패
  범주: `INVALID_CREDENTIAL`(자격증명 확인)·`TEMPORARY_PROVIDER_ERROR`/`PROVIDER_UNAVAILABLE`(잠시 후
  재시도)·`UNSUPPORTED`/`NOT_CONFIGURED`. **원문/스택 미노출.**
- 첫 주문 sync: `POST /api/seller-accounts/{accountId}/sync`(ORDER_SUMMARY). 결과 `SyncJob`
  `SUCCESS/PARTIAL/FAILED` + counts.
- **0건 결과 vs 실패 구분**: 빈 수집/dedup = `SUCCESS`(counts 0) — "수집됨, 신규 주문 없음"으로 표시,
  실패와 다르게. 부분 실패 = `PARTIAL`(일부 반영).
- 재시도: 테스트/sync 각각 재호출. 대시보드/주문 페이지(`Orders.tsx`·`ChannelDetail.tsx`) 확인.
- **정확한 완료 전이**: `credential_registration(성공) → connection_testing(SUCCESS) → first_order_sync
  (SUCCESS/PARTIAL) → completed`. 셋 중 하나라도 미성립이면 completed 아님.

## 13. 재개·복구 (Resume & recovery)

**안전 의미 진행만 영속**(페이지 내용·민감데이터 저장 금지):
- SellerOps 새로고침 → 마지막 안전 단계 복원(G1/G2 재접속; 제어는 뷰만).
- 렌더러 끊김 → 승인된 렌더러 재접속(PROJECTION 사용 시 G2 재접속·제어 재요청; ACTION_WINDOW 사용 시
  실제 창 재초점). 렌더러 전환은 안전 의미 진행을 보존.
- 로컬 에이전트 재시작 → 재페어링/재연결 후 단계 복원.
- NAVER 로그아웃 → `naver_login_required`로 되돌림.
- 2FA 중단 → 사용자 재수행 대기.
- **앱 이미 생성됨** → `application_list`에서 감지, 중복 생성 안내 회피.
- **자격증명 이미 등록됨** → `test-connection`부터 재개(중복 등록 회피).
- **테스트 통과·sync 실패** → sync만 재시도.
- **sync 완료·프론트 종료** → 재진입 시 `completed` 복원(결과 재조회).
- 사용자 이탈 후 복귀 → 안전 단계에서 재개.
- **NAVER UI 변경** → 서명 불일치 → `recoverable_ui_drift` → 사용자 확인.

## 14. 마켓 정책 게이트 (Marketplace-policy gate)

- **채널-중립 프로젝션은 구현됨**(G2, `a0e4f6f`). **실제 NAVER 사용을 "NAVER 승인됨"으로 기술하지 않는다.**
- **자동 로그인·자동 클릭·무인 운영·CAPTCHA/2FA 우회·숨은 브라우저 액션 없음.**
- **라이브 NAVER 검증은 명시적 제품 오너 승인 + 정책 해명(마켓 약관상 셀러-통제 로컬 프로젝션·입력 릴레이
  허용 범위)** 선결(G3-C). 문의 시 **셀러-통제 로컬 프로젝션·입력 릴레이를 정확히 기술**한다.

## 15. 파일럿 관찰 계획 (Pilot observation plan)

제품 오너가 관찰할 것: 어디서 설명이 필요한가 · 사용자가 어디서 망설이는가 · 어느 선택이 판단을 요하는가 ·
어느 결정적 단계가 반복적인가 · 로컬-전용 프라이버시 설명이 신뢰되는가 · 안전 Client Secret 입력이 이해되는가 ·
연결 완료를 인지하는가 · 총 소요·복구 지점. **관찰 노트에 자격증명·페이지 스크린샷·고객 식별자·raw 페이지
내용을 수집하지 않는다.**

## 16. 명시적 제외 (Explicit exclusions)

솔루션-제공자 OAuth · 마켓 승인 주장 · 자동 로그인 · Device Vault · 자동 Secret 추출 · 클립보드 접근 ·
범용 DOM-이해 AI · 무인 자동 클릭 · CAPTCHA/2FA 처리 · **NAVER 리뷰 수집(G3 범위 밖)** · Windows 배포 ·
클라우드 런타임 · 타 채널.

> **NAVER 리뷰 수집 경로 명확화(2026-07-08 채널 결정).** G3는 **셀러 소유 API 앱 발급 + 주문(ORDER_SUMMARY)
> API 수집**에 한정한다. NAVER **주문·문의는 구현·인가된 범위에서 공식 API**를 쓴다. NAVER **리뷰는
> 판매자센터 공식 export를 ACTION_WINDOW로**(사용자가 실제 창에서 직접 export) 수집한다 — 이는 **별도
> 트랙**(`docs/slices/action-window-v1.md`, `docs/multi-channel-connector-roadmap.md` §5.1)이며 G3 범위 밖이다.
> 따라서 위 "NAVER 리뷰 수집 G3 범위 밖"은 **미지원이 아니라 Action Window로 처리**한다는 뜻이다.
> **커머스 솔루션 마켓(솔루션-제공자 모델)은 장기 옵션이며 현 파일럿의 선결이 아니다**(product-scope §1.3·§6.1).

## 17. 수용 기준 (Acceptance criteria)

1. 페어링된 에이전트 + 가이드 상태 엔진 + **최소 하나의 승인된 렌더러(기본 ACTION_WINDOW)** 없이는 여정이
   **시작되지 않는다**. (PROJECTION 단독 부재는 ACTION_WINDOW 가용 시 시작을 막지 않는다.)
2. 사용자-통제 결정(로그인·계정선택·권한·동의)은 **건너뛸 수 없다**.
3. 미지 UI 상태는 **fail-closed**(진행 대신 사용자 확인).
4. **Secret이 로그·이벤트·영속 프론트 저장에 절대 나타나지 않는다**(테스트로 강제).
5. 새로고침·재접속이 **안전 의미 진행을 복원**한다.
6. 연결 테스트는 **기존 실제 백엔드 경계**(`test-connection`)를 쓴다.
7. 첫 주문 수집은 **기존 실제 NAVER 커넥터**(ORDER_SUMMARY)를 쓴다.
8. 완료는 **자격증명 등록 + 연결 테스트 + sync 결과** 후에만 표시.
9. **0건 vs 실패 수집이 구분**된다.
10. 구현 검증에 **라이브 NAVER 액션 불필요**(합성 픽스처로 전부).
11. 구현이 **솔루션-제공자 연동·NAVER 승인을 주장하지 않는다**.

## 18. 검증 전략 (Validation strategy)

- **채널-중립 NAVER-유사 합성 픽스처**(복제 브랜드/자산 없이 생성): API 센터-유사 단계 화면·발급-유사·
  자격증명 발급-유사.
- 상태 머신 단위 테스트 · 행위자-경계 테스트 · 미지-상태 fail-closed 테스트 · **자격증명 프라이버시 테스트**
  (Secret 부재) · 새로고침/재개 테스트 · 렌더러 끊김 테스트(렌더러-중립) · 연결테스트·sync 어댑터 테스트(기존 경계
  목/합성) · 0건·부분실패 테스트 · 합성 픽스처 브라우저 QA · **이후 별도 승인된 assisted 라이브 정찰(G3-C)**.

## 19. 구현 슬라이스 (Implementation slices)

- **G3-A — 가이드 상태 엔진 + 합성 흐름**: 라이브 NAVER 없음. 상태 머신·행위자 경계·fail-closed·합성 픽스처
  + 단위 테스트. 프로젝션/브리지 위 가이드 계층.
- **G3-B — 안전 자격증명 등록·연결 테스트·첫 sync 합성**: 기존 백엔드 경계(`credentials`/`test-connection`/
  `sync`) + 픽스처. Secret 프라이버시 테스트. 신규 백엔드 능력 없음.
- **G3-C — assisted 라이브 NAVER 정찰·셀렉터/상태 보정**: **별도 제품 오너 승인 + 정책 게이트 필요**
  (§14). 실제 UI 문구·2FA 지점·스토어 인증 확정, 후보 서명 보정.
- **G3-D — 파일럿 하드닝**: 관찰 증거 확보 후에만.

## 20. 미해결 결정 (Open decisions)

### (1) 저장소 검증 가능 (repository-verifiable)
- 세 연결-상태 어휘(§3.2) 통합 여부·범위 — 코드로 도출.
- `NaverApiConnector` 플래그(`sellerops.connector.naver.enabled`)를 파일럿에서 켜는 경계·조건.
- `test-connection`/`sync` 응답을 가이드 상태로 매핑하는 정확 대응 — 기존 타입 정독.
- `CollectControlService:324-335` stale 주석 정정(별도).

### (2) 외부 리서치 필요 (external-research)
- API 센터 현행 UI 문구·레이아웃·2FA 지점·스토어 인증·활성/만료 조건·API 그룹 라벨·IP 요구(§4 라이브 정찰).
- 마켓 약관상 셀러-통제 로컬 프로젝션·입력 릴레이 허용 범위(§14).

### (3) 제품 오너 결정 필요 (product-owner)
- G3-C 라이브 정찰 착수 승인·정책 해명 시점.
- 파일럿 앱 발급을 위한 NAVER 플래그 활성 승인.
- 결정적 비-비밀 값 감독형 자동 입력(SUPERVISED_ACTION)의 허용 범위.
- 자격증명 저장 동의·프라이버시 문구의 최종 표현.

---

## 21. 구현 진행 기록 (Implementation progress)

> 계약 본문은 불변. 이 절은 **오프라인 완성 델타(G3-A/G3-B)** 로 실제 병합된 것을 기록만 한다. **G3-C/G3-D·플래그 활성·라이브 NAVER는 여전히 게이트**(§0 RULED 2026-07-21, §20-3).

### 보존 기록 (Preservation record, 2026-07-28)

- **Branch:** `feat/naver-guided-api-connection` (off `main` @ `fbbc90a`). **Head SHA:** `b02cc79`.
- **Draft PR #370** (base `main`, DRAFT) — **상태: offline-complete / NAVER API Center live recon and first
  real sync pending.** 라이브 검증 전 **merge 금지**. `sellerops.connector.naver.enabled` **OFF 유지**, 라이브
  NAVER 호출 없음, Flyway 마이그레이션 없음.
- **Gate (offline):** 백엔드 suite **BUILD SUCCESSFUL**(락 구조 테스트 + Cafe24 2행 회귀 테스트 포함); 프론트
  **1116 tests + typecheck clean**(9개 E2E: 신규/기존/모름/저장키 성공/저장키 실패/Secret 분실/삭제 취소/0건/읽기
  오류 fail-closed). 독립 리뷰 2회 반영.
- **남은 라이브 확인 항목(게이트 뒤):** ① 기존 앱 Secret 재확인·교체·재발급 가능 여부 + 실제 화면명; ② 기존 앱
  삭제 경고·화면명·삭제 정책; ③ 권한 부족/호출 IP 불일치의 실제 backend reason code(permission/IP 상태 라이브
  라우팅); ④ 연결 테스트 + 0건 포함 첫 실주문 sync(플래그 활성 승인 + fresh single-use live approval 선결).

### 2026-07-28 — 오프라인 완성 델타 (branch `feat/naver-guided-api-connection`, base `main` @ `fbbc90a`)

PR #317/#357이 남긴 갭 중 **오프라인으로 채울 수 있는 것만** 마감:

- **연결 시작 = seller-account 생성 (백엔드, §3.2 갭 해소).** `POST /api/seller-accounts/api-channel`
  (`SellerAccountController` → `SellerAccountService.registerApiChannel`) — (org, channel)의 단일 API-모드
  계정을 **find-or-create**. 신규는 `PENDING`(자격증명·테스트·sync 전), **멱등**하며 이미 settled된
  CONNECTED를 **강등하지 않는다**. 자격증명·라이브 호출 없음(계정 레코드만). 파일-업로드 계정과 분리
  (`findByOrgIdAndChannelIdAndFileUpload`). 이전에는 첫 셀러가 붙일 계정이 없어 위저드가 막혔음.
- **FE 위저드 배선.** `ConnectNaver`가 첫 진입 시 NAVER API 계정이 없으면 위 엔드포인트로 **PENDING 계정을
  생성**해 "연결 시작"을 성립시킨다. 완료 CTA는 이제 **`/settings/review-import`(과거 리뷰 가져오기)** 로
  핸드오프(§0 review-export-readiness — 위저드 안에서 리뷰를 수집하지 않음). 완료 화면은 실제 연결 상태 +
  마지막 성공 수집 시각을 표시(§2 ⑥, `getConnectionStatusStrict` + `HealthBadge`). 발급 가이드는 **§4 확인된
  사실만**으로 보강(통합매니저 권한, 스토어별 앱 1개) — 버튼 문구/2FA 지점 등 불안정 세부는 여전히 미기재.
- **불변 유지.** NAVER 엔진 파일(`NaverTokenClient`/`NaverApiConnector`/`NaverOrdersClient`) 무변경,
  `sellerops.connector.naver.enabled` **OFF 유지**(§20-3 PO 게이트), 라이브 NAVER 없음, Flyway 마이그레이션
  없음, 신규 백엔드 능력 없음. **더 세분한 실패 구분(IP 불일치·권한 부족)은 G3-C 라이브 정찰 소관이라 도입하지
  않음** — 기존 안전 범주(`INVALID_CREDENTIAL`/`TEMPORARY_PROVIDER_ERROR`/`PROVIDER_UNAVAILABLE`)만 매핑.
  `CollectControlService:324-335` stale 주석은 범위 밖으로 그대로 둠(§3.2 보고).
- **독립 리뷰 반영.** (HIGH) 동시 연결 시작이 중복 API 계정 행을 만들 수 있는 레이스 → `registerApiChannel`이
  **채널 행을 `PESSIMISTIC_WRITE`(SELECT … FOR UPDATE)로 잠근 뒤** API-모드 계정을 재조회·생성하도록 해 동일
  `(org, channel, fileUpload=false)`에 대한 동시 시작을 **직렬화**(정상 생성 경로의 단일-계정 보장은 이 락이
  담당). 마이그레이션 없음. 방어적 `findFirst…OrderByCreatedAtAsc`(LIMIT 1, 예외 없음)는 **과거 레거시 중복
  데이터에 대한 방어적 조회로만** 유지(정상 경로의 중복 허용 해결책이 아님). 구조 고정 테스트
  `SellerAccountServiceLockTest`(락 애노테이션 + 계정 조회 전 락 순서 + `findById` 미사용). (MED)
  `registerFileChannel`을 `fileUpload=true`로 스코프해 파일 채널 등록이 진행 중인 API 계정을 **덮어쓰지 않게**
  대칭화(양방향 격리 테스트 추가). (최종 diff 리뷰 MED) 위 대칭화로 (org, channel)에 두 행 공존이 가능해지자
  `Cafe24OnboardingService`의 단일-결과 `findByOrgIdAndChannelId`가 non-unique로 throw할 수 있는 회귀 →
  Cafe24 조회도 **모드-스코프 finder(`fileUpload=false`)** 로 전환(파일+API 공존 회귀 테스트 추가).
- **검증(오프라인).** 백엔드 `SellerAccountServiceTest`(생성·멱등·무강등·파일계정 분리·파일↔API 무간섭·미지
  채널 fail-closed); FE `ConnectNaver.test`(무계정→생성→등록, 완료 상태 표시, 리뷰-임포트 핸드오프) +
  `GuidedConnectionWizard.test`(완료 상태 패널). 라이브 NAVER 불필요(§17.10). 솔루션-제공자·NAVER 승인 주장 없음(§17.11).

### 2026-07-28 (2차) — 기존 앱 발견·재사용·복구 흐름 (같은 PR, FE-only, 신규 백엔드 능력 없음)

직선형 신규 발급을 넘어, 온보딩을 **발견·재사용·복구**로 확장한다. 상태 머신은 이제 브라우저 게이트가 아니라
**저장된 자격증명 확인(`check_saved_credential`)** 에서 시작한다:

- **저장 키 재사용(§flow 1–2).** Vault에 키가 있으면(`getConnectionInfoStrict ≠ null`) **재입력·에이전트·로그인
  없이** 바로 연결 테스트 → 성공 시 기존 앱 그대로 재사용. 실패(INVALID)면 `existing_credential_entry`로.
- **세 경로 분기(§flow 3/6/7).** 게이트 통과 후 `application_path_choice` 에서 셀러가 선택:
  `이미 있음`→기존 자격증명 입력, `모름`→`application_status_unknown`(셀러가 NAVER 애플리케이션 목록을 직접
  확인 후 있음/없음 선택), `처음`→신규 발급. **기존 앱이 있으면 새 앱 생성으로 자동 유도하지 않는다.**
- **자격증명 복구(§flow 4/8/9/10).** 앱은 있으나 시크릿 미확보 → `credential_recovery_required`. 다시 확인하면
  입력으로 복귀; **삭제 후 재발급은 기본이 아니라 최후 수단**(`delete_reissue_confirm`)이며, **다른 프로그램
  미사용 확인 체크박스** 통과 전에는 진행 불가. 기존 앱의 시크릿 재확인·교체·재발급·삭제 **가능 여부와 실제
  화면명은 라이브 확인 전 fail-closed**(추측한 버튼명·삭제 정책·재발급 기능을 사실처럼 구현하지 않음). SellerOps는
  앱을 대신 삭제하지 않는다.
- **구분된 실패 상태(§flow 5).** `permission_review_required`·`call_environment_mismatch`·인증 실패를 별도
  사용자 상태로 **모델링**. 단 권한/호출환경은 **명시적 backend reason code**로만 라우팅 — 현 backend는 이를
  구분하지 못하므로(라이브 정찰 G3-C 필요, §4/§20-2) **fail-closed**: 미분류 실패는 추측하지 않고 test 단계의
  일시 재시도로 남는다.
- **불변 유지.** FE-only(백엔드 무변경, 기존 경계 `getConnectionInfoStrict`/`testConnection`/`storeCredential`/
  `manualSync` 재사용), 기존 연결 사용자 Seller Account **중복 생성 없음**(멱등 create + 기존 계정 우선), Secret
  재표시·로깅 없음, 앱 자동 삭제 없음, 라이브 NAVER 없음, 마이그레이션 없음.
- **검증(오프라인 E2E).** reducer `state.test`(43) + `GuidedConnectionWizard.test`(26) + `ConnectNaver.test`(18):
  신규/기존/모름/저장키 성공/저장키 실패/Secret 분실/삭제 취소/0건 첫 동기화 전부 커버.

> **여전히 게이트(라이브)** — 기존 앱의 시크릿 복구·교체·삭제의 **정확한 NAVER 화면·절차·가능 여부**는 라이브
> 커머스 API 센터에서 확인해야 한다. 이 확인은 §14 정책 게이트/§20-3 PO 결정 뒤에 있으며, 그 시점에 실제 한국어
> 화면명으로 사용자 확인을 요청한다(이 PR에서는 수행하지 않음).

### 2026-07-29 — 라이브 핵심-흐름 확인 (Phase 0 정찰 + Phase 1 baseline; 비파괴)

착석 운영자·정상 호출-IP 환경에서 **비파괴** 범위만 라이브로 확인했다. NAVER 화면은 운영자가 직접 조작,
에이전트는 관찰·기록만. 자격증명·시크릿·토큰·스토어·raw IP는 출력/기록하지 않음. 상세 sanitized 기록:
`docs/action-window-runtime/naver-guided-api-connection-live-recon-runbook.md`(Phase 0/1 EXECUTED + 판정표 B1–B4).

- **§4 공식 흐름 = Playwright 읽기전용 관찰로 확인** — API 센터(`apicenter.commerce.naver.com`, Angular SPA,
  단일 top frame). 앱 목록→상세, 상태 **활성**, 필드/버튼 라벨 실물 확보(라벨만).
- **§13 재사용·복구 능력(일부 확인).** 애플리케이션 ID **재조회 가능(`복사`)**, 시크릿 **재조회(`보기`)+재발급
  (`재발급`) 어포던스 존재**, 호출 IP **현재 환경과 일치**. → §21 보존기록의 남은-라이브 ①(시크릿 재확인/재발급
  가능 여부+실화면명)이 **어포던스 수준에서 해소**. 단 **재발급을 누르지 않음**(파괴적, Phase 2 게이트).
- **§2 ④·⑤ / §17.6·§17.7·§17.9 = 라이브 확인.** 기존 앱 자격증명으로 **연결 테스트 PASS**(실 커머스 API 토큰
  발급 수락), **첫 ORDER_SUMMARY sync SUCCESS = 15건**(PAYED→PAID, daily↔per-order 정합), 커서 진행 후 **0건
  재동기화 = SUCCESS(=수집됨·신규없음, 실패와 구분)**. 멱등(동일 창 재노출 시 15건 전부 SKIP). — 제품 성공 기준
  §2의 등록→테스트→첫 실주문 수집→결과 표시(③④⑤⑥)가 **backend 경계 수준에서 라이브 성립**.
- **정직한 범위:** 위는 **제품 backend 경계**(`test-connection`/`sync`)를 실 NAVER API로 검증한 것 — **가이드 FE
  위저드의 라이브 end-to-end 워크는 아님**(§17.10: 구현 검증에 라이브 NAVER 불필요). 별도 disposable Postgres +
  env-only 플래그로 수행 후 철거; 제품 `sellerops.connector.naver.enabled`는 계속 **OFF**.
- **여전히 미확인/게이트:** ② 앱 **삭제** 경고·화면·정책(파괴적), 시크릿 **교체**(재발급 실행, 파괴적), ③
  권한부족·호출IP불일치 **실패 reason code**(정상경로 성공으로 미관찰). 판정표 4–13행 미실행.

---

### 부록 — 근거 문서·파일·출처
- 제품 원칙: `docs/product-scope-v1.md` §1.2·§6.1(셀러 소유 파일럿 ≠ 솔루션-제공자)
- 프론트 여정·완료: `docs/sellerops_frontend_spec.md` §16.10·§16.11·§17-B G3
- capability 진실: `docs/multi-channel-connector-roadmap.md` §4.1(NAVER ORDER_SUMMARY 라이브 1회)·§11
- 런타임·인증 불변식: `docs/sellerops_local_agent_runtime_adr.md` §3·§4
- G1/G2: `docs/slices/local-agent-bridge.md`, `docs/slices/browser-projection-v0.md`
- 현행 코드: `backend/.../connector/naver/{NaverTokenClient,NaverApiConnector,NaverOrdersClient}.java`,
  `.../collect/{SellerAccountCollectController,CollectControlService}.java`, `.../credential/{CredentialVault,
  CredentialTemplates,ConnectorCredential}.java`, `.../sync/{SyncJob,SyncRunExecutor}.java`,
  `collector/src/naver/{session-verdict,export-classify,session-probe,account-store-resolver}.ts`,
  `collector/src/esm/esm-candidate-signature.ts`, `frontend/src/{pages/Orders,pages/ChannelDetail,
  lib/bridge/projectionClient}.tsx?`
- NAVER 공식(외부 리서치): 커머스 API 센터 `apicenter.commerce.naver.com/ko/basic/commerce-api`,
  공식 기술지원 `github.com/commerce-api-naver/commerce-api`, 인증 토큰 발급(전자서명·`/external/v1/oauth2/token`·
  `type=SELF`) — 공식 문서 + 광범위 교차확인. **UI-특정 세부는 라이브 assisted 정찰로 확정(§4·§20-2).**
