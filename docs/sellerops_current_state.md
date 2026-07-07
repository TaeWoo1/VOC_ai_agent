# SellerOps — Current State (living handoff)

> **Living handoff document — not a strategy document.** 이 문서는 "지금 어디까지 됐는가"의 단일
> 스냅샷이다. 제품 의도/범위는 `docs/product-scope-v1.md`, 프론트 스펙은 `docs/sellerops_frontend_spec.md`,
> capability 진실은 `docs/multi-channel-connector-roadmap.md` §4.1이 정본이며, 본 문서는 그들을 참조한다.
> 새 슬라이스가 끝나거나 상태가 바뀌면 갱신한다.

## 1. Last updated
2026-07-08 (Product Shell 커밋 완료 `3006e44`; **Local Agent Bridge G1 계약 승인 + G1 구현 진행 중**, 미커밋).

## 2. Current product phase
Seller Track 프론트 리디자인 + **가이드 연결 인프라 G1 착수**. **Product Shell 슬라이스 = 커밋 완료**
(베이스라인 `3006e447b91de72f5e3627da75f390c74d92bfac`). **Local Agent Bridge(§17-B G1) 계약 = 승인됨**
(`docs/slices/local-agent-bridge.md` §0, 2026-07-08) → **G1 구현 active**(프론트↔에이전트 안전 페어링 +
관측 전용 브리지). Browser Projection·Guided Connection·자동 로그인·Device Vault·Windows 패키징·클라우드
런타임은 **여전히 미구현**(범위 밖 §9·§14). 수집·커넥터 백엔드는 기존 상태 유지(신규 채널 오픈 없음).

## 3. Canonical document index
| 문서 | 역할 |
|---|---|
| `docs/product-scope-v1.md` (v1.1) | 제품 범위 계약, Track, frontstage/backstage, 가이드 연결·런타임 원칙 |
| `docs/sellerops_frontend_spec.md` | 프론트 IA·화면·여정·가이드 연결·슬라이스 정본 |
| `docs/multi-channel-connector-roadmap.md` | 수집 전략 + §4.1 채널 현행표(capability 진실) + §11 연결 모드 |
| `docs/sellerops_local_agent_runtime_adr.md` | 로컬 에이전트 런타임 경계·프로젝션 방향 ADR |
| `docs/sellerops_phase3c_live_smoke.md`, `docs/sellerops_cafe24_live_verification.md` | 라이브 검증 기록 |
| `docs/slices/product-shell.md` | 현재 활성 슬라이스 실행 계약 |

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
- **브라우저 프로젝션**(인앱 브라우저 뷰 투사) — 미구현.
- **OS Device Vault / 자동 자격증명 입력 / 자동 재로그인** — 미구현.
- **프론트↔로컬 에이전트 통신 채널** — **G1 브리지로 구축됨(페어링+관측 전용, 실제 Local Agent 소유)**.
  단 프로젝션·입력 릴레이·워크플로/브라우저 제어 명령은 여전히 미구현(G1 범위 밖).
- **실행-중 이벤트(browser_lifecycle·collection_progress/result·auth_session·terminal_failure)** — **예약**
  (스키마만; 실제 방출 seam 없음, `supportedEvents`에서 제외). 실제 배선 = agent/bridge lifecycle·
  connection_lifecycle·pending_user_action·recoverable_failure·capability.
- **Windows 지원** — 미구현(현행 macOS 전제; 브리지 전송은 `ws`/Node 표준이라 이식 경로만 문서화).
- **클라우드 관리형 런타임** — 미구현(방향으로만).
- 채널 쓰기(답변 발송/주문 상태 변경), 무인 자동 수집, 자동 제품 매칭, standalone AI 검색.

## 10. Active slice
**Local Agent Bridge (Guided-Connection 인프라 G1)** — 계약 `docs/slices/local-agent-bridge.md`
(**승인됨 2026-07-08 §0**). **상태: 구현·검증 완료, 미커밋, 제품 오너 커밋 승인 대기.** Product Shell은
`3006e447b91de72f5e3627da75f390c74d92bfac`로 커밋 완료(이전 활성 슬라이스).

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
- **Local Agent Bridge G1** — 구현·하드닝·검증 완료, **제품 오너 커밋 승인 대기**(미커밋). 남은 한계
  (정직 표기): 실행-중 이벤트(browser_lifecycle·collection_progress/result 등)는 **예약**이며 실제 방출은
  G2/라이브 수집의 신뢰 seam이 생겨야 `supportedEvents`로 승격(현재는 날조하지 않고 미노출);
  Windows/클라우드는 이식 경로만 문서화; LNA 네이티브 프롬프트 승인은 헤드드(사람) 상호작용이라 자동
  검증 밖; 페어링 토큰 localStorage 저장은 파일럿 임시 방식(고객-PC 전 WebCrypto+PoP 평가).
- **다음 후보 = Browser Projection V0(§17-B G2)** — **아직 시작하지 않음**(별도 승인 필요; §14).
- Product Shell은 `3006e44`로 커밋 완료됨.

## 14. Must NOT be started yet
- Browser Projection V0, NAVER Guided Connection, Automatic Relogin, Windows Migration (Frontend Spec §17-B G2–G6).
- 대시보드 재설계, 가입/온보딩, inbox/inquiry 통합, 리포트 구현, 브라우저 프로젝션,
  자동 로그인, 시각 리브랜딩, 신규 백엔드 능력, 채널 카탈로그 정책 변경.
  (프론트↔에이전트 통신은 G1으로 구축 완료 — 이 목록에서 제외.)

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
