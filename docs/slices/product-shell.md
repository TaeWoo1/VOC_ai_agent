# Slice: Product Shell (execution contract)

> Status: **SUPERSEDED (2026-08-17).** 이 슬라이스는 v2 프론트 재구성(커밋 `fc5f86ed`, 2026-08-03)으로 대체됐고,
> 현재 IA·화면 책임의 정본은 `docs/product_assembly_ia_v1.md`다. 아래는 기록으로 남긴다.
>
> (원문) Status: ACTIVE SLICE. 이 문서는 첫 프론트 슬라이스의 정확한 실행 계약이다. 상위 정본은
> `docs/sellerops_frontend_spec.md` §17-A(Product Shell 트랙)이며, 본 문서는 그 슬라이스의 포함/제외/
> 수용 기준을 코드 착수 전에 못박는다. 승인된 구조만 구현하고, 미해결 UX는 [UX-DECISION]으로 남긴다.

## Goal

기존 프론트를 재배치해 **매일의 셀러 운영을 제품 frontstage로, 연결/수집 도구를 backstage로** 만든다.
비즈니스 로직·백엔드·API는 바꾸지 않는다(순수 IA/셸 슬라이스).

## Included

- 데스크톱 내비게이션을 **일상 운영 그룹**과 **관리 그룹**으로 분리.
- 채널·업로드·커넥터 알림 라우트를 `/settings/*` 하위로 이동.
- 구 라우트에서 신 라우트로 **하위호환 리다이렉트** 유지.
- standalone **AI 검색**을 내비게이션·라우팅에서 제거.
- 알 수 없는 경로를 조용히 리다이렉트하지 않고 **실제 404 페이지** 렌더.
- **모바일 내비게이션**: 임시 메뉴 버튼 + 드로어(현행 승인 데스크톱 내비를 그대로 미러).
- 개발자향 백엔드 오류 문구를 **셀러향 복구 문구**로 교체.
- 기존 정상 동작 비즈니스 페이지·API 동작 **보존**.
- capability 정직성·fail-closed 동작 **보존**.

## Interim mobile decision

최종 모바일 하단 탭 구성은 **미승인**이다. 본 슬라이스에서는:
- 모바일 헤더/메뉴 버튼 구현;
- 현행 승인 데스크톱 내비를 미러하는 드로어/시트를 연다;
- **영구 5탭 하단 내비 IA를 확정하지 않는다**;
- 최종 모바일 내비는 후속 **[UX-DECISION]**으로 기록.

## Labels

- 정본 문서에서 확정된 라벨만 사용.
- 라벨이 아직 미해결인 경우 **현행 production UI 라벨을 보존**.
- 본 슬라이스에서 `/inbox`와 `/inquiries`를 **병합하지 않는다**.
- 미래 통합 고객 응대 워크스페이스의 최종 명칭을 **발명하지 않는다**.
- 현행 확정 라벨(그대로 유지): 홈, 인박스, 문의 응답, 주문·매출, 상품 이슈, 리포트, 채널 연결,
  자료 업로드, 연결 알림. (사이드바 그룹 헤더는 아래 §Labels-group 참조.)

### Labels-group (그룹 헤더)
- 일상 운영 그룹 헤더: **"운영"** (frontstage). 관리 그룹 헤더: **"연결·설정"** (backstage).
  이 두 그룹 헤더는 Frontend Spec §5 IA(운영 1차/관리 2차)에서 파생된 구조 라벨이며, 개별 메뉴 라벨은
  현행 production 라벨을 보존한다. 그룹 헤더 문구 자체의 미세 조정은 [UX-DECISION].

## Explicit exclusions

- 대시보드 재설계
- 가입·온보딩
- inbox/inquiry 병합
- 리뷰 워크플로 재설계
- 리포트 구현
- 가이드 연결(Guided Connection)
- 프론트-에이전트 통신
- 브라우저 프로젝션
- 자동 로그인
- 시각 리브랜딩
- 신규 백엔드 능력
- 채널 카탈로그 정책 변경

## Wireframe reference (승인 구조만)

대시보드 카드·미래 고객 응대 레이아웃은 설계하지 않는다. 구조 골격만:

### Desktop
```
┌───────────────────────────────────────────────────────────┐
│  Sidebar (persistent)      │  TopBar                        │
│  ┌───────────────────────┐ │────────────────────────────────│
│  │ SellerOps             │ │                                │
│  │                       │ │                                │
│  │ 운영                  │ │   Content area                 │
│  │  · 홈                 │ │   (기존 페이지 그대로)          │
│  │  · 인박스             │ │                                │
│  │  · 문의 응답          │ │                                │
│  │  · 주문·매출          │ │                                │
│  │  · 상품 이슈          │ │                                │
│  │  · 리포트             │ │                                │
│  │                       │ │                                │
│  │ 연결·설정             │ │                                │
│  │  · 채널 연결          │ │                                │
│  │  · 자료 업로드        │ │                                │
│  │  · 연결 알림 [배지]   │ │                                │
│  └───────────────────────┘ │                                │
└───────────────────────────────────────────────────────────┘
```

### Mobile (≈390px)
```
┌─────────────────────────────┐        Drawer (열림 시):
│ [☰]  SellerOps       (TopBar)│        ┌───────────────────┐
│─────────────────────────────│        │ 운영              │
│                             │        │  · 홈 · 인박스 …  │
│   Content area              │        │ 연결·설정         │
│   (기존 페이지 그대로)       │        │  · 채널 연결 …    │
│                             │        │ [백드롭 클릭/ESC 닫힘]│
└─────────────────────────────┘        └───────────────────┘
```

## Route migration

| 구 | 신 | 동작 |
|---|---|---|
| `/` `/orders` `/inbox` `/inquiries` `/issues` `/reports` | 동일 | 유지 |
| `/channels` | `/settings/channels` | 이동 + 리다이렉트 |
| `/channels/:accountId` | `/settings/channels/:accountId` | 이동 + 파라미터 보존 리다이렉트 |
| `/upload` | `/settings/upload` | 이동 + 쿼리(`?channelId=`) 보존 리다이렉트 |
| `/alerts` | `/settings/alerts` | 이동 + 리다이렉트 |
| `/connect/cafe24`, `/connect/cafe24/result` | 동일 | 유지 |
| `/search` | — | 제거 |
| (unknown) | — | 404 페이지 |

## Acceptance criteria (Phase B/C 공통)

1. 모든 현행 페이지가 계속 도달 가능.
2. 구 라우트 리다이렉트 동작(`/channels`,`/channels/:id`,`/upload`(+쿼리),`/alerts`).
3. `/search`가 더 이상 해석되지 않음.
4. 알 수 없는 경로는 404 페이지 표시(조용한 리다이렉트 아님).
5. 모바일 사용자가 모든 노출 내비 목적지에 도달 가능.
6. 모바일 헤더에 콘텐츠가 가려지지 않음.
7. 라우트 변경 후 내비 드로어 자동 닫힘.
8. 알림 배지가 여전히 정상 렌더.
9. 개발자향 백엔드 지시 문구가 남아있지 않음(카피 가드 테스트로 강제).
10. mock capability가 production capability로 새로 표기되지 않음.
11. `typecheck` + `test` + `build` + `git diff --check` 통과.

## Validation commands (canonical)
```
cd frontend
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsc --noEmit && vite build
git diff --check
```
개발/mock 모드 시각 점검은 `VITE_USE_MOCKS=true npm run dev`(로컬, 마켓 접속 없음)로 수행.
