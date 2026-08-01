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
0 NAVER 호출)를 최종 게이트로 요구하고 **정확히 하나의 operator URL + expected runId/git/dbAlias**를 출력. 도구:
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
