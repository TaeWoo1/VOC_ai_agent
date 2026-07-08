# Slice Contract — Browser Projection V0 (Guided-Connection 인프라 G2)

> Status: **IMPLEMENTED & COMMITTED (채널-중립 V0, `a0e4f6f`), 마켓 미승인·비-기본 렌더러, production-runtime
> 미배선(State B, §22.8).** §0·§20의 제품 오너 결정과 §19 스파이크 증거에 근거해 **채널-중립 V0 구현이
> 승인·커밋**됐다(로컬 픽스처 전용). **정상 Local Agent 제품 부팅은 프로젝션 소스를 생성·주입하지 않는다**
> (구현 seam만) — "코드 존재"와 "정상 부팅 지원"을 혼동하지 않는다(§22.8).
> **구현 승인 ≠ 마켓 사용 승인**: 실제 마켓(NAVER 등) 대상 사용은 **미승인**이며 §20 릴리스 게이트의
> 선결을 요구한다. 실제 마켓 접속·테스트, NAVER Guided Connection, 자동 로그인, 자동 클릭, 코치마크는
> **이 슬라이스에 없다**.
>
> **기본 모드 관계(2026-07-08 제품 결정).** **라이브 마켓 리뷰 수집의 기본 production 모드는 Browser
> Projection이 아니라 Action Window**(실제 창 직접 행동 + 오버레이 — `docs/product-scope-v1.md` §1.5,
> `docs/slices/action-window-v1.md`)다. Browser Projection V0은 **제거·폐기되지 않으며** 채널-중립 로컬
> 뷰/입력 인프라로 유지되나 **비-기본 렌더러**다. "Projected Direct Action"(투사 화면 위 직접 행동)은
> **채널별 정책·제품 리뷰 후 이후에 활성화될 수 있다.** **같은 가이드 상태 엔진이 두 렌더러(Action Window·
> Projection)를 지탱**한다(마켓 로직 중복 금지, §17).
>
> 상위 계약: 제품 원칙 `docs/product-scope-v1.md` §1.2·§6.1, 프론트 화면·보안 `docs/sellerops_frontend_spec.md`
> §16.8·§16.9·§17-B G2, 런타임 경계 `docs/sellerops_local_agent_runtime_adr.md`(Runtime ADR)
> §3.1·§3.4·§6, 브리지 계약 `docs/slices/local-agent-bridge.md`(G1). 본 문서는 그들이 참조하는
> **프로젝션(프레임·입력·제어) 계약**을 소유하며 그들의 결정을 중복 선언하지 않는다.
>
> **정직성 경계.** 실제 Chrome 뷰 투사·입력 릴레이는 이 G2 슬라이스로 **처음 구축**된다. 저장소에
> `Page.startScreencast`·`Input.dispatch*`·뷰포트 설정·프론트 캔버스/비디오 렌더링은 **현재 전부 부재**(§2).
> 마켓 자동화·자동 로그인·좌표/URL 오버레이·프레임 저장은 이 슬라이스 범위 밖이며(§4) 여전히 미구현이다.

베이스라인:
- Product Shell 커밋 `3006e447b91de72f5e3627da75f390c74d92bfac` (커밋됨).
- Local Agent Bridge G1 커밋 `c253dcacc979a0c779d9423a6df7dc80cd2ea9be` (커밋됨).

이 슬라이스는 Product Shell(§17-A)과 분리된 가이드 연결 인프라 트랙(§17-B)이며, G1에 **의존**하고
G3(NAVER Guided Connection) 이전에 온다.

---

## 0. 승인된 결정 (Approved decisions, 2026-07-08)

제품 오너 리뷰 결과. 아래가 이후 절(§5·§7·§8·§10·§11·§13·§16·§18)의 "[PO-DECISION]/[SECURITY-DECISION]"
표기 중 해당 항목을 **대체**한다. 승인 범위는 **기술 스파이크**이며 production 구현 승인이 아니다.

### 0.1 플랫폼·세션·타깃 범위
- **V0는 데스크톱 전용.** 모바일 브라우저에서는 "프로젝션은 로컬 에이전트가 실행 중인 컴퓨터에서
  사용해야 한다"는 안내만 표시한다(관람/제어 미제공).
- **한 로컬 에이전트당 활성 프로젝션 세션은 최대 1개**(V0).
- **한 프로젝션은 한 번에 활성 CDP 페이지 타깃 1개**를 표시한다.

### 0.2 관람·제어권 (§7 대체)
- 다수 SellerOps 탭이 프로젝션을 **관람**할 수 있다.
- **정확히 한 탭만 입력 제어권**을 가진다. 제어 획득은 **명시적 사용자 행동**을 요구한다.
- **제어 리스는 수락된 입력 없이 2분 후 만료**한다. **수락된 입력이 리스를 갱신**한다.
- 끊김·프론트 종료·페어링 리보크·에이전트 재시작·타깃 종료·프로젝션 중지는 **즉시 제어를 회수**한다.
- **재접속은 뷰만 복원하며 제어를 자동 복원하지 않는다.**
- **V0에서 활성 제어는 다른 탭이 강제 탈취할 수 없다.** 다른 탭은 **해제·끊김·리스 만료 이후에만** 제어를
  얻을 수 있다. (→ §7의 "가시적 확인 후 탈취"는 V0에서 **비탈취**로 확정: 강제 탈취 경로 자체가 없다.)

### 0.3 입력 경계 (§8 대체)
- **제외**: 보조(우) 클릭, 가운데 클릭, 드래그앤드롭, 클립보드, 파일 업로드, 브라우저 네비게이션 버튼,
  DevTools 단축키, OS 단축키. (→ §8.1의 "보조 클릭 [PO-DECISION]"은 **제외**로 확정.)
- **팝업/새 타깃 전환은 명시적 사용자 행동**을 요구한다.
- 허용(계승): 포인터 이동, 주 클릭, 휠/스크롤, 기본 키 다운/업, 검토된 텍스트 삽입.

### 0.4 프라이버시·노출 경계 (§8.3·§9·§11 대체)
- **raw URL·DOM 텍스트·셀렉터·마켓 식별자·계정 실명·스토어명을 노출하지 않는다.**
- **V0에서 자동 민감-필드 마스킹을 시도하지 않는다.**
- **프레임·입력은 loopback 전용·비영속·비로깅**이며 **SellerOps 백엔드를 경유하지 않는다.**
- **영속 로컬-전용 인디케이터**와 **구분되는 제어-소유자 인디케이터**가 **필수**다(시각 스타일은 UX 세부).

### 0.5 프로젝션 인가 (§10 대체)
- **장기 페어링 토큰은 디바이스 신뢰만** 수립한다.
- **프로젝션은 별도의 단명 프로젝션 세션**을 요구한다.
- **입력 제어는 별도의 단명 제어 리스**를 요구한다.
- **WebCrypto proof-of-possession은 assisted macOS V0의 블로커가 아니다**(파일럿 허용). 단 **고객-PC 배포
  전에는 반드시 검토**한다.

### 0.6 잠정 Mac-파일럿 스파이크 목표치 (§16 게이트 — 기대치이며 하드 합격선 아님)
- 대표 뷰포트: **1280×720**.
- 평균 사용 가능 프레임레이트: **최소 8 fps**.
- 입력→가시 응답: **p95 500 ms 이하**.
- 기본 포인터/키보드 입력 **손실 없음**.
- 미-ack/최신 큐 프레임: **최대 1~2개**.
- 10분 실행 동안 **지속적 메모리 증가 없음**.
- 증분 에이전트/프로젝션 CPU: **25% 이하**.
- 리사이즈 후 **좌표 매핑 정확**.

> 이 목표치는 **스파이크 판정용 기대치**이며, 수치 자체를 production 수용 기준으로 고정하지 않는다
> (기대 결과 ≠ 합격 게이트 — 측정 후 §18에서 production 목표를 별도 확정).

### 0.7 채널-중립 V0 구현 승인 (2026-07-08)
스파이크(§19) 통과에 따라 **채널-중립 V0 구현이 승인**됐다. 확정 아키텍처:
- **실제 Chrome Stable + 전용 프로필 + CDP 런타임**을 그대로 사용(임베디드 Chromium·Electron 비채택).
- **`Page.startScreencast`**, **JPEG q50 · ~10fps 시작**, 바운디드 CPU·큐가 유효할 때만 **최대 15fps까지** 튜닝.
- **프로젝션 전용 바이너리 WebSocket 전송**. **G1 상태 채널의 JSON·텍스트·64KiB 경계는 변경·상향 금지.**
- **미소비/최신 프레임 최대 2개**, 초과 시 **오래된 프레임 드롭**(무한 큐 금지).
- **페어링=디바이스 신뢰만**, **프로젝션=별도 단명 세션**, **입력=별도 단명 제어 리스**.
- **WebCrypto proof-of-possession은 assisted macOS V0의 블로커가 아니다.** **RFC 9449 DPoP는 이 슬라이스에
  구현하지 않는다.** 고객-PC 배포 전 **별도 보안 리뷰**가 key-bound PoP·CSP/XSS 방어·per-agent 백엔드
  토큰을 평가한다(§20).
- 로컬 픽스처 전용, 실제 마켓 미테스트. **구현 승인과 마켓-사용 승인은 분리**(§20).

---

## 1. 목적 (Purpose)

**이 슬라이스가 가능케 하는 것**: SellerOps 웹 프론트엔드가, 같은 PC에서 로컬 에이전트가 **이미 소유·실행
중인 실제 Chrome 페이지**를 SellerOps UI 안에서 **로컬로 투사(projected view)해 보고**, 사용자가 **명시적으로
허용한 입력**(포인터·스크롤·기본 키 입력)을 그 실제 Chrome 페이지로 **로컬 릴레이**하는 최소 채널. 구체적으로:

- 이미 에이전트가 소유한 Chrome 페이지에 대해 **프로젝션 세션을 시작·중지**하고,
- CDP를 통해 **실시간 시각 프레임**을 받아 SellerOps 안에 **현재 투사 페이지를 렌더**하고,
- 프레임을 **ack하며 backpressure**를 적용하고,
- **한 번에 한 탭만 제어권(control owner)**을 갖고 나머지 탭은 (안전히 지원되는 범위에서) **읽기 전용 관람**,
- 프론트 새로고침 후 **재접속(뷰 복원, 제어권 자동 부여 없음)**,
- 페어링·세션·제어권이 유실되면 **입력을 즉시 중단**하고,
- **프로젝션 능력 협상**으로 view/control 지원을 구분해 알린다.

**이 슬라이스가 명확히 아닌 것**(오해 차단):
- **iframe 임베딩 아님** — 마켓 페이지를 `<iframe>`에 넣지 않는다(교차-오리진·봇탐지·CSP 위반).
- **Electron 임베디드 Chromium 아님** — Runtime ADR §6 옵션 B는 **기각**(`webdriver=false`·실제
  Keychain·봇탐지 자세 위협). V0는 기존 실제 Chrome Stable + 전용 프로필 + CDP 자세를 **그대로 보존**한다.
- **원격/클라우드 브라우징 아님** — 프레임·입력은 사용자 PC 로컬(loopback)에만 머문다(§9).
- **마켓 자동화 아님** — 자동 이동·클릭·로그인·계정 선택 없음(§4).
- **녹화 아님** — 프레임 시퀀스를 파일/DB/로그에 저장하지 않는다(§9).
- **스크린샷 저장 아님** — 오류 리포트에도 프레임을 넣지 않는다(§9).

**왜 지금**: Frontend Spec §17-B는 G2를 "실제 Chrome 뷰를 SellerOps에 투사, 마우스/키보드 릴레이,
§16.9 영속 로그 금지, 연결·복구 동작"으로 정의하고 의존성을 **G1 + [PO-DECISION] sanitized 좌표/URL 예외**로
못박았다. Runtime ADR §3.1은 이미 "CDP 세션 보유 → 스크린캐스트/입력 주입의 자연스러운 부착점"이라 적었고
§6은 옵션 C(실제 Chrome CDP 프로젝션)를 **채택 방향**으로 명시했다. G1이 페어링·관측 토대를 세웠으므로,
G2는 그 위에 저지연 프레임/입력 채널을 얹어 **G3 NAVER Guided Connection**(단계 안내·인앱 발급 화면)의
시각 토대를 만든다. G2 없이도 파일럿은 "별도 창 + 단계 패널"로 성립하지만(§16.11), 인앱 튜토리얼의
최종 목표는 프로젝션이다(ADR §6 옵션 C).

---

## 2. 현행 증거 (Current-state evidence)

> 파일 경로·라인은 저장소 확인(2026-07-08 CDP 런타임 정찰). 재사용 가능 / 부재한 seam / 아키텍처 격차로 분류.

### 2.1 재사용 가능한 코드 (있음)
- **실제 Chrome + CDP 소유자 (프로젝션 부착점)**: `collector/src/agent/progressive-reconnect-chrome.ts`.
  `ProgressiveReconnectChromeBrowser`(`:128`)가 **실제 Chrome 바이너리를 `spawn`**(`ensureLaunched` `:150-175`,
  `--remote-debugging-port`·`--user-data-dir`·`--remote-allow-origins=*` `:154-160`)하고 `connectOverCDP`
  로 부착(`:168`)한다. 이 인스턴스가 프로세스·`browser`/`ctx`/`page`·**`client: CDPSession`(`:133`)**을
  **소유**(docstring `:120-127`)하며, `client = ctx.newCDPSession(this.page)`(`:173`)로 CDP 세션을 이미
  생성한다. **저장소에서 CDP 세션을 잡는 유일한 모듈**(§2.2). 봇탐지 자세 가드: 비헤드리스 Chrome
  Stable 검증(`:164-166`), `navigator.webdriver===false`(`:171-172`), `--enable-automation`·헤드리스 금지
  (`:32`,`:98-102`). idempotent `close()`(`:242-247`). → **screencast/Input 도메인의 자연 부착점.**
- **브라우저 실행 정책 (전용 프로필)**: `collector/src/agent/local-agent-launch.ts`(`buildLocalAgentLaunchPolicy`
  `:72-95`: 항상 `channel:"chrome"`, `assertDedicatedProfileDir` `:55-64`, macOS `--use-mock-keychain` drop),
  `collector/src/profile.ts`(`launchPersistentContext` `:111-119`, 프로필 경로 가드 `resolveProfileDir` `:55-62`).
  V0는 이 실행 자세를 **변경하지 않는다**(프로젝션은 이미 뜬 페이지에 붙는다).
- **커넥터 오케스트레이션·관측 seam (G1 재사용)**: `collector/src/connector/connector-orchestrator.ts`
  `ConnectorOrchestratorObserver.onConnectionSettled`(`:63-65`, settle-전용). G1 이벤트 어댑터
  `collector/src/bridge/event-adapter.ts`가 이를 감싼다(`settleObserverToPort` `:127-144`).
- **G1 브리지 전송·페어링·능력 협상**: `collector/src/bridge/*`. loopback HTTP + `ws` WebSocketServer,
  오리진 허용, 단명·1회용 티켓, `supportedEvents` 협상(§8·§10에서 재사용/확장).
- **프론트 브리지 클라이언트·hook·docking**: `frontend/src/lib/bridge/{bridgeClient,bridgeProtocol}.ts`,
  `frontend/src/hooks/useBridge.ts`, `frontend/src/components/bridge/BridgeStatus.tsx`, `AppShell.tsx`
  (`VITE_ENABLE_AGENT_BRIDGE` 게이트 도크 `:33-37`). 프로젝션 뷰가 매달릴 표면.
- **sanitized 로깅·opaque id 계약**: `collector/src/log.ts safeMeta`(금지 키 드롭), G1 `refFor(connectionId, salt)`
  (16-hex opaque). §9 프라이버시 강제의 기존 표준.

### 2.2 부재한 seam (없음 — 이 슬라이스가 세움)
- **스크린캐스트 전무 (확인됨)**: `screencast`·`Page.startScreencast`·`Page.screencastFrame`·
  `Page.screencastFrameAck`가 `collector/src`·`frontend/src` 전체에서 **0건**. 프레임 획득 로직 부재.
- **합성 입력 전무 (확인됨)**: `Input.dispatchMouseEvent`·`Input.dispatchKeyEvent`·`Input.insertText`가
  **0건**. 현행 입력은 전부 Playwright 고수준 `page.click(...)`(감독형 단일 클릭). 좌표 기반 입력 부재.
- **뷰포트/디바이스 스케일/윈도우 크기 설정 전무 (확인됨)**: `setViewportSize`·`viewport:`·
  `deviceScaleFactor`·`Emulation.setDeviceMetricsOverride`·`--window-size`가 **0건**. 좌표 변환/리사이즈
  기준이 없다 → V0가 뷰포트 메타데이터·좌표 매핑을 **처음 정의**.
- **탭/팝업/프레임 수명 이벤트 seam 미약 (확인됨)**: `context.on("page")`는 **가드/부작용 sink로만**
  사용(`naver/review-usage-confirm.ts:543`, `naver/export-click-diagnose.ts:188`). `page.on("popup")`·
  `targetcreated`/`targetdestroyed`/`framenavigated`·`bringToFront` **없음**. 첫 페이지는
  `ctx.pages()[0] ?? newPage()` 패턴. → 타깃/페이지 수명(§11)은 새 리스너가 필요.
- **프론트 렌더링 프리미티브 전무 (확인됨)**: `<canvas>`·`<video>`·`<img>`·`createImageBitmap`·
  `getContext(`·`requestAnimationFrame`이 `frontend/src` 전체에서 **0건**. 프로젝션 뷰는 **그린필드 UI**.
- **바이너리/대용량 전송 경로 부재 (확인됨)**: G1 WS는 **JSON 텍스트 전용, 바이너리 거부**(§2.3). 프레임
  전송 채널이 없다.
- **실행-중 이벤트 seam 부재 (G1에서 예약)**: G1 `browser_lifecycle`은 **예약(미배선)**이며 `browserOpen`은
  settle 시점 하드코드 `false`(`event-adapter.ts:68-69`, `protocol.ts:114` "reserved for G2"). 즉 브라우저
  열림/닫힘·프로젝션 진행의 **신뢰 seam을 세우는 것이 바로 G2의 일**이다.

### 2.3 아키텍처 격차 (결정 필요)
- **G1 전송 크기 한계 vs 프레임 (확인됨)**: `collector/src/bridge/bridge-server.ts` —
  `new WebSocketServer({ noServer:true, maxPayload: 64*1024, perMessageDeflate:false })`(`:76`,`:38`),
  **바이너리 페이로드 거부**(`ws.on("message", (data,isBinary)=>{ if(isBinary) ws.close(1003,...) })` `:334-339`),
  HTTP 바디 16KiB 캡(`:36`,`:447-462`), 클라이언트 메시지 = `request_snapshot`|`ping`뿐(`protocol.ts:130-132`).
  → **스크린캐스트 프레임(수십~수백 KB)은 64KiB 텍스트·바이너리-거부 채널에 실을 수 없다.** 상태-이벤트
  한계를 **그냥 올리지 않고**, **프로젝션 전용 전송 경계**를 분리해야 한다(§6).
- **settle-전용 관측 seam vs 실시간 (확인됨)**: `onConnectionSettled`는 settle 후 1회만 발화(§2.1). 프로젝션
  세션/프레임/제어권은 **실행-중 스트리밍**이 필요하다 → 기존 settle seam과 **분리된** 프로젝션 이벤트
  경로가 필요(§6·§11). 커넥터 내부에 전송을 삽입하지 않고 어댑터로 감싼다(G1 규율 계승).
- **CDP 세션 공유/충돌 (repository-verifiable, 미확정)**: 현행 유일 CDP 세션은 스크립트-주입 용도로
  `Page.enable`을 이미 켠다(`progressive-reconnect-chrome.ts:174`). screencast를 **같은 세션에 붙일지
  별도 세션을 열지**, 스크립트-주입 수명과의 상호작용은 스파이크(§16)로 확정.
- **다중 커머스 연결 vs 단일 소유자 (확인됨)**: G1은 다수 채널 연결을 지원하나 각 연결의 브라우저 소유는
  per-connection 런타임(`local-agent-progressive-service.ts`). "어느 연결의 어느 페이지를 투사하는가"의
  타깃팅 규약이 없다 → V0가 정의(§11).

### 2.4 문서 정합성 (report, not silently fix)
- Frontend Spec §17-B G2 의존성이 `[PO-DECISION] sanitized 좌표/URL 예외`를 명시하고, Runtime ADR §3.4·
  §7(3)·Frontend Spec §16.9가 "좌표/URL을 프론트로 넘기는 예외는 **로컬 신뢰 채널 예외**, 명시적 정책
  결정 후"라고 반복한다. 본 계약은 이 예외를 **열지 않고**(§8.3), 좌표 매핑을 **에이전트-측 로컬 변환**
  으로 두는 것을 기본으로 제안한다(§8·§18). 최종 좌표/URL 노출 여부는 PO 결정(§18)으로 남긴다.

---

## 3. 범위 (Scope)

이 슬라이스에 **포함**되는 것만:

- **이미 에이전트가 소유한 Chrome 페이지**에 대한 프로젝션 세션 **시작·중지**(브라우저 실행은 아님 — §4).
- CDP를 통한 **실시간 시각 프레임 수신**.
- SellerOps 안에서 **현재 투사 페이지 렌더**.
- 프레임 **ack + backpressure**(오래된 프레임 드롭, 무한 큐 금지).
- **승인된 포인터·스크롤·기본 키 입력 릴레이**(§8 경계).
- **리사이즈·좌표 변환**(뷰포트 메타데이터 기반).
- **한 번에 한 제어권 소유자**(control owner).
- **다수 읽기 전용 관람 탭**(안전히 지원되는 범위에서).
- 프론트 **새로고침 후 재접속(뷰 복원, 제어권 자동 부여 없음)**.
- 페어링·세션·제어권 유실 시 **입력 즉시 중단**.
- **프로젝션 능력 협상**(view/control 지원 구분).
- **비영속 프라이버시 보장**(프레임·입력 무저장·무로깅·무백엔드 릴레이).
- **로컬 전용 테스트·QA 픽스처**(마켓 접속 없이).

---

## 4. 명시적 제외 (Explicit exclusions)

이 슬라이스에서 **하지 않는다**:

- 프론트에서의 **브라우저 실행/기동 명령**(브라우저 수명은 로컬 에이전트 소유 — §2.1).
- **마켓 워크플로 start/stop**(수집·동기화 트리거).
- **가이드 NAVER 단계 정의**(→ G3).
- **코치마크·타깃 하이라이트**(→ G5; 좌표/URL 오버레이 예외를 여기서 열지 않음).
- **자동 이동/클릭**(감독형·자동 무관하게 프로젝션이 스스로 클릭하지 않음).
- **자격증명 입력·자동 로그인**(영구 제외 — 에이전트는 자격증명을 입력하지 않음, ADR §4 불변식).
- **클립보드 읽기/쓰기.**
- **파일 경로·업로드·드래그앤드롭.**
- **브라우저/OS 단축키**(예: Cmd+T/Cmd+W/DevTools 토글).
- **오디오·비디오 스트리밍**(시각 프레임만).
- **프레임 녹화·스크린샷 저장**(오류 리포트 포함).
- **클라우드 릴레이**(모든 트래픽 loopback).
- **Windows 패키징**(→ G6).
- **다중 SellerOps 워크스페이스**(G1 초기 범위 계승 — 1 워크스페이스).
- **이미지/URL·DOM 텍스트·계정 실식별자의 프론트 노출**(§8.3 금지 — §2.4 예외는 미개방).

---

## 5. CDP 프로젝션 옵션 (CDP projection options)

> **비-CDP 접근을 증거 없이 선택하지 않는다.** 아래는 비교이며, 권장은 "스파이크로 검증할 제안"으로 명시.

현행 자세는 실제 Chrome Stable + 전용 프로필 + CDP 세션 보유(§2.1). 후보:

| 옵션 | 설명 | 현행 CDP 자세 정합 |
|---|---|---|
| **A. `Page.startScreencast`** | CDP가 페이지 뷰를 JPEG/PNG 프레임으로 스트림, `Page.screencastFrame` 수신 후 `Page.screencastFrameAck`로 흐름 제어 | **정합(채택 제안 방향)** — 이미 `CDPSession` 보유(§2.1), ADR §3.1 "스크린캐스트 부착점"·§6 옵션 C 채택 방향과 일치 |
| **B. 저장소 지원 대안** | Playwright `page.screenshot` 반복 폴링 등 | **부분** — CDP지만 ack/backpressure 내장 없음, 프레임레이트·CPU 비효율, 스크린캐스트의 델타 최적화 없음 |
| **C. OS 화면/윈도우 캡처** | OS API로 Chrome 창 캡처 | **비정합(폴백 후보로만)** — OS별 재구현, 권한 프롬프트, 창 가림/포커스 취약, 페이지-타깃팅 불가 → **가정하지 않음** |

비교 축(스파이크 §16으로 측정):

| 축 | A. startScreencast | B. screenshot 폴링 | C. OS 캡처 |
|---|---|---|---|
| 현행 실제 Chrome 정합 | 높음(기존 CDP 세션) | 중 | 낮음(외부) |
| 페이지/탭 타깃팅 | CDP 타깃 단위 | 페이지 단위 | 불가(창 단위) |
| 팝업 처리 | 새 타깃에 재부착 가능 | 수동 | 불가 |
| 지연 | 낮음(푸시+ack) | 높음(폴링 왕복) | 중 |
| 프레임 품질 | JPEG 품질·스케일 파라미터 | 스크린샷 옵션 | OS 의존 |
| 리사이즈 | `maxWidth/maxHeight`+metadata | 수동 | 창 의존 |
| CPU/메모리 | 중(인코딩) | 높음(반복 풀샷) | 중 |
| backpressure | **ack 기반 내장** | 없음(직접 구현) | 없음 |
| 보안 | loopback+CDP 로컬 | 동일 | OS 권한 표면 확대 |
| macOS→Windows 이식 | Chrome/CDP 동일 | 동일 | **OS별 재구현** |
| 테스트 용이성 | 로컬 HTML 픽스처로 CDP 구동 | 동일 | 어려움 |

**제안(스파이크로 검증): 옵션 A `Page.startScreencast`.** 근거 = 기존 CDP 세션 재사용(§2.1), ADR 채택
방향(§6 옵션 C), ack 기반 backpressure 내장(§6), 페이지-타깃 단위(§11). **옵션 C(OS 캡처)는 폴백
후보로만** 기록하며 가정하지 않는다. 최종 채택은 §16 스파이크 결과 + PO 승인 후.

---

## 6. 전송·프레임 프로토콜 (Transport & frame protocol)

> 임의의 구현 세부를 확정하지 않는다. 의미 메시지와 원칙만 정의한다.

### 6.1 제안 의미 메시지 (semantic messages)
방향·페이로드 형식은 §16 스파이크·구현 슬라이스에서 확정. 최소 다음을 고려:
- **projection_session_requested** — 프론트→에이전트, 특정 연결의 현재 페이지 투사 요청.
- **projection_session_started** — 에이전트→프론트, 세션 수립(세션 id·초기 뷰포트 메타).
- **frame** — 에이전트→프론트, 시각 프레임(+seq·타이밍). **바이너리 vs base64 텍스트는 §6.3 결정.**
- **frame_ack** — 프론트→에이전트, 특정 seq까지 수신 확인(흐름 제어).
- **viewport_metadata** — 논리 크기·디바이스 스케일·offset(좌표 변환용, §8).
- **target_changed** — 투사 대상 페이지/타깃 변경(navigation·popup·replacement — §11). **URL 없이** opaque
  target ref + coarse 상태만.
- **control_granted / control_lost** — 제어권 리스 부여/회수(§7).
- **input_accepted / input_rejected** — 입력 릴레이 수락/거부(사유 코드; 금지 입력·비제어·비가시 등 — §8).
- **projection_paused / projection_stopped** — 일시정지/종료.
- **recoverable_error** — 회복 가능 오류(재시도 안내; CDP 일시 단절 등).
- **terminal_error** — 종료 오류(타깃/브라우저 소멸 등, 사람 개입).
- **capability** — view/control 지원, 최대 프레임 크기·프레임레이트 상한 협상.

### 6.2 backpressure·비영속 원칙
- **최대 프레임 크기**: 프로젝션 전용 상한(§16 측정 후 확정). **G1의 64KiB 상태-이벤트 한계를 그냥
  올리지 않는다** — 아래 6.3 참조.
- **큐/backpressure 원칙**: 미-ack 프레임 수/바이트에 **상한**을 두고, 상한 초과 시 **가장 오래된
  프레임을 드롭**(drop-old)한다. 프레임 큐는 **무한 성장 금지**(수용 기준 §14).
- **drop-old-frame**: 느린 클라이언트에는 최신 프레임만 유지 — 밀린 프레임을 모두 전송하지 않는다.
- **무영속**: 프레임·입력을 파일·DB·상태 파일에 **저장하지 않는다**(§9).
- **무로깅**: 프레임 바이트·입력 좌표/키를 로그에 남기지 않는다(sanitized 로깅 계승 — 프레임/입력은
  §8.3 **금지** 분류).
- **무백엔드·무클라우드 릴레이**: 프레임·입력은 SellerOps 백엔드를 **경유하지 않고** loopback에만 머문다
  (수용 기준 §14, §16.9).

### 6.3 바이너리 vs 인코딩 전송 (evaluation)
- **평가 필요**: (i) 프로젝션 전용 **바이너리 WS 프레임**(G1의 텍스트-전용·바이너리-거부와 **분리된
  경로**로) vs (ii) base64 텍스트. base64는 ~33% 팽창·인코딩 비용 → 프레임 트래픽엔 불리.
- **G1 경계와의 분리 (필수)**: G1 상태-이벤트 채널은 **JSON 텍스트·바이너리 거부·64KiB**를 유지한다.
  프로젝션 프레임은 **별도의 프로젝션 전송 경계**(별도 엔드포인트/서브프로토콜/세션, 자체 크기·바이너리
  정책)로 다룬다. **"기존 상태-이벤트 한계를 올려서 프레임을 통과시키는" 방식 금지**(§2.3, PO 지시).
- 바이너리 채택 시 G1 서버의 `isBinary→close(1003)` 정책은 **상태 채널에만** 유지하고, 프로젝션 채널은
  자체 바이너리 수용 정책을 갖는다. 구체 결정은 §16 스파이크(프레임 크기·프레임레이트 실측) 후.

---

## 7. 제어권 소유 (Control ownership)

V0 모델:
- 같은 PC의 **여러 SellerOps 탭이 관람(view-only)** 할 수 있다(안전히 지원되는 범위 — §16 검증).
- **정확히 한 탭만 입력 제어권**을 가진다.
- 제어권 획득은 **명시적 사용자 행동**(예: "제어하기" 클릭)을 요구한다.
- 제어권은 **단명 리스(lease)**로 표현된다.
- 리스는 다음에 **만료**한다: 연결 끊김, 비활성(idle), **페어링 리보크**, **에이전트 재시작**, 프로젝션 중지.
- **다른 탭이 조용히 제어권을 탈취할 수 없다.**
- **탈취(takeover)는 가시적 사용자 확인**을 요구한다(기존 제어 탭에 표면화).

- **정확한 리스 지속시간·비활성 임계·탈취 확인 동작**은 **[PO-DECISION]/[SECURITY-DECISION]**(§18) —
  저장소 증거로 뒷받침되지 않는다. G1 티켓 TTL(10s)은 WS 핸드셰이크용이며 제어 리스와 **별개**다.
- 리스는 §10의 프로젝션 세션과 **분리된 재료**다(세션=뷰, 리스=입력 권한).

---

## 8. 입력 경계 (Input boundary)

### 8.1 V0 허용 입력(분류)
- **포인터 이동**(pointermove).
- **주 클릭**(primary click / left button).
- **보조 클릭**(secondary/right click) — **정당화될 때만** [PO-DECISION](§18; 컨텍스트 메뉴는 OS/브라우저
  메뉴를 띄워 프로젝션 밖 상호작용을 유발할 수 있음 → 기본 **보류**, 필요 근거 제시 후 승인).
- **휠/스크롤.**
- **기본 키 다운/업.**
- **텍스트 입력** — 검토된 CDP 입력 의미(예: `Input.insertText`)를 통해서만.

### 8.2 명시적 금지
- **클립보드 접근**(읽기/쓰기).
- **파일 경로·업로드.**
- **드래그앤드롭.**
- **OS 단축키**(Cmd/Ctrl+조합 중 시스템/브라우저 제어에 해당하는 것).
- **개발자도구 단축키.**
- **숨은 백그라운드 입력**(프로젝션 비가시·비제어 상태의 입력).
- **프로젝션이 보이지 않거나 제어권이 없을 때의 모든 입력.**

### 8.3 좌표 매핑·포커스·필드 분류
- **좌표 매핑 검증**: 프론트 렌더 크기 ↔ 실제 페이지 논리 크기 ↔ 디바이스 스케일의 변환이 리사이즈
  후에도 정확해야 한다(수용 기준 §14). 검증은 **에이전트-측 로컬 변환**을 기본으로 제안한다 — 즉 프론트는
  정규화 좌표(0..1 등)나 렌더-공간 좌표를 보내고, **실제 페이지 좌표로의 변환은 에이전트가 로컬에서** 수행.
- **필드 분류(§G1 §8.3 계승)**:
  | 분류 | 예 | V0 처리 |
  |---|---|---|
  | 노출 안전 | 세션/제어 상태 enum, opaque target ref(16-hex), coarse 뷰포트 크기, seq | 그대로 |
  | 변환 필요 | 논리↔렌더 좌표 스케일(파생 메타만) | 파생만, 원본 페이지 좌표계 URL/DOM 금지 |
  | **금지** | **프레임 바이트, 키 입력 원문, raw URL, 셀렉터, DOM 텍스트, 좌표의 영속 기록, 자격증명·쿠키·토큰, 계정 실명** | 어떤 형태로도 저장·로깅 금지 |
- 프레임·입력은 **금지 분류**다(전송은 하되 §9 비영속·비로깅). 좌표/URL을 **프론트로 넘기는** 오버레이
  예외(코치마크)는 **G5·별도 [PO-DECISION]**이며 V0에서 열지 않는다(§2.4·§4).

---

## 9. 민감 화면 정책 (Sensitive-screen policy)

- **프레임은 프로세스/브라우저 메모리에만** 존재한다(파일·DB 영속 없음).
- **프레임·입력을 담은 분석/로그 없음**(sanitized 로깅 계승, 프레임/키는 §8.3 금지).
- **SellerOps 백엔드 릴레이 없음** — 프레임·입력은 loopback에만 머문다.
- **오류 리포트에 스크린샷/프레임 없음.**
- **연결 끊김 시 입력 즉시 중단**(제어 리스 무효 — §7).
- **가시적 로컬-전용·제어-소유자 인디케이터**(사용자가 "이 화면은 로컬에만 있고, 지금 이 탭이 제어 중"임을
  항상 인지 — §12).
- **비밀번호·2FA·CAPTCHA·Client Secret·주문·고객정보 화면**: 이런 화면의 프레임도 위 규칙(비영속·비로깅·
  loopback)을 동일 적용한다. 사용자에게 **로컬-전용 전송 + 명시적 고지**로 신뢰를 확보한다.
- **자동 마스킹은 신뢰 가능하다고 주장하지 않는다.** 페이지 구조·필드를 저장소가 안정적으로 식별하는
  seam이 없으므로(§2.2 DOM 이벤트 부재), V0는 **자동 마스킹에 의존하지 않고** 로컬-전용 전송·비영속·명시적
  고지에 의존한다. 마스킹 실현 가능성은 [EXTERNAL-RESEARCH](§18).

---

## 10. 페어링·프로젝션 인가 (Pairing & projection authorization)

현행 파일럿 페어링 모델(G1) 리뷰: 장기 페어링 토큰(SHA-256 해시 at rest, 프론트 localStorage
`sellerops_bridge_token`, **파일럿 임시 방식**), WS 핸드셰이크는 단명·1회용 티켓(48-hex, 10s TTL).

목표 원칙:
- **장기 페어링 = 디바이스 신뢰만** 수립한다(브라우저 제어 권한이 아니다).
- **프로젝션은 별도의 단명 세션**을 쓴다(뷰 스트림 인가).
- **입력 제어는 별도의 단명 제어 리스**를 쓴다(§7).
- **리보크는 활성 프로젝션·제어 재료를 전부 무효화**한다.
- **장기 비밀을 URL·로그에 담지 않는다**(G1 규율 계승).

V0 요구 평가:
- **(a) 기존 페어링 기반 단명 프로젝션 티켓**: G1 `mintTicket`/`consumeTicket` 패턴을 프로젝션 세션용으로
  확장(별도 스코프·짧은 TTL). **가장 저비용 경로 — 제안 기본값.**
- **(b) non-exportable WebCrypto 키 + proof-of-possession**: 프론트가 소유한 비가져오기 키로 세션·리스
  요청에 서명. bearer 토큰을 브라우저-제어 권한으로 격상하는 위험 완화. G1 §0.6-D가 "고객-PC 배포·
  Projection **전에** 평가"하라고 이미 지목 → **V0 진입 시점의 평가 대상**.
- **(c) 검토된 대안**: [EXTERNAL-RESEARCH](§18).

- **금지**: 기존 bearer 페어링 토큰을 **영구 브라우저-제어 권한으로 조용히 격상하지 않는다**(PO 지시).
  프로젝션·제어는 반드시 **분리된 단명 재료**를 거친다. localStorage bearer는 파일럿 임시 방식이며
  V0가 고객-PC 자세로 나아가면 (b) 평가가 선결(§18).

---

## 11. 타깃·페이지 수명 (Target & page lifecycle)

정의할 동작(§2.2 리스너 신설 필요):
- **초기 페이지 선택**: 어느 연결의 어느 페이지를 투사할지(현행 `ctx.pages()[0]` 패턴 기반, 명시 선택 규약).
- **네비게이션**: 페이지 이동 시 스트림 지속·`target_changed`(URL 없이 opaque ref + coarse 상태).
- **리다이렉트**: 자동 이동을 투사가 유발하지 않되, 페이지가 스스로 이동하면 뷰 갱신.
- **페이지 교체(replacement)**: 문서 교체 시 스트림 재부착.
- **팝업/새 탭**: `page.on("popup")`/타깃 생성 감지, 정책 결정(투사 대상 전환? 관람만? — [PO-DECISION] §18).
- **타깃 종료**: 페이지 닫힘 → `terminal_error`(해당 세션) + 진실된 상태(§12 "브라우저/페이지 닫힘").
- **브라우저 종료**: 에이전트 소유 Chrome 종료 → 세션 종료·제어 리스 무효.
- **예기치 않은 CDP 분리(detach)**: `recoverable_error` 또는 `terminal_error`로 구분, 재부착 시도 경계.
- **다중 커머스 연결**: 연결별 opaque target ref로 구분(§2.3), 동시 투사 허용 범위는 [PO-DECISION](§18).

- **금지**: raw URL·DOM 텍스트·계정 실명·마켓 실식별자를 프론트로 노출하지 않는다(§8.3). 타깃은 **opaque
  ref + coarse 상태**로만 표면화.

---

## 12. UI 상태 (UI states)

시각 스타일 확정 없이, 사용자에게 보이는 상태(셀러 언어):
- **에이전트 미가용** — 로컬 에이전트 미실행/미설치(G1 상태 계승).
- **브리지 미페어링** — 페어링 필요(G1).
- **프로젝션 불가** — 페어링됐으나 투사 가능한 페이지/능력 없음.
- **프로젝션 시작 중** — 세션 수립 중.
- **관람 전용(view only)** — 뷰만, 제어권 없음.
- **제어 가능(control available)** — 제어권을 요청할 수 있음.
- **제어 요청됨(control requested)** — 리스 획득 대기/확인 대기.
- **제어 중(controlling)** — 이 탭이 입력 제어 소유.
- **다른 탭이 제어 중(controlled by another tab)** — 관람만, 탈취는 가시적 확인 필요(§7).
- **일시정지(paused).**
- **끊김(disconnected)** — 재접속 대기, 입력 중단.
- **브라우저/페이지 닫힘** — 타깃 소멸(§11).
- **능력 비호환(incompatible capability)** — view/control 미지원 또는 버전 불일치.
- **프라이버시 고지(privacy notice)** — 로컬-전용·비저장 고지(§9).

- 문구는 셀러 언어(개발자 용어·로드맵 언어 금지 — Product Shell 규율 계승). 상태는 **정직**하게(미구현을
  있는 것처럼 표기 금지).

---

## 13. 반응형 (Responsive behavior)

- **데스크톱 우선**: 프로젝션은 데스크톱 로컬 런타임 전제(§16.8 "가이드 연결은 데스크톱 우선").
- **최소 사용 가능 뷰포트**: 데스크톱 최소 폭(구현 슬라이스에서 확정) 이하에서는 저하 안내.
- **모바일**: **관람 전용 또는 V0 미지원**을 권장한다 — §16.8이 "모바일은 진행 현황·완료 확인 열람만,
  실제 연결 작업은 데스크톱으로 안내"라 명시. **전체 모바일 제어 설계는 필요하다고 가정하지 않는다.**
  최종 모바일 제어 여부는 [PO-DECISION](§18).
- **종횡비 상이**: 렌더 영역과 페이지 종횡비가 다르면 레터박스/맞춤(왜곡 없는 스케일) — 좌표 매핑이
  이 변환을 정확히 반영해야 한다(§8.3, 수용 기준 §14).
- **근거 기반 권장**: 위는 §16.8 증거 기반이며, 별도 승인 없이 모바일 제어를 확정하지 않는다.

---

## 14. 수용 기준 (Acceptance criteria)

정밀·검증 가능하게. 최소:
1. 실제 Chrome 페이지가 **iframe·Electron Chromium 없이** SellerOps 안에 나타난다.
2. 프레임이 **SellerOps 백엔드를 경유하지 않는다**(loopback 전용).
3. **프레임·입력 내용이 영속·로깅되지 않는다**(스캔으로 강제).
4. **backpressure가 무한 메모리 증가를 방지**한다(미-ack 상한 + drop-old).
5. **재접속이 뷰를 복원하되 제어권을 자동 부여하지 않는다.**
6. **한 탭만 제어**할 수 있다.
7. **제어권 유실이 입력을 즉시 차단**한다.
8. **리사이즈 후에도 좌표 매핑이 정확**하다.
9. **미지원 입력이 거부**된다(§8.2, `input_rejected` 사유 코드).
10. **팝업·네비게이션·타깃 종료가 진실된 상태**를 만든다(§11·§12).
11. **페어링 리보크가 프로젝션·제어를 종료**한다.
12. **능력 협상이 view/control 지원을 구분**한다.
13. 검증에 **라이브 마켓 액션이 불필요**하다(로컬 HTML 픽스처로 전부).
14. Browser Projection이 **Guided Connection·자동 로그인을 주장하지 않는다**(정직 표기 — 이는 G3/G4).

---

## 15. 검증 계획 (Validation plan)

- **격리 로컬 HTML 픽스처**: `data:`/로컬 파일/about:blank 페이지를 실제 Chrome+CDP로 구동(마켓 접속 없음).
  → 저장소 첫 CDP-구동 커밋 하니스(§2.4: 현재 CDP는 유닛 테스트 부재).
- **Chrome Stable + CDP 테스트**: screencast 시작/프레임 수신/ack 순서.
- **프레임 시퀀스·ack 테스트**: seq 순서·중복·ack 흐름.
- **느린 클라이언트/backpressure 테스트**: 미-ack 상한·drop-old·메모리 상한.
- **oversize 프레임 테스트**: 프로젝션 상한 초과 처리(§6.2).
- **재접속 테스트**: 끊김→복구→뷰 복원, 제어권 미자동부여(수용 5).
- **다중 탭 제어 경합 테스트**: 한 탭만 제어·탈취 확인(수용 6, §7).
- **제어 리스 만료 테스트**: idle·리보크·에이전트 재시작 시 리스 무효(§7).
- **좌표 매핑 테스트**: 리사이즈·종횡비 상이 후 정확도(수용 8).
- **키보드 allow/deny 테스트**: 허용 입력 통과·금지 입력 거부(수용 9, §8).
- **타깃 네비게이션·팝업 테스트**: `target_changed`/종료 상태 진실성(수용 10, §11).
- **페어링 리보크 테스트**: 프로젝션·제어 종료(수용 11).
- **프라이버시/로그 스캔**: 프레임 바이트·입력·URL·DOM 금지 필드 부재(수용 3, G1 프라이버시 테스트 확장).
- **메모리·CPU 측정**: 대표 뷰포트에서 상한 내(§16과 연동).
- **데스크톱 브라우저 QA**: 실제 에이전트+실제 프론트, 로컬 픽스처 육안(마켓 없음).
- **no-marketplace 픽스처만**: 모든 테스트가 로컬 픽스처로 동작(라이브 NAVER/ESM 불필요).

---

## 16. 기술 스파이크 계획 (Technical spike plan)

구현 **전** 소규모 no-marketplace 스파이크로 측정(스파이크 코드는 저장소에 남기지 않음 — G1 §6.1 선례):
- `Page.startScreencast`가 **현행 실제-Chrome CDP 런타임과 정합**하는지(기존 `CDPSession`·스크립트-주입
  `Page.enable`과 공존 가능 여부 — §2.3).
- **프레임 형식·전형/최대 프레임 크기**(JPEG 품질·스케일별) — §6.2 상한 결정 근거.
- **달성 가능 프레임레이트·지연**(대표 뷰포트).
- **CPU·메모리**(대표 뷰포트 크기별).
- **리사이즈 동작**(`maxWidth/maxHeight`·metadata).
- **포인터·키보드 dispatch**(`Input.dispatchMouseEvent`/`dispatchKeyEvent`/`insertText`) 정확도·좌표 변환.
- **페이지 네비게이션·팝업·타깃 종료** 처리(§11 리스너).
- **현행 WebSocket 인프라와의 전송 동작**(프로젝션 전용 경계 vs G1 상태 채널 분리 — §6.3).

**명시적 중단 조건(stop conditions)** — 아래면 폴백을 조용히 구현하지 말고 **멈추고 증거와 함께 보고**
(G1 Phase B 게이트 규율 계승):
- screencast가 현행 CDP 세션·봇탐지 자세(§2.1 `webdriver=false` 등)를 **훼손**하는 경우.
- 프레임레이트·지연이 감독형 상호작용에 **실용 불가** 수준인 경우.
- 프레임 크기·CPU가 loopback WS로 **감당 불가**한 경우.
- OS 캡처(옵션 C) 외 CDP 경로가 불가한 경우 — **비-CDP 자동 전환 금지**, 보고 후 결정.

---

## 17. 마이그레이션 경로 (Migration path)

V0가 **이후** 지탱하는 것(지금 끌어오지 않음):
- **Action Window(기본 리뷰 수집 모드)와의 렌더러 공유**: Action Window는 **실제 창 직접 행동**이 기본
  렌더러(`docs/slices/action-window-v1.md`)이고, Projection은 **비-기본 렌더러("Projected Direct Action",
  채널별 정책·제품 리뷰 후 활성화 가능)**다. **두 렌더러가 같은 가이드 상태 엔진을 공유**하므로 마켓
  로직을 중복하지 않는다. V0는 Projection 렌더러의 시각·입력 토대만 제공한다.
- **NAVER Guided Connection(G3)**: 프로젝션 뷰 + G1 "사용자 행동 필요" 이벤트가 단계 패널을 구동
  (§16.10 6단계). V0는 시각 토대만 제공, 단계 정의·발급 화면은 G3.
- **타깃 하이라이트·코치마크(G5)**: 좌표/URL 오버레이가 필요 → **로컬 신뢰 채널 예외**([PO-DECISION],
  ADR §3.4·§7(3))가 그때 열림. V0는 §8.3에서 이를 닫아둔다.
- **감독형 클릭(G3/G5)**: V0의 입력 릴레이는 **사람이 직접 조작**하는 것이며, 에이전트가 스스로 클릭하는
  감독형 자동 클릭(승인 후 1회)은 별개 — G3/G5에서 프로젝션 위에 얹음.
- **자동 재로그인 핸드오프(G4)**: CredentialVault 어댑터(ADR §3.2, 미구현)와 결합. V0는 사람이 로그인
  화면을 직접 조작하는 릴레이만 제공.
- **Windows 로컬 에이전트(G6)**: screencast/Input은 Chrome/CDP 동일(OS 무관) → 전송·프로토콜 재구현
  불필요, OS 의존은 캡처 폴백·자동시작 어댑터로 국소화.
- **클라우드 관리형 런타임**: 로컬 프로젝션 계약(세션·리스·프레임 카테고리)을 원격 세션으로 일반화 —
  단 클라우드 실행 미구현(ADR §3.5), 방향으로만.

---

## 18. 미해결 결정 (Open decisions)

> 모든 미해결 항목을 (1) 저장소 검증 가능 / (2) 외부 리서치 필요 / (3) 제품 오너 결정으로 분류. 가정으로
> 메우지 않는다.

### (1) 저장소 검증 가능 (repository-verifiable)
- `Page.startScreencast`가 현행 CDP 세션·`Page.enable` 스크립트-주입과 공존 가능한지(§2.3) — 스파이크(§16).
- screencast를 기존 `CDPSession`에 붙일지 별도 세션을 열지(§2.3) — 코드/스파이크.
- 팝업/타깃 수명 리스너(`page.on("popup")`·타깃 생성/종료)의 정확한 신설 범위(§2.2·§11) — 런타임 정독.
- 프로젝션 전송을 G1 서버에 별도 엔드포인트/서브프로토콜로 얹을지, 별도 리스너로 둘지(§6.3) — 코드.
- 다중 커머스 연결 중 초기 투사 타깃 선택 규약(§11) — `local-agent-progressive-service.ts` 정독.

### (2) 외부 리서치 필요 (external research)
- CDP 스크린캐스트·입력 릴레이가 각 마켓 약관 자동화 조항에 저촉되는지(ADR §7(2) 미해결 계승).
- 민감 화면 **자동 마스킹** 실현 가능성·신뢰성(§9) — 안정적 필드 식별 seam 부재.
- 프로젝션 인가의 non-exportable WebCrypto + proof-of-possession 관용례(§10 (b)) — 브라우저-로컬 서비스 선례.
- 대표 뷰포트에서의 실용 프레임레이트/지연/CPU 기준선(§16) — 측정 기반.

### (3) 제품 오너 결정 필요 (product-owner)
- **모바일 관람-전용 vs V0 미지원**(§13) — §16.8 증거는 데스크톱 우선·모바일 열람만을 시사(권장), 확정은 PO.
- **정확한 제어 리스 타임아웃·비활성 임계**(§7) — [SECURITY-DECISION].
- **탈취(takeover) 확인 동작**(§7) — 어떤 가시적 확인을 요구할지.
- **보조(우) 클릭 허용 여부**(§8.1) — 기본 보류, 근거 제시 후 결정.
- **가시적 프라이버시·제어 인디케이터**의 강도·문구(§9·§12).
- **수용 가능 품질·지연 목표**(§16) — 하드 게이트가 아닌 기대치로(수치 목표를 수용 기준으로 고정하지 않음).
- **좌표/URL 오버레이 예외**(§2.4·§8.3·§17 G5) — V0에서 닫아두되, 여는 시점은 PO(코치마크 필요 시).
- **팝업/다중 연결 동시 투사 정책**(§11).

---

## 19. 기술 스파이크 결과 (Technical spike results, 2026-07-08)

> **no-marketplace 스파이크. 로컬 file:// 픽스처 전용**(마켓 페이지·실 프로필·백엔드 미접촉). 하니스는
> **저장소 밖(스크래치패드)** 1회성 코드로 유지하며(G1 §6.1 선례) 저장소에 남기지 않는다. **집계 수치만**
> 기록하며 프레임 바이트·입력 텍스트·페이지 내용·URL은 결과·로그에 남기지 않았다(§19.8 검증).

### 19.1 환경
- **실제 Chrome Stable `Chrome/150.0.7871.47`**(macOS darwin), **headless=false**, **navigator.webdriver=false**
  — 프로덕션 자세(비헤드리스·webdriver 없음) **보존 확인**. spawn(`--remote-debugging-port`·전용
  스크래치 프로필·`--remote-allow-origins=*`) + `connectOverCDP` + `ctx.newCDPSession(page)` + `Page.enable`
  으로 `progressive-reconnect-chrome.ts` 경로를 충실히 재현. Node v23.7, Playwright 1.61.0, ws 8.21.0.

### 19.2 스크린캐스트 호환성·프레임 크기·프레임레이트 (`Page.startScreencast`)
합성 픽스처(대부분 흰 페이지 + 60fps rAF 애니메이션)에서 4초 창 측정. **모든 설정에서 시작·프레임·ack·
중지 정상.**

| 설정 | fps | enc.avg(B) | enc.p95(B) | dec.avg(B) | drop-old 큐 depth |
|---|---|---|---|---|---|
| jpeg q30 1280×720 | 44.3 | 9,024 | 9,056 | 6,767 | ≤2 |
| jpeg q50 1280×720 | 60.0 | 9,345 | 9,364 | 7,007 | ≤2 |
| jpeg q70 1280×720 | 59.8 | 9,743 | 9,772 | 7,306 | ≤2 |
| jpeg q90 1280×720 | 60.0 | 10,643 | 10,680 | 7,981 | ≤2 |
| **png** 1280×720 | 60.1 | 23,905 | 23,908 | 17,928 | ≤2 |
| jpeg q50 1024×640 | 60.0 | 5,888 | 5,908 | 4,415 | ≤2 |
| jpeg q50 everyNth2 | 30.0 | 9,346 | 9,368 | 7,008 | ≤2 |

- **JPEG가 PNG보다 ~2.5배 작다**(q50 ~9KB vs png ~24KB). q30→q90 크기 차 ~18%뿐 → **q50이 크기/품질 균형**.
- `everyNthFrame`가 프레임레이트를 정확히 분주(60→30). 캡처 프레임 base64 디코드 시간은 **~0.01ms**(무시 가능).
- **정직 caveat**: 크기는 **단순 합성 픽스처** 값이다. 밀집한 실제 마켓 페이지는 프레임이 더 커진다 →
  production 스파이크에서 대표적 리치 콘텐츠(비-마켓)로 재측정 권장(§19.9).

### 19.3 입력 지연·좌표 정확도
- **입력→가시 프레임 지연**(keyDown dispatch → 페이지 변화가 반영된 프레임, 15회): **avg 65.5ms · p50
  66.4ms · p95 74.9ms** → **목표 p95 ≤500ms 대폭 통과.**
- **좌표 매핑**: 1280×720 및 **1024×640으로 리사이즈 후** 모두 대상 요소 **적중(hitTarget=true), 오차 0px**.
- **텍스트 삽입**(`Input.insertText`) 9/9 반영, **기본 키 다운/업** 반영, **포인터/휠/클릭 손실 없음**.

### 19.4 입력 어댑터·제어 리스 가드
- **금지-입력 어댑터(순수)**: 13/13 케이스 정확 분류 — 허용(포인터/주클릭/휠/기본키/insertText),
  거부(보조·가운데 클릭·드래그·클립보드·파일·OS/네비 단축키·DevTools). §0.3와 일치.
- **제어 리스 가드**: 리스 보유 중 dispatch 허용 → **리스 회수(끊김/세션 상실) 후 dispatch 차단**
  (`dispatchAfterLoss=false`), **타 탭 dispatch 차단**(`foreignTabDispatch=false`). §7·§0.2 불변식 실증.

### 19.5 수명: 네비게이션·팝업·타깃 종료·CDP detach
- **네비게이션 중 스트림 지속**(nav 전 47프레임 → nav 후 46프레임, 계속됨).
- **팝업/새 타깃**: 클릭으로 `window.open` → 새 타깃 **감지**, 팝업에 별도 CDP 세션 부착·스크린캐스트
  **44프레임 수신**, **팝업 종료 처리**·원본 페이지 정상 유지.
- **CDP detach 후 재부착**: 세션 detach → 새 세션 생성·스크린캐스트 **재개 성공**.
- **정리**: 브라우저 종료 후 프로필 Chrome 프로세스 **0개**(메인·소크·CPU 런 모두).

### 19.6 메모리(10분 바운디드 런)·CPU 증분
- **10분 소크**(jpeg q50 1280×720, 60fps 지속, 15초 간격 40샘플): RSS **791.9→784.5 MB**, 선형회귀
  **기울기 −1.43 MB/min**(무증가; 764–900 사이 진동, 1회 일시 스파이크). **36,030프레임(60fps 지속)**,
  종료 후 프로세스 0. → **지속적 메모리 증가 없음(PASS).** drop-old 큐 depth ≤2 유지.
- **CPU 증분(격리)**: 베이스라인(페이지-only, 60fps rAF) **25.4%**, 스크린캐스트 60fps **40.4%(증분
  +15%p)**, **캡드 ~10fps 30.9%(증분 +5.5%p)**. → **스크린캐스트 증분 CPU는 목표 ≤25% 이내**(캡드 시
  +5.5%p). 앞선 30–43% "총" 수치는 픽스처 자체 60fps 애니메이션(25%p)을 포함한 것.
- **정직 caveat**: 픽스처가 60fps로 과도 애니메이션 → 베이스라인이 높다. 대부분 정적인 실제 페이지는
  페이지 자체 렌더가 훨씬 적고, 캡드 스크린캐스트가 지배적이나 절대 CPU는 낮다.

### 19.7 전송 실험 — JSON base64(텍스트) vs 바이너리 (별도 프로젝션 경계)
동일 150프레임(jpeg q50)을 loopback ws로 전송. **G1 상태 채널(JSON·64KiB·바이너리 거부)은 미변경**,
아래는 **분리된 실험 경로**.

| 방식 | 평균 B/프레임 | CPU(ms) | drop(바운디드 큐) | 최대 버퍼(KB) |
|---|---|---|---|---|
| JSON base64 텍스트 | 9,387 | 16.7 | 36 | 513 |
| **바이너리** | **7,016** | **6.5** | **0** | 493 |

- **base64 오버헤드 +33.8%**(크기), **CPU ~2.5배**, base64는 512KB 바운디드 큐에서 **36프레임 drop-old**
  발생(바이너리 0). → **바이너리 전송이 크기·CPU·안정성 모두 우위.**
- 바운디드 큐 + drop-old(`bufferedAmount>512KB`면 최신 우선 드롭)가 **무한 버퍼링을 방지**함을 실증.

### 19.8 프라이버시·금지-데이터 검증
- 결과 JSON(main/soak/cpu) 스캔: **JPEG/PNG base64 매직 0, `"data"` 프레임 키 0, 120자↑ 문자열 0**
  (cpu의 1건은 설명용 `note` 프로즈), **file://·http URL 0**, 삽입 텍스트 원문 0. → 프레임 바이트·입력
  텍스트·페이지 내용·URL·DOM·자격증명·계정 식별자 **미기록**(집계 수치·enum·boolean만).
- 프레임·입력은 **loopback에만**, **비영속·비로깅**, **백엔드 미경유**.

### 19.9 잠정 게이트 판정(§0.6) 및 권장 production 아키텍처
| 게이트 | 목표 | 측정 | 판정 |
|---|---|---|---|
| 대표 뷰포트 | 1280×720 | 1280×720(+1024×640) | ✅ |
| 평균 프레임레이트 | ≥8 fps | 44–60 fps; 10분 60fps 지속 | ✅ (여유 큼) |
| 입력→가시 응답 | p95 ≤500ms | p95 74.9ms | ✅ |
| 입력 손실 없음 | 없음 | insertText 9/9·좌표 2/2 적중·기본키 OK | ✅ |
| 미-ack/최신 큐 | ≤1~2 | drop-old depth ≤2 | ✅ |
| 10분 메모리 무증가 | 무증가 | 기울기 −1.43 MB/min | ✅ |
| 증분 CPU | ≤25% | 스크린캐스트 증분 +15%(60fps)/+5.5%(~10fps) | ✅ |
| 리사이즈 후 좌표 | 정확 | 오차 0px·적중 both | ✅ |

**8/8 게이트 통과. 중단 조건(§16) 미발동**(스크린캐스트 start/stop 안정·리사이즈 좌표 정확·무한 버퍼링
없음·메모리 무증가·제어 상실 후 입력 차단·팝업/타깃 진실 표면·지연/CPU 적합·프라이버시 경계 유지).

**권장 production 아키텍처(증거 충분):**
1. **`Page.startScreencast`(CDP 옵션 A)** — 실제 Chrome 150 + `connectOverCDP`와 호환 확인, webdriver=false
   보존. OS 캡처(옵션 C) 불필요.
2. **JPEG q50**(크기/품질 균형), **프레임레이트 ~10–15fps로 캡**(everyNthFrame 또는 ack-페이싱) → 증분
   CPU ~5–6%p·8fps 하한 상회.
3. **바이너리 프로젝션 전송을 G1 상태 채널과 분리된 경로**로(64KiB JSON·바이너리-거부 상태 채널 미변경),
   **바운디드 큐 + drop-old(depth ≤2)**.
4. 타깃별 스크린캐스트(팝업 재부착), detach 재부착, §0.2 제어 리스·§0.4 프라이버시·§0.5 인가 분리 준수.

### 19.10 블로커·편차(정직)
- **(편차, 블로커 아님)** 프레임 크기·CPU는 **단순 합성 픽스처** 기준 — 밀집 실 페이지에서 재측정 필요(§19.2·§19.6).
- **(편차)** 입력-가시 지연은 **프레임 크기 스파이크 프록시**로 측정(실제 디스플레이 photon 아님); 프론트
  캔버스 렌더러 미구축이라 **브라우저 페인트→SellerOps 표시 시간은 미측정**(디코드 ~0.01ms만).
- **(편차)** 대표 프레임레이트 확보를 위해 **off-screen 창 + 백그라운드 스로틀 비활성 플래그** 사용
  (production은 창을 보이게 유지; 정성적으로 동등).
- **미해결(§18 계승, 블로커)**: 마켓 약관상 스크린캐스트/입력 릴레이 허용성(외부 리서치), 고객-PC 배포 전
  WebCrypto PoP 검토. 이들은 **production 착수 승인의 선결**이며 스파이크로 해소되지 않는다.

> **스파이크 판정**: 증거는 §19.9 권장 아키텍처로 **production V0 구현 슬라이스를 시작하기에 충분**하다.
> 단 본 과제는 **스파이크만 승인**했으므로, production 구현 착수는 **별도 제품 오너 승인 + §18(2) 외부
> 리서치 선결** 이후다. 스파이크 하니스는 저장소 밖 스크래치패드 1회성 코드로 폐기 가능.

---

## 20. 마켓 정책 경계·릴리스 게이트 (구현됨 ≠ 마켓 사용 승인)

이 구현은 **채널-중립**이며 **로컬 픽스처 전용**이다. **실제 마켓 대상 테스트·사용은 이 슬라이스에 없다.**

**릴리스 게이트(마켓 사용 전 선결):**
- **NAVER 대상 production 사용은 셀러-통제 로컬 프로젝션·입력 릴레이의 허용 범위 해명을 요구**한다
  (마켓 약관 자동화/원격조작 조항 — §18(2) 외부 리서치). 해명 전 실제 마켓 사용 금지.
- **V0 구현을 "NAVER 승인됨"으로 기술하지 않는다.** 어떤 마켓의 승인도 받지 않았다.
- **자동 로그인·자동 클릭·CAPTCHA/2FA 우회·무인 운영은 영구 제외**(ADR §4 불변식 계승).

**고객-PC 배포 게이트(보안 리뷰 선결):**
- 고객 회사 PC 배포 전 **별도 보안 리뷰**가 (a) **key-bound proof-of-possession**(non-exportable WebCrypto,
  DPoP류 — 단 RFC 9449 DPoP는 본 슬라이스 미구현), (b) **CSP/XSS 방어**(localStorage bearer 파일럿 임시성),
  (c) **revocable per-agent 백엔드 토큰**을 평가한다. 이 리뷰 전에는 assisted macOS 파일럿 범위로 한정한다.

## 21. 로컬 픽스처·E2E 렌더 요구 (검증 대상)

§15/§16 검증에 아래를 **명시적으로** 포함한다:
- **리치 합성 셀러센터 픽스처**(마켓 무관·합성): 대형 주문 테이블·합성 썸네일·사이드바·폼 입력·드롭다운·
  모달·중첩 스크롤·로딩 애니메이션. **복제된 마켓 UI/브랜드/문구/자산 금지.** + 최소 상호작용 픽스처.
- **E2E 렌더 지연**: "포인터 입력 → **SellerOps가 렌더한 가시 프레임**"까지의 왕복 지연을 측정(디코드+렌더
  포함). 스파이크의 프레임-도착 프록시(§19.3)를 **프론트 렌더 완료 시점**으로 확장. 잠정 목표 p95 ≤500ms.
- 리치 픽스처에서 **긴 페이지·중첩 스크롤 좌표 정확도**, **드롭다운·모달 상호작용**, **1280×720 + 더 작은
  데스크톱 뷰포트**, **q50 10fps(및 비교용 15fps)**, 평균·p95 프레임 크기, 10분 메모리 소크, 증분 CPU.

---

## 22. V0 구현 결과 (Channel-neutral implementation, 2026-07-08)

채널-중립 V0가 구현·검증됐다(로컬 픽스처 전용, 마켓 미테스트). G1 상태 채널은 **미변경**.

### 22.1 구현 파일
- **collector 신규**: `src/bridge/{projection-protocol,projection-session,projection-input,projection-adapter,
  projection-hub,projection-endpoint}.ts`. **변경**: `src/bridge/bridge-server.ts`(프로젝션 전용
  엔드포인트·WS·틱·리보크 캐스케이드 — G1 상태 채널 미변경), `src/agent/agent-bridge.ts`(선택적 프로젝션
  주입 seam). **테스트 신규**: `test/bridge/projection-{session,input,adapter,hub,server,privacy}.test.ts`
  (46개). **픽스처 신규**: `test/fixtures/projection/{minimal,seller-center,popup}.html`(합성·마켓 무관).
- **frontend 신규**: `src/lib/bridge/{projectionProtocol,projectionClient}.ts`(+`projectionClient.test.ts`
  10개), `src/hooks/useProjection.ts`, `src/components/bridge/ProjectionView.tsx`. **변경**:
  `components/AppShell.tsx`(`VITE_ENABLE_AGENT_PROJECTION` 게이트).

### 22.2 지원 능력 (배선·검증) vs 미지원/예약
- **지원(E2E 검증)**: `Page.startScreencast` 바이너리 프레임 투사, view/control 능력 협상, 단일 제어
  소유자 + 다중 관람, 2분 idle 제어 리스(입력 시 갱신), 재접속=뷰만, 정규화 입력→에이전트 CSS 변환→
  `Input.*` dispatch, 좌표 정확(리사이즈 후 0px), 바운디드 drop-old 큐(depth≤2), 페어링 리보크 캐스케이드,
  프로젝션 전용 단명 티켓(G1 상태 채널과 분리·64KiB 미변경).
- **미지원/제외(정직)**: 자동 마스킹, 코치마크/하이라이트(G5), 자동 로그인·자동 클릭(영구 제외), 다중
  동시 타깃(V0=1 타깃), Windows/클라우드. 예약 이벤트를 실제로 방출하지 않음.

### 22.3 E2E QA (실제 Chrome 150 + 실제 전송 + 로컬 픽스처)
- 환경: `Chrome/150.0.7871.101`, headless=false, **webdriver=false**(자세 보존).
- 제어: hello 능력(view+control) 협상, `control_granted` 획득.
- **입력→렌더 프레임 왕복 지연(E2E, viewer↔server↔hub↔adapter↔CDP↔Chrome↔screencast↔viewer)**: avg
  122.5ms · p50 124ms · **p95 130ms**(목표 ≤500ms 통과).
- **좌표 정확도(정규화 입력 경로)**: 1280×720 및 **리사이즈 1024×640** 모두 대상 적중·**오차 0px**.
- 페어링 리보크: **프레임·입력 중단 + 소켓 종료** 확인.
- 리치 합성 셀러센터 픽스처: 프레임 ~**36.5KB**(단순 픽스처 9KB보다 큼 — 밀집 페이지, 512KB 프레임
  상한 내), q50 everyNth4=**15fps**, everyNth6=**7.2fps**(아래 발견).

### 22.4 테스트·빌드
- collector: typecheck OK, `npm test` **2299 pass**(1 skip; 프로젝션 46 포함).
- frontend: typecheck OK, `npm test` **166 pass**(프로젝션 10 포함), `npm run build` OK.
- 프라이버시: 프로젝션 결과·로그에 프레임 바이트·입력 텍스트·URL·티켓 **0**(소스가드 + 로그싱크 검증).
- 소스가드: 어댑터 CDP 호출은 `Page.startScreencast/stopScreencast/screencastFrameAck` + `Input.*`뿐;
  네비게이션·로그인·자격증명·마켓 도메인·워크플로 토큰 **부재**.

### 22.5 잠정 게이트 판정(§0.6, E2E)
| 게이트 | 측정(E2E) | 판정 |
|---|---|---|
| 평균 프레임레이트 ≥8fps | 15fps 설정=15fps ✅ / **everyNth6=7.2fps(밀집 페이지)** ⚠ | ⚠(아래 튜닝) |
| 입력→가시 p95 ≤500ms | 130ms | ✅ |
| 입력 손실 없음 | 좌표 적중·입력 수락 | ✅ |
| 미-ack/최신 큐 ≤2 | drop-old depth≤2(단위·통합) | ✅ |
| 리사이즈 후 좌표 | 오차 0px | ✅ |
| 리보크가 프레임·입력 중단 | 확인 | ✅ |
| 10분 메모리 무증가 | 소크 §22.6: 기울기 −38.8 MB/min | ✅ |
| 증분 CPU ≤25% | 스파이크 §19.6(+5.5%~) | ✅ |

### 22.6 10분 소크 (E2E, 실제 전송 경로)
실제 Chrome + 실제 프로젝션 전송(뷰어 ws)으로 10분 지속(40샘플). RSS **894.6→461 MB**, 선형회귀
**기울기 −38.8 MB/min**(무증가 — 초기 로드 후 하강해 ~460–500 MB에서 안정). **6,017프레임**(~10fps E2E).
→ **지속적 메모리 증가 없음(PASS)**, drop-old 큐가 무한 버퍼링을 방지함을 실증. 결과 JSON 프라이버시
스캔: 프레임 바이트·URL **0**.

### 22.7 발견·편차(정직)
- **(튜닝 필요)** `everyNthFrame`은 컴포지터 프레임 기준이라 밀집 페이지에서 컴포지트가 느리면 실효
  프레임레이트가 목표 미만이 된다(리치 픽스처 everyNth6=7.2fps < 8). **production은 시간 기반 프레임
  간격 캡(예: 100ms)으로 ≥8fps를 보장**하도록 튜닝 권장(승인된 "≤15fps까지 튜닝" 범위 내).
- **(QA 한계)** 합성 프로젝션 클릭으로 `window.open` 팝업이 하니스에서 재현되지 않음(Chrome 팝업
  차단 추정). 팝업 announce→명시적 전환 **전송 로직은 단위·통합 테스트로 검증**(hub·client)됨.
- **(편차)** E2E "렌더"는 viewer의 프레임-도착·디코드 기준(실제 브라우저 페인트 photon 아님).
- **(미해결, §20 게이트)** 마켓 약관 허용성·고객-PC WebCrypto PoP 보안 리뷰는 여전히 production 사용 선결.

### 22.8 제품-런타임 배선 상태 — **State B (구현 seam만, production-runtime 미배선)**

> **정직성(코드 근거).** "코드가 존재한다"와 "정상 제품 부팅이 지원한다"를 **혼동하지 않는다.**

**State B: Projection V0은 구현·커밋(`a0e4f6f`)·픽스처/통합 하니스로 검증됐으나, 정상 Local Agent 제품
부팅은 프로젝션 소스를 생성·주입하지 않으며 production-runtime에 배선되지 않았다.** 마켓 사용 미승인·비-기본
렌더러(§20, §기본 모드 관계).

정상 승인 `local-agent` 부팅 기준 5개 질문(read-only 코드 정찰, 2026-07-08):
1. **실제 프로젝션 소스를 생성하는가? — 아니오.** `collector/src/cli/local-agent.ts`의 `main()` LIVE BOOT
   경로는 `createAgentBridge(resolveAgentBridgeConfig(args, process.env))`를 호출하고, `resolveAgentBridgeConfig`
   함수는 `{port,allowedOrigins,pairingFile,agentVersion,refSalt,autoApprovePairing}`만 반환한다 —
   **`projection`/`createSource` 필드 없음.** (origin-main 통합으로 `local-agent.ts` 상단에 same-process
   human-completion 코드가 삽입되어 라인번호가 이동했으므로 **함수/심볼 기준으로 인용**한다.)
2. **소스를 브리지에 주입하는가? — 아니오.** `collector/src/agent/agent-bridge.ts:74`
   `cfg.projection ? new ProjectionEndpoint(...) : undefined` → 정상 부팅에서 **undefined**.
3. **프로젝션 WebSocket 엔드포인트를 시작하는가? — 아니오.** `collector/src/bridge/bridge-server.ts:93`
   `projectionWss = this.projection ? ... : undefined`; `:307` `/projection/ticket`은 projection 없으면 404;
   `:373-374` `/projection/ws` 업그레이드도 404.
4. **production 프론트 기능 플래그가 별도 QA 하니스 없이 그 엔드포인트에 연결할 수 있는가? — 아니오.**
   엔드포인트가 장착되지 않아 404이며, 실제 CDP 소스 `ProjectionAdapter`는 **`test/bridge/projection-adapter.test.ts:25`
   에서만** 생성된다(제품 `src/` 부팅 경로 아님).
5. **에이전트 종료가 프로젝션 소스·엔드포인트를 닫는가? — 배선 시에는 예(`bridge-server.ts:125,131`이
   `projection.close()` + `projectionWss.close()` 캐스케이드), 정상 부팅에는 닫을 것이 없음(undefined).**

**결론**: 정상 제품 부팅으로 프로젝션을 올리려면 `resolveAgentBridgeConfig`가 `projection`(실제 Chrome/CDP
페이지 위 `ProjectionAdapter` `createSource`)을 채워 주입하는 **별도 배선 작업**이 필요하다. 그 작업은
이 슬라이스 범위 밖이며(계약은 "선택적 주입 seam"까지), 마켓 사용 승인·정책 게이트와도 별개다.

---

### 부록 — 근거 문서·파일
- 제품 원칙·현재/미래 경계: `docs/product-scope-v1.md` §1.2·§6.1
- 프론트 상태·보안·슬라이스: `docs/sellerops_frontend_spec.md` §16.8·§16.9·§17-B G2
- 런타임 경계·BrowserRuntime·프로젝션 방향: `docs/sellerops_local_agent_runtime_adr.md` §3.1·§3.4·§6·§7
- G1 브리지 계약: `docs/slices/local-agent-bridge.md`(전송·페어링·능력·이벤트)
- 현행 CDP 코드: `collector/src/agent/progressive-reconnect-chrome.ts`(CDPSession·spawn·connectOverCDP·
  `newCDPSession`·`Page.enable`), `collector/src/agent/local-agent-launch.ts`, `collector/src/profile.ts`,
  `collector/src/agent/local-agent-progressive-service.ts`, `collector/src/connector/connector-orchestrator.ts`
- G1 전송·페어링: `collector/src/bridge/{bridge-server,pairing,pairing-store,event-adapter,protocol}.ts`
- 프론트 현행: `frontend/src/lib/bridge/*`, `frontend/src/hooks/useBridge.ts`,
  `frontend/src/components/bridge/BridgeStatus.tsx`, `frontend/src/components/AppShell.tsx`
