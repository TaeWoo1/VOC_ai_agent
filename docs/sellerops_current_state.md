# SellerOps — Current State (living handoff)

> **Living handoff document — not a strategy document.** 이 문서는 "지금 어디까지 됐는가"의 단일
> 스냅샷이다. 제품 의도/범위는 `docs/product-scope-v1.md`, 프론트 스펙은 `docs/sellerops_frontend_spec.md`,
> capability 진실은 `docs/multi-channel-connector-roadmap.md` §4.1이 정본이며, 본 문서는 그들을 참조한다.
> 새 슬라이스가 끝나거나 상태가 바뀌면 갱신한다.

## 1. Last updated
2026-07-08 (Product Shell 커밋 `3006e44`; Local Agent Bridge G1 `c253dca`; **Browser Projection V0(§17-B G2)
커밋 완료 `a0e4f6f`**; **NAVER Guided Connection G3(§17-B) 계약 초안** — 문서 전용, 구현 미착수;
**정본 문서에 최종 제품·채널 전략 인코딩(문서 전용, 미커밋)** — SellerOps=SME 멀티채널 커머스 운영
에이전트 재정의(운영 루프 OBSERVE→…→RESUME), 사용자 대면 자율 모드 4종, **기본 리뷰 수집 모드=ACTION_WINDOW**,
사업자·등록 결정, OperationRun 방향, 신규 문서 `channel-capability-registration-matrix.md`·`slices/action-window-v1.md`).
**마켓 라이브-사용 게이트 유지(닫힘)**; 자동 로그인 여전히 미구현.

## 2. Current product phase
Seller Track 프론트 리디자인 + **가이드 연결 인프라 트랙 진행**. **Product Shell 슬라이스 = 커밋 완료**
(베이스라인 `3006e447b91de72f5e3627da75f390c74d92bfac`). **Local Agent Bridge(§17-B G1) = 커밋 완료**
(`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`, 페어링+관측 전용 브리지). **현재 문서 작업 = Browser
Projection V0(§17-B G2) 실행 계약 초안**(`docs/slices/browser-projection-v0.md`, 제품 오너 리뷰 대기).
Browser Projection **구현은 미착수**(계약 승인 전). Guided Connection·자동 로그인·Device Vault·Windows
패키징·클라우드 런타임은 **여전히 미구현**(범위 밖 §9·§14). 수집·커넥터 백엔드는 기존 상태 유지(신규 채널 오픈 없음).

## 3. Canonical document index
| 문서 | 역할 |
|---|---|
| `docs/product-scope-v1.md` (v1.2) | 제품 범위 계약, 운영 에이전트 정의·운영 루프·자율 모드·Action Window 기본·사업자 결정, Track, frontstage/backstage, 가이드 연결 원칙 |
| `docs/sellerops_frontend_spec.md` | 프론트 IA·화면·여정·가이드 연결·Action Window 화면(§18)·슬라이스 정본 |
| `docs/multi-channel-connector-roadmap.md` | 수집 전략 + §4.1 채널 현행표(capability 진실) + §5.1 Action Window 기본 + §5.2 채널 결정 + §11 연결 모드 |
| `docs/channel-capability-registration-matrix.md` | (파생 뷰) 채널×capability × 자율 모드 × 셀러키/제공자 등록 × 사업자 조치 × 블로커 |
| `docs/sellerops_local_agent_runtime_adr.md` | 로컬 에이전트 런타임 경계·프로젝션 방향 ADR |
| `docs/slices/action-window-v1.md` | Action Window(기본 리뷰 수집 모드) 실행 계약 초안 |
| `docs/slices/{local-agent-bridge,browser-projection-v0,naver-guided-connection}.md` | 가이드 연결 인프라 G1·G2·G3 슬라이스 계약 |
| `docs/sellerops_phase3c_live_smoke.md`, `docs/sellerops_cafe24_live_verification.md` | 라이브 검증 기록 |

## 4. Current frontend state
- React 18 + TS + Vite + Tailwind SPA(`frontend/`). 라우팅 react-router-dom, 상태는 자체 `useApiData` + axios.
- 주요 읽기는 fail-closed strict(`apiClient.ts` `*Strict`), 일부 조용한 mock 폴백(`getOrMock`) 잔존(제거는 후속 S4).
- **Product Shell 반영 후 상태**: 내비게이션 2그룹(운영/연결·설정), 채널·업로드·알림은 `/settings/*`,
  구경로 리다이렉트 유지, `/search` 제거, 404 페이지 신설, 모바일 임시 드로어 내비(메뉴 버튼), 개발자
  오류 문구 → 셀러 언어("잠시 후 다시 시도해 주세요") 전량 교체. **비즈니스 로직·API 무변경.**
- **커밋 완료**(`3006e44`). 검증 결과는 §15.

## 5. Current backend state
- Spring Boot 3 + Postgres + Flyway + JWT. 컨트롤러 ~26개(auth/channels/dashboard/orders/inbox/
  seller-accounts/sync/uploads/attention/inquiries/connector-alerts/cafe24-connect 등).
- 커넥터 플래그 기본 off. 스케줄러 기본 off. 자격증명은 AES-256-GCM Vault(API 키용).

## 6. Connector & local-agent state
- 커넥터: NAVER·Cafe24 ORDER_SUMMARY 구현, 나머지(Coupang/ESM/11st/SSG) 인증 골격만. 상세는 §4.1 현행표.
- 로컬 에이전트(collector): 실제 Chrome+CDP 감독형 세션, 전용 프로필, 승인 플래그 없으면 DRY RUN.
  트레이/인스톨러/OS 자동시작/Device Vault/catch-up 실행은 **미구현**.

## 7. Live-verified capabilities
- 파일 업로드(전 채널) 인입 + dedup (E2E 스모크).
- NAVER ORDER_SUMMARY API 수집 1회 (2026-06-14).
- Cafe24 ORDER_SUMMARY API 수집 E2E PASS (토큰 회전·금액 대사).
- NAVER 리뷰 감독형 캡처→다운로드 저장 (2026-06-22; 자동 업로드 브리지는 미검증).
- Cafe24 게시판(리뷰/문의) 열람 discovery 1회 CONFIRMED.

## 8. Implemented but not live-verified
- Cafe24 OAuth 프론트 연결 플로우(FE `/connect/cafe24`); 백엔드 토큰 체인은 검증됐으나 FE 플로우 자체 미검증.
- 자격증명 템플릿 기반 키 등록 폼(6채널), 연결 확인(`test-connection` — 실검증기는 NAVER만).
- 스케줄/수동수집/백필/재시도/알림 acknowledge 계열.
- 문의 제안 생성 워크플로(FE 연결됨), 백엔드 draft/verify/confirm-publish(FE 미연결).
- ESM INQUIRY read 스켈레톤(unwired), ESM INQUIRY Excel 임포트 백엔드(FE 미노출).

## 9. Explicitly NOT implemented (표기 금지)
- **Action Window(기본 리뷰 수집 모드)** — 계약 초안만(`docs/slices/action-window-v1.md`, DRAFT). 실제 창
  오버레이·다운로드 완료 감지 seam **미구현**. 실제 마켓 사용은 정책 게이트 뒤. 자율 모드=ACTION_WINDOW.
- **브라우저 프로젝션**(인앱 브라우저 뷰 투사) — **채널-중립 V0 구현·커밋됨**(`a0e4f6f`, 로컬 픽스처 전용,
  **마켓 사용 미승인·비-기본 렌더러** §20). **production-runtime 미배선 (State B)**: 정상 Local Agent 제품
  부팅은 프로젝션 소스를 생성·주입하지 않는다(`resolveAgentBridgeConfig`가 `projection` 미설정 → `/projection/ws`
  404); 실제 CDP 소스 `ProjectionAdapter`는 테스트/QA 하니스에서만 생성(browser-projection-v0 §22.8). 프론트
  프로젝션 클라이언트·기능 플래그는 구현·커밋됐으나 별도 QA 하니스 없이는 연결 불가. 자동 마스킹·코치마크·
  자동 로그인·다중 동시 타깃·Windows는 여전히 미구현.
- **OS Device Vault / 자동 자격증명 입력 / 자동 재로그인** — 미구현.
- **프론트↔로컬 에이전트 통신 채널** — **G1 브리지로 구축됨(페어링+관측 전용, 실제 Local Agent 소유)**.
  **G1 자체에는** 프로젝션·입력 릴레이·워크플로/브라우저 제어 명령이 없다(G1 범위 밖·§0.5). 그중 **프로젝션 +
  제한된 입력 릴레이는 G2로 구현·커밋**(`a0e4f6f`; 단 마켓 미승인·**production-runtime 미배선 State B**);
  **마켓 워크플로/브라우저 제어·자동 클릭·자격증명 입력 명령은 여전히 미구현**(설계상 영구 제외 계열).
- **실행-중 이벤트(browser_lifecycle·collection_progress/result·auth_session·terminal_failure)** — **예약**
  (스키마만; 실제 방출 seam 없음, `supportedEvents`에서 제외). 실제 배선 = agent/bridge lifecycle·
  connection_lifecycle·pending_user_action·recoverable_failure·capability.
- **Windows 지원** — 미구현(현행 macOS 전제; 브리지 전송은 `ws`/Node 표준이라 이식 경로만 문서화).
- **클라우드 관리형 런타임** — 미구현(방향으로만).
- 채널 쓰기(답변 발송/주문 상태 변경), 무인 자동 수집, 자동 제품 매칭, standalone AI 검색.

## 10. Active slice
**NAVER Guided Connection (Guided-Connection G3) — 계약 초안 작성 중** — `docs/slices/naver-guided-connection.md`
(**DRAFT, 제품 오너 리뷰 대기 2026-07-08**). **문서 전용; 구현 미착수.** G3 = G1(페어링)·G2(프로젝션) 위에
**셀러 소유 NAVER 커머스 API 앱 발급(type=SELF) 가이드 + 첫 실주문 수집**(Frontend Spec §16.10 6단계).
셀러 소유 파일럿 경로이며 **솔루션-제공자 모델 아님**(product-scope §6.1). 가이드 상태 엔진·행위자 경계
(USER_REQUIRED/…/UNSUPPORTED)·fail-closed 상태 감지·안전 자격증명 등록(Secret은 백엔드 Vault 경계로만·
프론트/로그/프레임 미기록)·기존 `test-connection`/`sync` 합성·재개/복구 규정. **자동 로그인·자동 클릭·자동
Secret 추출·클립보드·2FA 처리 제외.** 슬라이스: G3-A(상태엔진+합성)·G3-B(자격증명/테스트/sync 합성)·
**G3-C(라이브 정찰 — 별도 승인+정책 게이트)**·G3-D(하드닝). **마켓 라이브-사용 게이트 유지(닫힘, §14).**
관찰: 백엔드 NAVER 커넥터(`NaverTokenClient`/`NaverApiConnector`)는 **구현됐으나 플래그 OFF 기본**(라이브
검증은 플래그 활성+승인 후). **Browser Projection V0은 커밋 완료**(`a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`).

### 이전 활성 슬라이스 (참고) — Browser Projection V0 (G2), 커밋 `a0e4f6f`
`docs/slices/browser-projection-v0.md`(§0 PO 결정 인코딩, §19 스파이크, §22 구현 결과·§22.8 State B). **상태:
구현·검증·커밋 완료(`a0e4f6f`), 마켓 사용 미승인(§20 게이트), 비-기본 렌더러, production-runtime 미배선
(State B — 정상 부팅이 프로젝션 소스를 생성·주입하지 않음, §22.8).** G2 = G1 브리지 위에 실제 Chrome
뷰 로컬 투사(`Page.startScreencast` 바이너리 프레임) + 명시적 사람 입력 릴레이(iframe·Electron 아님,
ADR §6 옵션 C). **프로젝션 전용 바이너리 전송을 G1 상태 채널과 분리**(64KiB JSON 미변경), 페어링=신뢰
루트·프로젝션 단명 세션·제어 리스 분리, 단일 제어 소유자+다중 관람, 2분 idle 리스, drop-old 큐(depth≤2),
데스크톱 전용. 마켓 자동화·자동 로그인·자동 클릭·코치마크·다중 동시 타깃은 범위 밖. **Local Agent Bridge
G1은 커밋 완료**(`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`). Product Shell은
`3006e447b91de72f5e3627da75f390c74d92bfac`로 커밋 완료.

### 신규/변경 파일 (Browser Projection V0)
- **collector 신규**: `src/bridge/{projection-protocol,projection-session,projection-input,projection-adapter,
  projection-hub,projection-endpoint}.ts`; `test/bridge/projection-{session,input,adapter,hub,server,privacy}.test.ts`
  (46개); `test/fixtures/projection/{minimal,seller-center,popup}.html`(합성·마켓 무관).
- **collector 변경**: `src/bridge/bridge-server.ts`(프로젝션 엔드포인트/WS/틱/리보크 캐스케이드 — G1 상태
  채널 미변경), `src/agent/agent-bridge.ts`(선택적 프로젝션 주입 seam).
- **frontend 신규**: `src/lib/bridge/{projectionProtocol,projectionClient}.ts`(+`projectionClient.test.ts`),
  `src/hooks/useProjection.ts`, `src/components/bridge/ProjectionView.tsx`.
- **frontend 변경**: `components/AppShell.tsx`(`VITE_ENABLE_AGENT_PROJECTION` 게이트).
- **패키지 변경 없음**(collector·frontend package.json/lock 무변경).

### 검증 (2026-07-08)
- collector: typecheck OK, `npm test` **2299 pass**(1 skip; 프로젝션 46). frontend: typecheck OK,
  `npm test` **166 pass**(프로젝션 10), `npm run build` OK.
- E2E QA(실제 Chrome 150 + 실제 전송 + 로컬 픽스처): 제어 획득, **입력→렌더 p95 130ms**, 리사이즈 후
  좌표 오차 0px, 리보크 시 프레임·입력 중단. 리치 픽스처 프레임 ~36.5KB, everyNth6=7.2fps→시간기반 캡 권장.
- 프라이버시: 프레임 바이트·입력·URL·티켓 로그 0(소스가드+로그싱크). QA 하니스는 저장소 밖 스크래치패드 1회성.

G1 = 프론트↔로컬 에이전트 **안전 페어링 + 관측 전용** 브리지. **WebSocket 전송 = 성숙한 `ws` 라이브러리**
(HTTP는 health·페어링·티켓 부트스트랩), loopback 전용, 명시적 오리진 허용(와일드카드 금지), 로컬 확인
페어링(리보크 전까지 유효, 양측 리보크), 단명·1회용 WS 티켓, sanitized 실시간 이벤트, 스냅샷 복원, 다중
탭, 버전/능력 협상(`supportedEvents`), 단일 인스턴스. **마켓 워크플로/브라우저 제어/자동 클릭/자격증명
입력 명령 없음.** **브리지는 실제 Local Agent가 소유**(`src/agent/agent-bridge.ts` ← `cli/local-agent.ts`):
승인 런에서 1회 기동, SellerOps 탭과 독립 상주, SIGINT/SIGTERM에 idempotent close, 스냅샷·이벤트는
실제 설정 연결 + 실제 orchestrator settle에서 파생. 표준 `cli/bridge.ts`는 dev/test 하니스.

### 신규/변경 파일 (Local Agent Bridge G1 + 하드닝)
- **collector 신규**: `src/bridge/{protocol,origin-policy,pairing,pairing-store,event-adapter,
  confirmation-page,bridge-server}.ts`, `src/agent/agent-bridge.ts`, `src/cli/bridge.ts`(dev 하니스),
  `test/bridge/*`(7 스펙+helpers, 47 테스트). (`ws-frame.ts`·그 테스트는 하드닝에서 삭제.)
- **collector 변경**: `.gitignore`(`.bridge/`), `package.json`+`package-lock.json`(**`ws` 런타임 dep +
  `@types/ws` devDep**), `src/cli/local-agent.ts`(브리지 통합), `src/cli/bridge.ts`(하니스 라벨).
- **frontend 신규**: `src/lib/bridge/{bridgeProtocol,bridgeClient}.ts`(+`bridgeClient.test.ts` 12 테스트),
  `src/hooks/useBridge.ts`, `src/components/bridge/BridgeStatus.tsx`.
- **frontend 변경**: `components/AppShell.tsx`(`VITE_ENABLE_AGENT_BRIDGE` 게이트 도크; 내비 무변경).
- **패키지 변경 = `ws`/`@types/ws`/lock 뿐**(다른 dep 변경 없음).

### 검증 (2026-07-08, 하드닝 후)
- collector: typecheck OK, `npm test` **2253 pass**(1 skip; 브리지 47 포함), 실제 Local Agent+Bridge
  수명 스모크 통과(브리지 1회 기동 → 실제 settle → 클린 SHUTDOWN·close).
- frontend: typecheck OK, `npm test` **156 pass**(브리지 12 포함), `npm run build` OK(146 모듈).
- Chrome 스파이크(§6.1): HTTPS→루프백 WS(로컬 open, public은 LNA 권한, 미기동 connection_refused).
- 브라우저 QA(실제 `ws` 브리지+실제 프론트, mock): unpaired→연결→로컬 확인→paired→새로고침 재연결→다중
  탭→리보크→에이전트 미기동 **전부 통과**. 미인증 health는 `paired` 없이 최소 노출 확인.
- `ws` 전송 테스트: 바이너리 거부(1003)·oversize(1009)·clean close·malformed·오리진/티켓/리플레이 거부.
- **페어링 저장 정직성**: 프론트 localStorage bearer는 **assisted macOS 파일럿 임시 방식**이며, 고객-PC
  배포·Projection 전에 non-exportable WebCrypto + proof-of-possession(또는 대안)을 평가한다. production
  페어링 우회는 계속 금지.
- `git diff --check` clean. `docs/esm/live-capture-checklist.md`·`tools/` 무변경. `.bridge/` gitignored.

## 11. Current blockers
- (repository-verifiable) org 횡단 대시보드 집계 API 부재 — 대시보드 재설계(후속 슬라이스) 선행 조건.
- (repository-verifiable) 비-Cafe24 seller-account 생성 API 부재 — 채널 연결 일반화 선행.
- (product-owner) 최종 모바일 내비 구성(5탭 등) 미승인 — 본 슬라이스는 임시 드로어로만.
- (product-owner) 고객 응대 통합 화면 최종 명칭 미정 — 본 슬라이스는 `/inbox`·`/inquiries` 유지.

## 12. Unrelated pre-existing uncommitted changes
- `docs/esm/live-capture-checklist.md` — 본 작업과 무관한 사전 미커밋 변경. **수정 금지.**
- `tools/` — 미추적(Cafe24 콜백 릴레이). 본 작업 범위 밖.
- (직전 세션의) 정본 문서 변경들(product-scope/frontend-spec/connector-roadmap/ADR)은 `3006e44`로 커밋됨.

## 13. Next approved work
- **정본 문서 전략 인코딩(2026-07-08) — 문서 전용, 미커밋.** SellerOps=SME 멀티채널 커머스 운영 에이전트
  재정의, 운영 루프(OBSERVE→…→RESUME), 자율 모드 4종, **기본 리뷰 수집=ACTION_WINDOW**(Projection은 비-기본
  렌더러), 사업자·등록 결정, OperationRun 방향. 갱신: `product-scope-v1.md`(v1.2)·`sellerops_frontend_spec.md`(§18)·
  `multi-channel-connector-roadmap.md`(§5.1·§5.2·§11.5). 신규: `channel-capability-registration-matrix.md`·
  `slices/action-window-v1.md`. **구현 없음.**
- **현재 개발 시퀀스(제품 오너 결정 — 각 단계 별도 승인, 미착수):** 1. 정본 문서 갱신(이 작업) → 2. Action
  Window V1 계약 리뷰 → 3. Action Window 공통 엔진+합성 픽스처 → 4. ESM+ 첫 라이브 Action Window 보정(별도
  승인) → 5. NAVER 셀러 소유 API 가이드 연결(G3) → 6. Coupang 가이드 키 발급(공식 검증된 곳) → 7. 제공자
  등록 문의 병행(사업자등록 후) → 8. Operation Run Engine(실행 모드·체크포인트 안정 후).
- **Local Agent Bridge G1** — 구현·하드닝·검증·**커밋 완료**(`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`).
  남은 한계(정직 표기): 실행-중 이벤트(browser_lifecycle·collection_progress/result 등)는 **예약**이며
  실제 방출은 G2/라이브 수집의 신뢰 seam이 생겨야 `supportedEvents`로 승격(현재는 날조하지 않고 미노출);
  Windows/클라우드는 이식 경로만 문서화; 페어링 토큰 localStorage 저장은 파일럿 임시 방식(고객-PC 전
  WebCrypto+PoP 평가 — G2 진입 시점 평가 대상).
- **Browser Projection V0(§17-B G2) = 커밋 완료**(`a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`, 25파일
  +4024/−24). 채널-중립·로컬 픽스처 전용, E2E QA(입력→렌더 p95 130ms·리사이즈 좌표 0px·리보크 중단)·
  10분 소크(−38.8 MB/min) 통과. **마켓 사용 미승인**(§20 게이트). 튜닝 TODO: 시간기반 프레임 캡으로 밀집
  페이지 ≥8fps.
- **현재 문서 작업 = NAVER Guided Connection(G3) 실행 계약 초안**(`docs/slices/naver-guided-connection.md`,
  DRAFT). 문서 전용, **구현 미착수.** 셀러 소유 앱 발급(type=SELF)+첫 수집 가이드; 기존 백엔드 경계
  (`credentials`/`test-connection`/`sync`)·G1/G2 위 합성; 자동 로그인·Secret 추출·클립보드·2FA 처리 제외.
  **제품 오너 리뷰·구현(G3-A) 착수 승인 대기.** **마켓 라이브-사용 게이트 유지(닫힘)** — G3-C 라이브 정찰은
  별도 승인+정책 해명 선결.
- Product Shell은 `3006e44`로 커밋 완료됨.

## 14. Must NOT be started yet
- **Action Window 구현(AW-2 이후) 및 실제 마켓 Action Window/Projected Direct Action 사용** — 계약 리뷰
  전 구현 금지; 실제 마켓 사용은 정책 해명 + 제품 오너 승인 게이트 뒤(`slices/action-window-v1.md` §17).
- **OperationRun 도메인 구현** — 방향 기록만(product-scope §1.7); 실행 모드·체크포인트 안정 전 착수 금지.
- NAVER Guided Connection(G3), Automatic Relogin(G4), Tutorial(G5), Windows Migration(G6) (Frontend Spec §17-B).
- **Browser Projection V0의 실제 마켓 대상 사용**(§20 게이트: 마켓 약관 허용성 해명 + 고객-PC 보안 리뷰
  선결); V0 코드 자체는 채널-중립 구현·**커밋 완료**(`a0e4f6f`), 단 **production-runtime 미배선(State B, §9·§22.8)**.
- **Browser Projection의 정상-부팅 배선**(`resolveAgentBridgeConfig`에 프로젝션 소스 주입) — 별도 배선 작업, 미착수.
- 대시보드 재설계, 가입/온보딩, inbox/inquiry 통합, 리포트 구현, 자동 로그인, 시각 리브랜딩, 신규 백엔드
  능력, 채널 카탈로그 정책 변경. (프론트↔에이전트 통신 G1·프로젝션 V0 **구현·커밋 완료** — 이 목록에서 제외;
  단 프로젝션 정상-부팅 배선은 별도 미착수 작업, State B §9.)

## 15. Product Shell 검증 결과 (2026-07-07)
- `npm run typecheck` — 통과(오류 0).
- `npm test` — 144 테스트 통과(카피 가드 스캔 확장 포함; 착수 전 87 → 144).
- `npm run build` — 통과(142 모듈, dist 생성).
- `git diff --check` — whitespace 오류 없음.
- dev 서버(mock 모드) 부팅 확인, `/`·`/settings/channels`·미지의 경로 모두 SPA 200 응답. 번들에
  `/settings/*` 경로·404 문구·모바일 메뉴·그룹 헤더 컴파일 확인, `/search` 라우트·"AI 검색" 라벨 제거 확인.
- **브라우저 시각 QA — 완료(2026-07-07)**: 로컬 mock 모드 앱을 Playwright(collector 번들 chromium)로
  구동해 데스크톱 1440px·모바일 390px 검사. 결과: 데스크톱 12라우트 정상 렌더(가로 오버플로우 0,
  개발자 문구 0), 구경로 4종 리다이렉트+쿼리/파라미터 보존, `/search`·unknown → 404 렌더(조용한
  리다이렉트 없음), "AI 검색" 내비 제거, 사이드바 2그룹(운영/연결·설정)·중첩 채널상세에서 "채널 연결"
  활성·알림 배지 "2" 확인. 모바일: 메뉴 버튼·드로어 열림/닫힘(링크·ESC·백드롭)·열림 시 드로어 포커스·
  닫힘 시 버튼 포커스 복원·헤더 미겹침·긴 조직명 오버플로우 없음 모두 통과. 오류 상태(strict 읽기
  실패 주입): 셀러 복구 문구 표시·"백엔드" 없음·시드 데이터 미강등(fail-closed) 확인.
  **결함 0건 — 제품 오너 커밋 승인 준비 완료.**
