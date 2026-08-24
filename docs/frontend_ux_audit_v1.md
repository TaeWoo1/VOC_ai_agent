# Frontend UX Audit v1 — 현재 IA · 재사용 컴포넌트 · 재설계 원칙

Status: **AUDIT + 원칙** · 2026-08-24 · Demo Core Experience v1의 §2 산출물
도구: UI UX Pro Max (`--domain product|ux|chart`) + 저장소 직접 감사
제품 정의: `docs/demo_core_experience_v1.md` · IA 계약: `docs/product_assembly_ia_v1.md`

새 디자인 시스템을 처음부터 발명하지 않는다. **현재 shell/frame에서 좋은 부분은 유지**하고,
없는 층(계층·밀도·차트·표)만 더한다.

---

## 1. 현재 IA — 실제 라우트

```
운영     /  ·  /reviews  ·  /inquiries  ·  /orders
참고     /reports  ·  /memory                        (메뉴에 없음, 홈/설정에서만)
연결·설정 /connect (+7 하위)  ·  /settings (+1)
숨김     /agent                                       (메뉴에 없음)
```

**감사 결과 1 — 상품 화면이 존재하지 않는다.** 라우트도 메뉴도 없다. 백엔드에는
`/api/products`, `/api/products/{id}/knowledge`, `/api/products/{id}/signals`,
`/api/products/{id}/facts`가 있고 REAL 상품이 300개 있는데, 판매자는 상품을 하나도 볼 수 없다.
Agent만 상품을 안다. Demo Core Experience의 §7(Product page)은 정리가 아니라 **신설**이다.

**감사 결과 2 — 첫 화면에 운영 숫자가 하나도 없다.** `/`(HomeV2)는 「오늘 확인하거나 조치할 일」
텍스트 목록 + 버튼 2개(128줄). KPI 0, 차트 0. 매출·주문은 `/orders`에만, 그것도 메뉴 4번째.
`HomeV2`의 주석이 그 의도를 명시한다: *"There is no 이번 주 흐름 and no metric nobody has
verified is derivable."* — 정직했지만, 데모 제품의 첫 화면으로는 비어 있다.

**감사 결과 3 — Agent가 메뉴에서 의도적으로 빠져 있다.** `nav.v2.ts` 주석: *"an action offered
inside the operations screens, not a destination"*. 그런데 실제로는 어느 운영 화면에서도
Agent를 열 수 없다. 즉 **의도된 진입점이 구현되지 않은 채 목적지만 감춰졌다.** `/agent`(1001줄)는
URL을 아는 사람만 쓴다.

## 2. 재사용 컴포넌트 — 두 세대가 공존한다

| 세대 | 위치 | 구성 | 시각 |
|---|---|---|---|
| v2 (현재 shell) | `components/ui/` | `PageHead` `Panel` `Card` `Btn` `Chip` `Empty` `Toolbar` `Spinner` | 테두리만, 그림자 없음 |
| v1 (잔존) | `components/` 루트 | `Section` `StatCard` `Charts(TrendBars/ShareBars)` `EmptyState` | `.card` = 그림자 있음 |

**감사 결과 4 — 카드 관용구가 두 개다.** `Panel`(테두리)과 `Section`(`.card`, 그림자)이 같은
"제목 있는 구역"을 서로 다른 무게로 그린다. 빈 상태도 `Empty`와 `EmptyState` 둘. 한 앱에서
`/`는 `Panel`, `/orders`는 `Section`을 쓴다.

**감사 결과 5 — 차트는 있지만 한 화면에만 있다.** `TrendBars`·`ShareBars`는 `/orders` 전용이고
div 높이 기반이라 축·눈금·접근성 대체 표가 없다. UI UX Pro Max 권고: 시계열은 **line/area
(<1000점이면 SVG)**, 카테고리 비교는 **내림차순 정렬 + 값 라벨 상시 노출**, 그리고
**색 이외의 구분과 표 대체본**(A11y fallback)이 필요하다.

**유지할 것 (좋은 부분):** Toss-계열 토큰(`brand/canvas/ink/muted/line/good/warn/bad`), 40–50대
운영자를 위한 큰 타입 스케일(base 17px), `AppShellV2`의 skip-link·`NAV_GROUPS` 단일 IA 모델·
mobile 탭이 같은 모델에서 파생되는 구조. **이 셋은 건드리지 않는다.**

## 3. 제기된 5개 문제 — 증거

| 문제 | 증거 |
|---|---|
| 글자가 너무 많음 | `PageHead.description` + `Panel.description` + 본문 문장이 화면마다 3중. `/orders`의 「운영 인사이트」는 문장 리스트이고 숫자가 없다 |
| 카드들이 같은 중요도 | `space-y-6`으로 `Panel`을 세로로 나열 — 1차/2차 구역의 시각 차이가 0 |
| 구분이 약함 | 그룹 헤더 없음, 구역 사이 구분선 없음, 카드 배경이 전부 `bg-surface` |
| 작은 버튼이 너무 많음 | `/connect` 9개, 홈 「참고」 패널은 `size="sm" variant="outline"` 버튼 2개가 목록 항목 역할 |
| 개발/진단 정보가 섞임 | `/connect/imports/*`(Operations·OperationsHome)가 사용자 라우트, 홈이 fixture preview 분기를 렌더, 인박스 상세에 내부 상태 문자열 노출 |

## 4. 재설계 원칙 (R1–R8)

**R1. 화면은 3층이다.** `PRIMARY`(그 화면의 답) → `SUPPORTING`(분해·추이) → `REFERENCE`(참고).
층은 시각으로 구분된다: PRIMARY는 흰 카드 + 큰 숫자, SUPPORTING은 테두리 카드,
REFERENCE는 배경 없는 목록. **한 화면에 PRIMARY는 하나뿐이다.**

**R2. 숫자가 문장보다 먼저 온다.** 설명은 숫자 아래 한 줄. `description`은 화면당 최대 1개
(`PageHead`만). `Panel.description`은 그 패널이 왜 있는지 모를 때만.

**R3. 버튼은 1 primary + n quiet.** 화면마다 primary CTA는 하나. 나머지는 링크나 목록 행이며
버튼처럼 보이지 않는다. 목록 항목은 **행 전체가 클릭 대상**이지, 행 안의 작은 버튼이 아니다.

**R4. 표는 표로 그린다.** 큐·목록은 `<table>`(정렬·필터·고정 헤더). div 나열이 아니다.

**R5. 차트는 SVG, 그리고 표 대체본을 가진다.** 시계열 = area+line, 비교 = 내림차순 bar.
모든 차트에 `<table class="sr-only">` 데이터 표를 함께 낸다 (UI UX Pro Max A11y fallback).

**R6. 상태 어휘는 하나다.** `ChannelDataState`(FRESH/STALE/ZERO/NOT_SUPPORTED/BLOCKED/
NOT_CONNECTED)를 화면에서도 그대로 쓴다. **BLOCKED는 차트의 0이 아니다** — 계열에서 빠지고
그 사실이 적힌다.

**R7. 진단은 진단 표면으로.** 개발/운영 내부 정보(fixture preview, import 실행 로그, 내부 상태
문자열)는 기본 화면에서 제거하거나 `/settings` 아래 secondary로 옮긴다.

**R8. Agent는 화면의 일부다.** 모든 운영 화면에 같은 진입점 하나. 현재 화면의 컨텍스트를
**structured context**로 넘긴다 — planner에게 사실처럼 주입하지 않고, evidence 계약은 그대로.

## 5. 컴포넌트 결정

**추가** (`components/ui/`): `Metric`(KPI + 델타 + 상태) · `MetricGrid` ·
`TrendChart`(SVG area+line, 표 대체본) · `BarChart`(내림차순, 값 라벨) ·
`DataTable` · `SectionHeader`(그룹 구분) · `InsightList` · `AgentLaunch`.

**통합:** `Section` → `Panel` (한 관용구), `EmptyState` → `Empty`.
`StatCard`/`Charts`는 `Metric`/`TrendChart`로 대체하고 호출부를 옮긴다.

**변경 안 함:** 토큰, 타입 스케일, `AppShellV2`, `NAV_GROUPS` 모델, skip-link, mobile 탭 파생.

## 6. 이 감사가 만든 작업 항목

1. `/` 를 Overview Dashboard로 (KPI 6 · trend 3 · channel breakdown · AI Insights)
2. `/products`, `/products/:id` **신설** + 메뉴 「상품」 추가
3. Agent 전역 진입점 (`AgentLaunch`) — 홈·상품·문의·리뷰
4. `/inquiries`, `/reviews` 를 표 + 필터 + 초안 자리로
5. 카드 관용구 통합, 차트 프리미티브 신설
6. `/connect/imports/*` 등 진단 표면 정리

---

## 7. After — 실제로 달라진 것 (2026-08-24)

| 화면 | Before | After |
|---|---|---|
| `/` | 「오늘 확인하거나 조치할 일」 텍스트 목록 + 버튼 2개 (128줄, KPI 0, 차트 0) | **운영 현황** — KPI 6 · 추이 3(매출/주문, 문의/미답변, 리뷰/부정) · 채널 breakdown 표 · AI Insights 5 · 「이 숫자에 대하여」 |
| `/products` | **없음** | 상품 목록 (서버 검색, 표) |
| `/products/:id` | **없음** | 핵심 수치 4 · 채널 리스팅 · 반복 문제 · **상품 지식(쓰기)** · 보유 정보 coverage |
| `/inquiries` | 큐 3패널 | 그대로 + **Agent 진입점**(현재 채널 필터를 structured context로) |
| `/reviews` | 계정 스위처 + 기록 | 그대로 + **Agent 진입점** |
| `/agent` | 빈 입력창 | 들어온 화면의 **제안 문장이 입력창에 채워진 채** 열림 (전송은 사람이) |
| 메뉴 | 홈·리뷰·문의·주문 | 홈·**상품**·리뷰·문의·주문 |

**제거한 것:** `HomeV2`(홈이 대시보드가 되면서 대체됨) · `TodayInbox` · 홈의 fixture-preview 분기
(개발용 상태가 사용자 화면에 렌더되던 자리) · 홈의 Action Window 실행 카드 → 그것이 속한
`채널 연결`에만 남김(중복 아님: `ConnectHub`가 이미 같은 카드를 렌더한다).

**신설 컴포넌트** (`components/ui/`): `Metric` · `MetricGrid` · `TrendChart`(SVG + `sr-only` 데이터 표) ·
`DataTable`/`Th`/`Td` · `SectionHeader` · `InsightList` · `DataStateBadge` · `AgentLaunch`,
그리고 `lib/agentContext.ts`(구조화 컨텍스트, 사실 주입 아님).

**Primary CTA:** 화면당 하나. `/` 는 기간 선택(+ 각 KPI가 자기 화면으로 가는 클릭 대상),
`/products/:id` 는 「지식 추가」, 나머지는 기존 흐름 유지.

**원칙 적용 결과:** R1(3층) `/`·`/products/:id` 적용 · R2 설명문 화면당 1개 · R3 목록 행이 클릭 대상 ·
R4 큐·breakdown이 `<table>` · R5 차트마다 표 대체본 · R6 `ChannelDataState` 어휘 그대로 ·
R7 홈에서 진단 제거 · R8 4개 화면에 같은 Agent 진입점.

**미적용(정직하게):** `Section`/`Panel` 관용구 통합과 `EmptyState`/`Empty` 통합은 **하지 않았다** —
기존 화면 다수를 건드리는 변경이라 이 package에서 분리했다. 새 화면은 전부 `Panel` 계열만 쓴다.
`/reviews`의 자체 trend, `/inquiries`의 표 재작성도 미실시.
