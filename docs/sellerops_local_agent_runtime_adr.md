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
  HUMAN 핸드오프). **트레이·인스톨러·OS 자동시작은 명시적으로 미구현**(주석). 주기 실행(catch-up)은
  "not-yet-existing slice".
- **어댑터 축**: OS별 자동시작/설치(전부 미구현).

### 3.4 프론트↔에이전트 페어링/이벤트 계약
- **책임**: 안전한 로컬 페어링(토큰/포트/오리진), 실시간 상태 이벤트(현재 단계·로그인 필요·브라우저
  열림·완료/실패), 브라우저/세션 수명 보고.
- **현행 증거**: **통신 채널 없음**. 개념적 상태는 존재(`LocalAgentState` 12상태, `ConnectorStartupResult`,
  `ConnectorOrchestratorObserver` settle 콜백)하나 프론트로 나가는 전송이 없다.
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
