# SellerOps — Current State (living handoff)

> **Living handoff document — not a strategy document.** 이 문서는 "지금 어디까지 됐는가"의 단일
> 스냅샷이다. 제품 의도/범위는 `docs/product-scope-v1.md`, 프론트 스펙은 `docs/sellerops_frontend_spec.md`,
> capability 진실은 `docs/multi-channel-connector-roadmap.md` §4.1이 정본이며, 본 문서는 그들을 참조한다.
> 새 슬라이스가 끝나거나 상태가 바뀌면 갱신한다.

## 1. Last updated
2026-07-07 (Product Shell 구현·검증 완료, **미커밋**).

## 2. Current product phase
Seller Track 프론트 리디자인. **Product Shell 슬라이스 = 구현·검증 완료, 커밋 전(제품 오너 리뷰 대기).**
수집·커넥터 백엔드는 기존 상태 유지(신규 채널 오픈 없음).

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
- **미커밋.** 검증 결과는 §15.

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
- **프론트↔로컬 에이전트 통신 채널** — 미구현(현재 stdout/파일/sentinel만).
- **Windows 지원** — 미구현(현행 macOS 전제).
- **클라우드 관리형 런타임** — 미구현(방향으로만).
- 채널 쓰기(답변 발송/주문 상태 변경), 무인 자동 수집, 자동 제품 매칭, standalone AI 검색.

## 10. Active slice
**Product Shell** — `docs/slices/product-shell.md`. **상태: 구현·검증 완료, 미커밋, 제품 오너 리뷰 대기.**
프론트 IA를 frontstage(매일 운영)/backstage(연결·수집)로 재편, `/settings/*` 이동 + 구경로 리다이렉트,
`/search` 제거, 404 신설, 모바일 임시 드로어 내비, 셀러 언어 오류 문구 교체. **비즈니스 로직·백엔드 무변경.**

### 신규/변경 파일 (Product Shell)
- 신규: `frontend/src/lib/nav.ts`, `components/NavContent.tsx`, `components/MobileNav.tsx`, `pages/NotFound.tsx`.
- 변경(셸): `App.tsx`, `components/{AppShell,Sidebar,TopBar}.tsx`.
- 삭제: `pages/AiSearch.tsx`.
- 오류 문구 교체(15개 페이지·컴포넌트·lib), 내부 링크 `/settings/*` 이관, 카피 가드 테스트 확장.

## 11. Current blockers
- (repository-verifiable) org 횡단 대시보드 집계 API 부재 — 대시보드 재설계(후속 슬라이스) 선행 조건.
- (repository-verifiable) 비-Cafe24 seller-account 생성 API 부재 — 채널 연결 일반화 선행.
- (product-owner) 최종 모바일 내비 구성(5탭 등) 미승인 — 본 슬라이스는 임시 드로어로만.
- (product-owner) 고객 응대 통합 화면 최종 명칭 미정 — 본 슬라이스는 `/inbox`·`/inquiries` 유지.

## 12. Unrelated pre-existing uncommitted changes
- `docs/esm/live-capture-checklist.md` — 본 작업과 무관한 사전 미커밋 변경. **수정 금지.**
- `tools/` — 미추적(Cafe24 콜백 릴레이). 본 작업 범위 밖.
- (직전 세션의) 정본 문서 변경들(product-scope/frontend-spec/connector-roadmap/ADR 및 배너)도 미커밋 상태.

## 13. Next approved work
- **Local Agent Bridge**(Frontend Spec §17-B G1) — 다음 후보 슬라이스. **아직 시작하지 않음.**
- **Product Shell은 커밋 전 제품 오너 리뷰가 필요**하다. 리뷰·커밋 전에는 다음 슬라이스를 시작하지 않는다.

## 14. Must NOT be started yet
- Browser Projection V0, NAVER Guided Connection, Automatic Relogin, Windows Migration (Frontend Spec §17-B G2–G6).
- 대시보드 재설계, 가입/온보딩, inbox/inquiry 통합, 리포트 구현, 프론트-에이전트 통신, 브라우저 프로젝션,
  자동 로그인, 시각 리브랜딩, 신규 백엔드 능력, 채널 카탈로그 정책 변경.

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
