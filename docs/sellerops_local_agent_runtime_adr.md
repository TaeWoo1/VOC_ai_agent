# ADR — SellerOps Local Agent Runtime & Guided-Connection Architecture

> Status: **ACCEPTED (architecture decision), 2026-07-07.** 이 문서는 로컬 에이전트 런타임과 가이드
> 연결의 **아키텍처 경계 결정**의 정본이다. 제품 원칙은 `docs/product-scope-v1.md` §1.2·§6.1,
> 프론트 화면·상호작용은 `docs/sellerops_frontend_spec.md` §16, 커넥터 레벨 규칙은
> `docs/multi-channel-connector-roadmap.md` §11이 정본이며, 본 ADR은 그들이 참조하는 **런타임 경계**를
> 소유한다.
>
> **왜 새 문서인가.** collector의 기존 아키텍처 노트(`collector/docs/connector-orchestrator-model.md`,
> `local-agent-startup.md`, `two-track-product-architecture.md`, `connection-onboarding.md`)는 각각
> 개별 모듈·연결 온보딩·2트랙 데이터 분리를 다루며, **OS 어댑터 경계·프론트↔에이전트 페어링/이벤트
> 계약·실제 Chrome+CDP 프로젝션 방향·로컬 vs 클라우드 런타임 분리**를 총괄하는 문서는 없다. 이 결정은
> 그 문서들 위에 걸치므로 별도 ADR로 둔다. 세부 인터페이스는 저장소 증거가 있는 것만 기록하고, 나머지는
> **설계/리서치 과제**로 남긴다(§7).
>
> **정직성 경계.** 아래에서 결정된 방향 중 **인앱 브라우저 프로젝션·입력 릴레이·자동 재로그인·OS
> 자격증명 저장(Device Vault)·Windows 런타임·클라우드 실행은 현재 미구현**이다. 본 ADR은 경계를
> 확정하되 구현을 주장하지 않는다.

---

## 1. 맥락 (저장소 증거)

- 애플리케이션은 **웹앱(React SPA) + 별도 Node 로컬 에이전트 CLI**다. 데스크톱 셸(Electron/Tauri)·
  브라우저 확장은 존재하지 않는다(전 저장소 grep 확인). 로컬 에이전트 진입점은
  `collector/src/cli/local-agent.ts`(승인 플래그 없으면 DRY RUN).
- 브라우저 자세(교정된 최신): **실제 Chrome Stable을 일반 프로세스로 spawn + `chromium.connectOverCDP`**
  로 `navigator.webdriver=false` 유지, `--enable-automation`/`--use-mock-keychain`/`--headless` 거부
  (`collector/src/agent/progressive-reconnect-chrome.ts`). CDP 세션 보유(`newCDPSession`, `Page.enable`).
- 전용 프로필: `launchPersistentContext`/`--user-data-dir` + **경로 가드**(트리 밖 거부,
  개인 Chrome 프로필 재사용 금지 — `collector/src/profile.ts`, `agent/local-agent-launch.ts`).
- 커넥터 계약: 채널 무관 `ChannelConnector.ensureReady()` + `ConnectorOrchestrator`를 **로컬(browser)
  루트와 클라우드(API) 루트가 공유**(`collector/src/connector/*`, `two-track-product-architecture.md`).
- 프론트↔에이전트 **통신 채널은 현재 없음**(collector에 서버 없음; 상태는 stdout/`.status` 파일/
  sentinel 파일). 자격증명은 백엔드 Vault(API 키)·브라우저 세션(기기 로컬).
- OS: 현재 macOS 전제(Chrome 경로 하드코딩, Keychain 예외가 `platform==="darwin"` 분기 —
  `agent/local-agent-launch.ts`). Windows/Linux 미검증.

## 2. 결정 요약

1. **실제 Chrome + 전용 프로필 + CDP 자세를 유지**한다. 임베디드 Electron Chromium으로 **교체하지
   않는다**(이후 증거 없이는). 근거: 현재 anti-detection(`webdriver=false`)·실제 Keychain 자동완성
   전제가 CDP+실제 Chrome에 의존하며, 임베디드 Chromium은 이를 재현 못 할 수 있음(정찰 옵션 B 리스크).
2. **선호 목표 아키텍처 = 브라우저 프로젝션**: 실제 Chrome 뷰를 SellerOps에 투사(CDP 스크린캐스트류) +
   사용자 입력을 실제 브라우저로 릴레이 + 프로젝션 주위에 안내·단계 상태·복구 제공. 파일럿은 더 단순한
   형태(별도 창)로 시작하되 **아키텍처는 인앱 프로젝션으로 확장 가능**해야 한다.
3. **OS 의존 관심사는 명시적 포트/어댑터 뒤**에 둔다(§3). Mac-first 구현, Windows-target 배포.
4. **로컬 모드가 현재 런타임**, 클라우드 관리형은 이후 티어. 공유 계약·flow 정의가 클라우드를 막지
   않도록 설계하되 지금 구현하지 않는다.

## 3. 아키텍처 경계 (포트/어댑터)

각 경계는 **인터페이스 위치**만 결정한다. 시그니처 세부는 증거가 있는 것만 적고, 나머지는 §7 과제.

### 3.1 BrowserRuntime 경계
- **책임**: 브라우저 프로세스 기동·수명·CDP 부착·프로젝션 스트림/입력 릴레이·프로필 경로 가드.
- **현행 증거**: `ProgressiveReconnectChromeBrowser`(실제 Chrome+CDP), `profile.ts`(persistent-context),
  `buildLaunchOptions`/`buildLocalAgentLaunchPolicy`(OS 분기). 이미 CDP 세션 보유 → 스크린캐스트/입력
  주입의 자연스러운 부착점.
- **어댑터 축**: macOS Chrome(현행) / Windows Chrome(미구현). 임베디드 Chromium은 **비채택**(재평가는
  §7 리서치 결과 필요).

### 3.2 CredentialVault 경계
- **책임**: 자동 재로그인용 OS 자격증명 저장·조회, 동의 상태 보관.
- **현행 증거**: **미구현**(`local-agent.ts`: "no Device Vault"). 백엔드에는 API 키용 AES-256-GCM
  Vault가 별도로 있으나(`docs/sellerops_phase3b_completion.md` §2), **브라우저 로그인 자격증명 저장은
  아님**. macOS Keychain 자동완성 재활성화(`--use-mock-keychain` drop)는 "브라우저가 알아서 채움"을
  가능케 하는 것이지 에이전트가 값을 저장/입력하는 것이 아니다.
- **어댑터 축**: macOS(파일럿) / Windows(후속). **자동 자격증명 입력은 미구현이며 표기 금지.**

### 3.3 AgentLifecycle 경계
- **책임**: 에이전트 기동/종료/자동시작/백그라운드 주기 실행(세션 점검·설정된 수집), 웹 UI와 독립된 수명.
- **현행 증거**: `local-agent.ts`가 SIGINT/SIGTERM idempotent shutdown, 브라우저 연결은 상주(WAITING/
  HUMAN 핸드오프). 주기 실행(catch-up)은 "not-yet-existing slice".
- **[상태 갱신 2026-07-28 — Pilot-Ready Local Agent Runtime v1]**: **Windows 어댑터가 구현됨**(오프라인
  완료, 온-디바이스 검증 대기). 단일 인스턴스 락(라이브니스 기반)+크래시 복구, 소유 프로세스만
  PID/프로세스그룹으로 종료(이름 매칭 금지), per-user 데이터 루트(업데이트 시 프로필/페어링 보존),
  부트 self-check(backend·bridge·origin·version·capability), 진단 내보내기, 그리고 **로그인 시 자동 시작
  (Startup 폴더 바로가기 — Windows 서비스 아님: 헤드 Chrome은 사용자 세션에서 떠야 함)**.
  설치·업데이트·제거 스크립트는 `collector/packaging/windows/`, 설계·검증표는
  `docs/action-window-runtime/pilot-ready-local-agent-runtime.md`. 자동 재로그인·Device Vault는 여전히
  미구현이며, 세션 재사용은 영속 프로필 쿠키로만 이뤄진다(§3.2/§4 유지).
- **어댑터 축**: **Windows — 구현됨(위)**; macOS 자동시작/인스톨러는 미구현.
- **네이티브 승인 presenter — macOS 지원, 그 외 미구현 (2026-07-15)**: 페어링 승인 비밀은
  `ApprovalPresenter` 포트로만 사람에게 전달되며(`collector/src/bridge/approval-presenter.ts`,
  계약은 `docs/slices/local-agent-bridge.md` §0.2.1), 승인은 **모든 환경에서 fail-closed**다 —
  presenter가 없거나 사람에게 도달함을 증명하지 못하면 브리지는 `503 approval_unavailable`로
  **페어링을 거절**한다. §1대로 데스크톱 셸(Electron/Tauri)은 여전히 **없다**; 승인 채널은
  셸 없이 OS 네이티브 다이얼로그로 해결한다.
  - **어댑터 축 상태**:
    - **macOS — 구현됨(production)**: `macos-approval-presenter.ts`.
      `/usr/bin/osascript`를 **절대경로·`shell:false`**로 exec(셸 미개입 → 셸 메타문자 해석 자체가
      불가능), 스크립트는 **stdin**(`osascript -`)으로 전달. **동적 값(origin·워크스페이스 라벨·
      승인 코드)은 전부 stdin에만** 실린다 — argv는 프로세스 테이블(`ps`)에서 누구나 읽으므로
      argv 전달은 이 설계가 막으려는 로컬 프로세스에게 비밀을 그대로 넘겨준다. argv는 상수 `["-"]`뿐.
      **AppleScript 인젝션 이스케이프 필수**: `workspaceLabel`은 요청 본문에서 오는 **신뢰 불가 입력**이라
      제어문자 제거 + `\`·`"` 이스케이프(`appleScriptLiteral`) 없이는 리터럴을 닫고 임의 AppleScript가
      실행된다. **비차단**: `spawn`(≠`spawnSync`) + async `present` — 블로킹 다이얼로그는 에이전트
      이벤트 루프(전 WS 소켓·하트비트·진행 중 run)를 다이얼로그가 닫힐 때까지 얼린다.
      **fail-closed**: 비-macOS · osascript 부재 · 다이얼로그 오류/GUI 세션 없음 · 타임아웃 → `unavailable`
      (요청 롤백). 성공을 관측하지 못한 다이얼로그를 `presented`라고 보고하지 않는다.
      **라이브 검증 완료(2026-07-15, 운영자 입회)**: 실제 macOS 데스크톱에서 **사람의 세 결말이 모두
      관측**되었다 — `확인` → `presented`(2.9초) · `Esc` → `declined`(4.5초) · `취소` 버튼 →
      `declined`(3.7초). 합성 값만 사용, presenter 직접 호출(브리지·커넥터 미기동), 페어링/런타임 상태
      미기록. **따라서 위 "macOS 구현됨(production)"은 관측된 사실이며 구조적 주장이 아니다.**
      전체 기록(중간에 발견·수정한 거부 불가 결함 및 본문 렌더링 결함 2건 포함):
      `docs/slices/local-agent-bridge.md` §0.2.2.
      거부 경로 계약: `buttons {"취소","확인"} … cancel button 1` + `on error number -128` →
      `{status:"declined"}` → 브리지는 요청을 **즉시 폐기**하고 `403 approval_declined`
      (≠ `503 approval_unavailable`)로 응답한다. 무시되어 자동 닫힘(gave up)은 `presented` —
      코드는 읽힐 시간 동안 표시되었고 사람이 브라우저에 입력 중일 수 있다(설계상 의도, 라이브 미관측).
    - **Windows — 구현됨 (2026-07-28, Pilot-Ready v1; 온-디바이스 미검증)**:
      `bridge/windows-approval-presenter.ts` — PowerShell `MessageBox`(OK/취소), 절대경로
      `powershell.exe`·`shell:false`, 스크립트는 **stdin**(`-Command -`), 동적 값(오리진·라벨·승인 코드)은
      전부 stdin에만(argv는 상수 플래그뿐), PowerShell 단일따옴표 리터럴 이스케이프(`'`→`''`)+제어문자
      제거, fail-closed(비-win32·powershell 부재·오류·타임아웃→unavailable, 취소→declined). macOS와 동일
      규칙. **온-스크린 표시는 라이브 미검증**(주입 시임으로만 테스트) — §4.6 정직성 규칙대로 운영자
      실행 전까지 미확정. `decideApprovalPresenter`가 production+win32 → `windows_native`로 배선.
    - **Linux — 미구현**: `zenity`/`kdialog` 등. 동일 규칙 적용.
    - **DEV 전용**: TTY stderr presenter(`stderr-approval-presenter.ts`) — 리다이렉트된 stderr는
      사람 채널이 아니므로 unavailable, `NODE_ENV=production`에서 거부.
  - **귀결**: **macOS production 에이전트는 페어링 가능**하다. **Windows/Linux production 페어링은
    각 어댑터가 생길 때까지 구조적으로 거절된다** — 회귀가 아니라 정직한 상태다(종전 동작은 임의의
    로컬 프로세스가 위조 가능했다).
  - **주입 지점 (결정됨 2026-07-15)**: presenter 선택은 **실제 부트 경로인 `cli/local-agent.ts`에서만**
    이뤄진다 — 순수 결정 `decideApprovalPresenter(env, platform)` + `createApprovalPresenterFor(kind)`.
    **`createAgentBridge`의 기본값으로 두지 않는다**: 기본값이 있으면 모든 임베더가 실제 네이티브
    presenter를 물려받아, 컴포지션 루트를 통해 페어링하는 테스트가 macOS에서 **실제 다이얼로그를
    띄운다**. 매트릭스: production+darwin → `macos_native` · production+그 외 → `none`(fail-closed) ·
    DEV → `dev_tty_stderr`(**macOS 포함** — dev/test 부트가 다이얼로그를 띄울 수 없게 하려는 의도).
    부트는 선택된 **kind(enum)만** stdout에 표기한다(`BRIDGE` 이벤트의 `approvalPresenter`) —
    코드/오리진/페어링 세부는 절대 표기하지 않는다.
  - **[PO-DECISION] 미결**: Windows/Linux 어댑터 슬라이스 순서. 각 어댑터가 생기기 전까지 해당 호스트의
    production 페어링은 **fail-closed로 거절**된다(회귀 아님 — 종전 동작은 임의의 로컬 프로세스가
    위조 가능했다). 구현 시 macOS와 동일 규칙 필수: **stdin 전용·argv 금지**, 인젝션 이스케이프,
    **필드별 캡**(조립 본문 전체 캡 금지 — 승인 코드가 밀려날 수 있다), 거부 수단 제공.

### 3.4 프론트↔에이전트 페어링/이벤트 계약
- **책임**: 안전한 로컬 페어링(토큰/포트/오리진), 실시간 상태 이벤트(현재 단계·로그인 필요·브라우저
  열림·완료/실패), 브라우저/세션 수명 보고.
- **현행 증거**: **통신 채널 없음**. 개념적 상태는 존재(`LocalAgentState` **11상태**
  (`collector/src/agent/local-agent-state.ts`), `ConnectorStartupResult`, `ConnectorOrchestratorObserver`
  settle 콜백)하나 프론트로 나가는 전송이 없다. (정정 2026-07-08: 이전 "12상태"는 오기.)
- **sanitized 계약**: 이벤트는 enum/boolean/coarse bucket/16-hex만(collector `log.ts` safeMeta,
  `connector-orchestrator.ts`). raw URL/좌표/DOM/자격증명 노출 금지 — 프로젝션 코치마크에 좌표/URL이
  필요하면 **로컬 신뢰 채널 예외**를 별도 결정해야 한다(§7 [PO-DECISION]).

### 3.5 로컬 vs 클라우드 런타임 분리
- **공유(track-중립)**: 채널 flow 정의, `ChannelConnector`/`ConnectorOrchestrator` 계약, 상태 감지
  순수 로직, UI 이벤트 계약, 사람 개입 enum. (근거: `connector-orchestrator-model.md`,
  `two-track-product-architecture.md` — 두 루트가 같은 orchestrator 구동.)
- **분리(런타임별)**: 브라우저 실행지(로컬 Chrome vs 원격), 세션 저장(로컬 `.profile/` vs 원격),
  전송 채널, 사람 개입 핸드오프(cold-context 재연결 지속성 미해결 — `docs/esm/decisions.md` D8).
- **결정**: 클라우드 실행은 **미구현**이되, 위 공유 계약이 그것을 막지 않도록 유지한다.

## 4. 인증·세션 모델 (경계 위의 정책)

- **선호 모드**: 자동 로그인 동의 1회(명시) → OS 자격증명 저장(CredentialVault 어댑터) → 채널이 안전히
  지원할 때 자동 재로그인 시도.
- **폴백 모드**: 전용 프로필 세션 보존 + 사람 재로그인 요청.
- **불변식**(현행 코드 계승): 로그인/2FA/CAPTCHA/계정 잠금은 **절대 우회 안 함**, 사람이 수행
  (`connection-onboarding.md`). 계정/스토어 선택 자동화 **영구 금지**. 자동 재연결은 `autoReconnectConsent`
  없으면 브라우저를 띄우지 않음(`browser-connector.ts`). 감독형 클릭은 정확히 1회(승인 후).
- **동의 3종 분리**: 자동 로그인 동의 · 자격증명 저장 동의 · 마켓 권한 동의는 각각 명시적.
- **정직성**: 자동 재로그인·Device Vault는 미구현. 최초 설정 후 정상 운영은 세션 만료·2FA·CAPTCHA·
  비밀번호 변경·신규 권한 동의·모호한 계정 선택 같은 예외에만 사람 개입이 필요하도록 하는 것이 **목표**다.
- **가이드형 답변 제출 개정 (v1.6, MUTATING 행동).** 리뷰 답변 제출은 **마켓 쓰기**이므로 §4 경계를
  **확장하되 완화하지 않는다**(상세는 `r4-preparation.md` §4.1). 핵심: **판매자가 답변을 작성·붙여넣고 직접
  제출**하며, **런타임은 답변란을 하이라이트하고 관찰만** 한다 — 입력란에 타이핑하지 않고 제출을 클릭하지
  않는다("감독형 클릭은 정확히 1회"는 export 트리거에 대한 것이며, 답변 제출에서는 런타임 클릭 **없음**으로
  더 좁게 적용된다). 제출은 **멱등이 아니므로** 바인딩 `submissionRef`는 **1회용**이고 런타임은 제출을 **자동
  재구동하지 않는다**(중단 시 park). read-back 오라클이 없어 결과는 `OPERATOR_REPORTED`(운영자 보고,
  `UNVERIFIED`)로만 종료하며 **`COMPLETED` 아님**.

## 5. NAVER 첫 프로토타입 (경계 관점)

- 대상: **셀러 소유 NAVER 커머스 API 앱 발급 + 연결**(파일럿 경로 — 미래 솔루션-제공자 OAuth 모델
  아님, `product-scope-v1.md` §6.1). 완료 기준 6단계는 Frontend Spec §16.10.
- 경계 매핑: API-센터 흐름 열기·안내 = BrowserRuntime + 프론트 이벤트 계약; Client ID/Secret 등록 =
  기존 백엔드 Vault(`POST …/credentials`, 구현됨); 연결 테스트 = `test-connection`(구현됨); 첫 주문
  수집 = NAVER ORDER_SUMMARY(라이브 1회 검증, Connector Roadmap §4.1); 결과 표시 = 대시보드.
- 이 프로토타입은 **자동 재로그인·프로젝션 없이도** 성립(§Frontend Spec §16.11).

## 6. 대안과 기각 사유

- **옵션 B(임베디드 Chromium 데스크톱 셸)**: 인앱 오버레이 최상이나, `webdriver=false`·실제 Keychain·
  마켓 봇 탐지 전제를 위협하고 3-OS 빌드·서명·보안(앱이 로그인 폼 호스팅) 부담이 큼 → **기각**(이후
  리서치로 뒤집힐 수 있음, §7).
- **옵션 A(별도 창 유지)**: 변경 최소·리스크 최소이나 "인앱 튜토리얼" 목표에 부분 미달 → **파일럿
  단계에서 허용**, 최종 목표는 프로젝션(옵션 C).
- **옵션 C(실제 Chrome CDP 프로젝션)**: 현재 CDP 자세와 정합, 로컬↔클라우드 재사용 유리 → **채택 방향**.

## 7. 미해결 과제 (분류 — 카테고리 2·3은 최종 결정으로 인코딩하지 않음)

### (1) 저장소 검증 가능 (repository-verifiable)
- `ConnectorOrchestratorObserver`의 settle-시점 콜백이 실시간 스트리밍에 충분한지, 아니면 상태 스트림
  훅이 추가로 필요한지 — `local-agent-runtime.ts`(758줄)·`progressive-reconnect-runtime.ts` 정독으로 확인.
- `LocalAgentState` 12상태를 프론트 이벤트 계약(현재 단계/로그인 필요/브라우저 열림/완료·실패)으로
  매핑하는 정확한 대응 — 코드로 도출 가능.
- Cafe24 콜백 릴레이(`tools/cafe24-callback/`, 미커밋)가 인앱 OAuth 콜백 설계에 재사용되는지.

### (2) 외부 리서치 필요 (external-research)
- 임베디드 Chromium이 마켓 봇 탐지 통과·`webdriver=false`·Keychain 자동완성을 재현하는지(옵션 B 재평가).
- CDP 스크린캐스트 프로젝션·입력 릴레이가 각 마켓 약관의 자동화 조항에 저촉되는지.
- NAVER 솔루션-제공자 OAuth 파트너 자격·등록 절차(미래 모델 선결).
- Windows에서 실제 Chrome+CDP+자격증명 저장소의 동등 자세 확보 가능성.

### (3) 제품 오너 결정 필요 (product-owner)
- sanitized 계약의 **로컬 신뢰 채널 예외**: 프로젝션 코치마크용 좌표/URL/요소 메타데이터를 프론트로
  넘길지(넘기면 정밀 오버레이 가능, 안 넘기면 제한). §3.4·Frontend Spec §16.2.
- 프론트-에이전트 **페어링/인증 모델**(토큰·포트·오리진) 구체 정책. 업로드용 데브 계정을 revocable
  pairing token으로 교체하는 시점.
- 첫 프로토타입에서 자동 편의 단계의 허용 범위(감독형 단일 클릭 원칙과의 경계).
- Windows 지원·클라우드 런타임 착수 시점(현재는 방향으로만).

---

### 부록 — 근거 파일
- 브라우저 자세: `collector/src/agent/progressive-reconnect-chrome.ts`, `collector/src/profile.ts`,
  `collector/src/agent/local-agent-launch.ts`
- 커넥터 계약·2트랙: `collector/src/connector/*`, `collector/docs/connector-orchestrator-model.md`,
  `collector/docs/two-track-product-architecture.md`
- 로컬 에이전트 진입점: `collector/src/cli/local-agent.ts`, `collector/docs/local-agent-startup.md`
- 연결 온보딩 불변식: `collector/docs/connection-onboarding.md`
- 자격증명 Vault(API 키, 브라우저 로그인 아님): `docs/sellerops_phase3b_completion.md` §2
- 상위 결정 근거: 2026-07-07 로컬 에이전트 아키텍처 정찰 세션 보고
