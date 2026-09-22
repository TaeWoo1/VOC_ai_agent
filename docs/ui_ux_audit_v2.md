# UI/UX Audit v2 + v2 IA 제안 (2026-09-22)

> **갱신(같은 날):** §8-1이 승인됐고(freeze = 제품 의미·상태 계약 freeze) Phase 1이 구현됐다 — **§9**. §0~§8은
> 승인 전의 감사·제안 기록으로 그대로 둔다.

**§0~§8은 감사와 제안이고, 그 시점의 코드 변경은 0이었다.** 기준 커밋은 `b9ba02b6`(branch `feat/review-decision-workspace-v1`)이다. backend, 제품 로직, 상태의 의미,
Demo Core freeze 계약(`docs/demo_core_experience_v1.md` §12)은 하나도 건드리지 않는다. 아래 제안도
**표현(배치·위계·어휘·컴포넌트)**만 다룬다. 새 판정, 새 우선순위 기준, 새 화면 capability는 없다.

> **범위 충돌을 먼저 보고한다.** 직전 작업 지시는 「Demo Core UI는 건드리지 마」였고, §12는 일곱 화면을
> 얼렸다. 이번 지시는 「Demo Core의 **상태 의미**는 유지하되 UI/UX를 정리」다. 이 문서는 두 지시를 이렇게
> 읽는다: **freeze는 의미와 계약을 얼린 것이고, 표현 변경은 새 결정으로 연다.** 이 해석이 맞는지는
> **product-owner 결정**이다(§8-1). 확인되기 전까지 Phase 1(Demo Core 일곱 화면)은 착수하지 않는다.

---

## 0. 방법

- **대상**: 인증 셸의 route 49개(App.tsx), legacy redirect 11개, nav(`lib/nav.v2.ts`).
- **코드 감사**: 각 route마다 페이지 파일, 줄 수, 진입 경로(비테스트 링크의 file:line), 사용하는 primitive와
  손으로 만든 마크업, solid 버튼과 박스 수를 적었다.
- **렌더 감사**: 로컬 스택(이 worktree의 frontend :5173과 backend :8080, 기동 12:37)에서 Demo Org로
  34개 화면을 Playwright 1440×900으로 찍었다. 셸은 내부 스크롤 컨테이너를 쓰므로 그 컨테이너를 기준으로
  다음을 쟀다: 스크롤 높이, 테두리+radius 박스 수와 중첩 수, solid primary 버튼 수와 위치,
  h1/h2/h3, 13px 이하 글자 비율, `…다./…요.` 문장 수, 컨트롤 수.
- **기록하지 않는 것**: 스크린샷에는 실제 고객 문장이 있어 scratchpad에만 두고 저장소에는 넣지 않는다.
  마켓플레이스 호출 0 · WRITE 0 · DB 변경 0이다. agent-runtime(8787)을 띄우지 않아 **모든 화면에 콘솔
  오류 2건**이 나고, 알려진 원인이라 결함으로 세지 않았다.
- **backend 버전**: 기동 시각이 G1 커밋보다 앞선다. 그래서 `/customer-operations`는 옛 source 목록
  (Cafe24 둘)을 그린다. 이 감사는 read-only 렌더 감사라 재기동하지 않았다. 표현 결론에는 영향이 없다.

## 1. 원칙을 합격선으로 옮긴다

「모두의 창업」 여섯 원칙은 그대로 두면 누구나 지켰다고 말할 수 있다. 그래서 각 원칙을 **화면에서 잴 수 있는
기준**으로 바꿨다. 기존 `docs/reviewnary_design.md`(v3)의 타입 스케일(base 16), 간격, 색은 바꾸지 않는다.

| 원칙 | 합격선 (화면마다) |
|---|---|
| 큰 글자와 충분한 여백 | 13px 이하 글자 **≤ 15%**. 판매자가 이 화면에 온 이유가 되는 문장(고객 문장, 초안)이 **화면에서 가장 큰 본문**. 행 간격은 `reviewnary_design` §3 스케일 안 |
| 카드형이되 정보 과밀 금지 | **중첩 박스 0**. 행 하나는 **최대 3줄**(상태 · 제목 · 메타 1줄). 같은 사실은 한 번만 |
| 첫 화면은 「오늘 무엇을」 | 1440×900 첫 fold 안에 **해야 할 일의 수와 첫 번째 일**이 보인다. 시스템 상태는 그 아래 |
| overview → detail | 목록의 행은 **문**이고 방이 아니다. 상세 사실은 상세 화면에만 있고, 보조 사실은 기본 접힘 |
| primary action은 하나 | **solid 버튼 ≤ 1**. 반복되는 행 안에는 solid 0(행 전체가 링크) |
| workflow 중심 | 첫 분기가 **일의 상태**다(확인할 일 / 실행 대기 / 기록). 채널은 필터이고 탭이나 목적지가 아니다 |

## 2. Route 지도: 무엇이 어디에 숨어 있나

49개 route를 **판매자가 실제로 도달하는 방식**으로 나눴다. 근거가 되는 file:line은 부록 A에 있다.

| 층 | route | 도달 |
|---|---|---|
| **매일** (nav 운영) | `/` · `/customer-operations/cases` · `/products` · `/reviews`(→`/reviews/:첫계정` 자동 redirect) · `/inquiries` · `/orders` | nav |
| **객체 상세** | `/customer-operations/cases/:id` · `/reviews/reply/:id` · `/inquiries/:id` · `/products/:id` · `/memory/:id` | 목록 행 |
| **Demo Core인데 nav 밖** | `/memory`(반복 문제 전체) | 홈 「반복 문제 전체 보기」 · 설정 「더 보기」 |
| **설정** (nav 연결·설정) | `/knowledge` · `/connect` · `/settings` + `/settings/*` 6개 | nav → 1클릭 |
| **버튼 뒤의 오래된 화면** | `/customer-operations`(고객 운영 관리) · `/overview`(운영 숫자) · `/reports` · `/connect/imports` · `/connect/imports/current` · `/connect/upload` · `/connect/review-history` · `/connect/channels/:id` · `/connect/channels/:id/review-collection` · `/settings/alerts` | 페이지 안 링크 한 곳 또는 두 곳 |
| **ORPHAN** (셸 안에서 링크 0) | `/agent`(`AgentLaunch`가 패널 provider가 있으면 링크를 그리지 않는데, 셸은 항상 provider를 준다) · `/inbox` · `/inbox/:ref` · CO 홈이 켜진 조직의 `/overview` | 북마크뿐 |

**죽은 코드**(비테스트 importer 0): `ui/Card`, `ui/InsightList`, `ui/Toolbar`, `components/StatusPill`,
`components/DataBadge`, `inbox/InboxList`, `inbox/InboxFilterRail`, `lib/homeActions.ts`, `lib/todayInbox.ts`의
`build*Today` 셋.

**시각 어휘가 셋 공존한다.**

- **(a) v2**: `rounded-2xl border`로 쓰는 ui/Section · ListBox · Panel.
- **(b) legacy**: `.card` · `shadow-card` · `.btn-primary`(61곳). `/agent`, Cafe24/NAVER/쿠팡 연결, 가져오기 화면들,
  ChannelWorkspace의 모든 섹션, 알림 설정이 여기에 속한다.
- **(c) 최신 Customer-Ops**: ring shadow · `rounded-[14px]` · `text-[25px] font-extrabold`의 손으로 만든 h1.
  홈, 케이스, 지식이 여기에 속한다.

이 어휘 차이 때문에 판매자는 같은 제품 안에서 화면마다 다른 앱을 쓰는 것처럼 느낀다.

## 3. 측정값 (1440×900, Demo Org)

| 화면 | 스크롤 높이 | 박스(중첩) | solid | ≤13px | 문장 | 비고 |
|---|---|---|---|---|---|---|
| 홈 `/` | 1,688 | 3 (0) | 1 | 12% | 4 | composer와 칩 4개가 아래 ~160px를 항상 덮는다 |
| 확인할 일 | 3,052 | 0 | 1 | **37%** | 9 | 27행, 행마다 「검토」 버튼 |
| Inquiry Case | 900 | 1 | 1 | 10% | 6 | 양호. 기준 화면 |
| **Decision Workspace** `/reviews/reply/:id` | 1,072 | 1 | **0** | 0% | 13 | 본문 **91%가 15px 한 크기** |
| 리뷰 기록 | **4,830** | 4 | 1 | 5% | **38** | 채널 탭이 첫 분기 |
| 문의 | **5,769** | 0 | 0 | 0% | 39 | |
| 문의 상세 | **7,071** | 3 (2) | 1 | 0% | 45 | 높이는 목록 rail의 것 |
| Memory `/memory` | 2,155 | 2 | 0 | **77%** | 2 | 첫 화면의 2/3가 빈 상세 칸 |
| Memory 상세 | 2,155 | 4 (2) | 1 | **47~51%** | 9~11 | primary는 네 번째 화면 |
| 고객 운영 관리 | 1,074 | 4 (1) | 0 | 2% | 5 | |
| 리뷰 답변 문구 | 2,638 | 15 (7) | **7** | 17% | 16 | 「저장」 7개 |
| 알림 설정 | 921 | 15 (**9**) | 0 | 0% | 21 | |
| AI 답변 스타일 | 1,502 | 16 (**10**) | 1 | 0% | 18 | |
| 자료 업로드 | 1,947 | 3 (1) | **3** | 0% | 1 | 선택 칩이 solid |

## 4. 발견: 원칙별이 아니라 **판매자가 부딪히는 순서**로

### P0: 판매자가 틀리게 읽는 것 (의미는 맞는데 표현이 오독을 만든다)

**P0-1. 같은 일에 이름이 셋이다.**

- nav는 「**확인할 일**」, 그 화면의 h1은 「**확인 필요**」(OperationsCaseQueue.tsx:10), 홈 카드는 「**내 확인 필요**」다.
- 반복 문제도 같다. 홈 섹션은 「**반복 문제**」, 목적지 h1은 「**고객운영 메모리**」, 데모 대본은 「Memory」다.
- 판매자는 링크를 누르고 도착한 곳이 자기가 누른 그곳인지 확인할 수 없다.

**P0-2. 「승인 대기」와 「실행 대기」가 다른 두 목록인데 같은 4건으로 보인다.**

- 홈의 「실행 대기 · 승인한·등록 전」 4건은 승인이 끝난 것이다(09-01, 08-28, 03-25, 02-01).
- `/reviews`의 「내 답변 작업 · **승인 대기** 4건」은 승인을 기다리는 것이다(08-28, 08-22, 06-16, 05-21).
- 반대 상태인데 한 글자만 다르고, 건수가 우연히 같다.

**P0-3. 화면마다 숫자가 다르다.** 이 감사는 정의가 서로 다르다는 것을 확인했을 뿐 틀렸다고 판정하지 않는다.
다만 판매자에게는 **라벨이 그 차이를 말하지 않는다**.

| 숫자 | 홈 | 목적지 | 다른 화면 |
|---|---|---|---|
| 확인 필요 리뷰 | 3 | `/reviews` 탭 「확인 필요 14」 | |
| 답변 필요 문의 | 24 | `/inquiries` 24 | `/overview` 「현재 미답변」 25 · `/reports` 25 |
| 판매자 결정 | 27 | 확인할 일 27 | `/customer-operations` 「내 결정 필요 **1건**」 |

(홈의 리뷰 3은 `mergeHomeWork`의 dedupe와 소유 화면 규칙에서 나오고, freeze된 계약이다. 고칠 대상은 숫자가 아니라
**라벨**이다. 예: 「확인 필요 리뷰 14건 중 오늘 목록에 올라온 3건」. 문구 변경도 freeze 해석 §8-1에 걸린다.)

**P0-4. Decision Workspace에서 「지켜보기」가 두 뜻으로 두 번 나온다.**

- 「판매자 판단」 줄은 `확인 필요 / 지켜보기 / 참고`로 tier를 고른다.
- 바로 아래 「무엇을 하시겠어요?」 줄은 `대응 필요 / 지켜보기 / 조치 불필요`로 disposition을 고른다.
- 같은 낱말, 같은 모양의 버튼, 다른 저장소에 다른 의미가 기록된다(`SellerCorrectionControls` vs
  `DecisionActionStep`). 판매자는 둘 중 하나만 누르고 끝났다고 믿기 쉽다.

**P0-5. 같은 문의가 두 개의 상세 화면을 가진다.** 「교환 신청은 언제까지 가능한가요?」는
`/customer-operations/cases/:id`(케이스 레이아웃, primary 「발송 화면으로」)와 `/inquiries/:id`(받은함
레이아웃, primary 「초안 복사」) 양쪽에 있다. 두 화면은 구조가 다르고 primary도 다르다. 어느 쪽이
정본인지 화면이 말하지 않는다.

### P1: 위계가 깨진 곳

**P1-1. Decision Workspace(Review Case)**: 판단 화면인데 판단할 대상이 가장 작다.

- h1 자리에 「리뷰 처리」와 **긴 상품명 전체**가 온다. 고객 문장 「버튼 누르면 종이컵 두개씩 나옴」은 16px 본문이고,
  바로 아래 「1점 / 내용을 읽고 상품 상태를 확인해 보세요」 인용 블록이 무엇인지 설명이 없다.
- 섹션 11개가 전부 같은 무게다: 고객 내용 · 채널 답변 상태 · 반복 신호 · 우리가 아는 것 · 판매자 판단 ·
  무엇을 하시겠어요 · 답변 준비 · 기록. 여기에 **설명 문장 13개**가 붙는다. 「마켓플레이스에는 아무것도
  전송되지 않습니다」는 두 번 나온다.
- **solid primary가 0개**다. 초안은 「대응 필요」를 고르기 전까지 없다. 그래서 첫 화면만 보고는 무엇을 누르는
  화면인지 알 수 없다.
- 뒤로 가기가 「← 리뷰 기록으로」로 고정이다. 홈이나 확인할 일에서 왔어도 채널 기록으로 돌려보낸다.

**P1-2. 홈**: 순서(자동 확인 → 내 확인 필요 27 → 확인 필요 5줄 → 실행 대기 → 반복 문제)는 옳다.
다만 네 가지가 흐린다.

- (a) 대화 composer와 예시 칩 4개가 화면 아래 **~160px를 항상 덮는다**. 900px 중 18%가 「오늘 할 일」이 아닌 입력에 쓰인다.
- (b) 사이드바 최상단이 「대화 · 지난 대화가 없습니다」다. nav보다 위에 **빈 것**이 있다.
- (c) 「정리 0 · 관찰 0 · 초안 1 (미발송)」은 내부 어휘다.
- (d) 확인 필요 5줄 뒤의 「**+22**」는 무엇이 22인지 말하지 않는다.
- 실행 대기 4행은 「승인된 리뷰 답변 ›」을 네 번 반복한다.

**P1-3. 확인할 일**:

- 27행 전부에 같은 「검토」 버튼이 있다(첫 행만 solid). 행 자체가 이미 링크이므로 버튼 27개는 중복이다.
- 「답변 초안 없음」과 채널명이 매 행 13px로 반복되고, 이 화면 글자의 37%가 13px다.
- 10년 된 백로그 행(「3,839일 대기」)이 이번 해 행과 **같은 무게**로 이어진다. freeze 계약은 두 그룹이지만
  화면에서 경계가 약하다.

**P1-4. Memory**:

- 첫 진입에서 오른쪽 2/3가 「왼쪽에서 이슈를 고르면…」 빈 칸이다.
- 목록 행은 「조치 중 · 심각도 보통 / 근거 18건 · 마지막 확인」처럼 **메타가 제목보다 많고**, 전체 글자의 77%가 13px다.
- 상세는 h3 섹션 8개를 한 줄로 쌓고, 유일한 행동(「조치 완료로 기록」)은 네 번째 화면에 있다.
- 「접착 부족 · 접착 탈락 · 접착 누락」처럼 비슷한 이름이 나란히 선다. 이것은 데이터이고 추출기의 것이라 표현으로 고치지 않는다.

**P1-5. 리뷰 기록**:

- **채널이 첫 분기다.** `/reviews`는 첫 계정으로 redirect하고, 제목 옆 채널 탭이 화면을 나눈다. nav.v2.ts가 적은
  「workflow-centric」과 반대다.
- 행 하나가 5줄이다: 상태 · 별점(★ + 「2점」) · 날짜 / 고객 문장 / 상품 / 분류 문장 / 「2점 · 설치 · 같은 분류 218건」.
  **별점을 세 번** 말한다. 「내용을 읽고 상품 상태를 확인해 보세요」는 행마다 같은 문장이다.
- 「작업에서 제외」 밑줄 링크가 행마다 있다.
- 4,830px, 문장 38개.

**P1-6. 문의**: 목록 자체는 괜찮다(상태 · 채널/상품 · 고객 문장). 문제는 상세가 **목록 rail과 한 페이지로
스크롤**해서 7,071px가 된다는 점이다. 판매자는 상세를 보다가 스크롤하면 목록이 움직이는 것을 본다.

**P1-7. 고객 운영 관리 `/customer-operations`**:

- 이 화면의 일은 **설정**(맡기기 · 일시정지 · 중지 · 주기)이다. 그런데 「내 결정 필요」, 「정리하거나 준비한 일」,
  「제대로 확인하지 못한 곳」을 다시 그려 **세 번째 홈**이 됐다.
- h1 「고객 운영 관리」 아래 카드 h2도 「고객 운영 관리」다. 도달 경로는 홈의 「운영 중」 pill 하나뿐이다.

### P2: 버튼 뒤의 오래된 화면

| 화면 | 상태 | 증상 |
|---|---|---|
| `/agent` 정해진 작업 | ORPHAN | legacy 어휘(.card · btn-primary ×4 · btn-ghost ×7). 대화는 홈으로 옮겨 갔다 |
| `/overview` 운영 숫자 | CO 홈에서는 ORPHAN | 네 KPI마다 경고색 「채널 N곳이 이 숫자에 없습니다」. v2 어휘라 살릴 가치가 있다 |
| `/reports` | 설정 「더 보기」에서만 | v2이고 내용은 좋다. 도달이 문제다 |
| `/connect/imports` · `/current` | 링크 한 곳 | 「일부만 저장됐어요 · 새 리뷰 0건」이 경고색으로 수십 번 반복된다. WorkbenchLayout과 legacy PageHeader를 쓴다 |
| `/connect/upload` | 링크 셋 | 2026-07-07 이후 무변경. 선택 칩 셋이 solid라 primary처럼 보인다 |
| `/connect/review-history` | 링크 셋 | `shadow-card`와 raw h1 |
| `/connect/channels/:id` | 링크 여럿 | 모든 섹션이 legacy `components/Section`(.card) |
| `/settings/alerts` | 셸 신호 · 설정 | 카드 격자 15개(중첩 9). 해결된 알림도 같은 카드로 남는다 |
| `/settings/review-templates` · `/style` | 설정 | 「저장」 solid 7개. 중첩 박스 7~10 |

## 5. v2 IA 제안

### 5-1. 원칙: 세 층, 한 문법

```
오늘      ─ 무엇이 기다리나 (홈)                        ← 매일 1번째 화면
일        ─ 확인할 일 · 반복 문제                        ← 판매자의 결정이 필요한 것
기록      ─ 상품 · 리뷰 · 문의 · 주문                    ← 이미 아는 객체를 찾을 때
준비      ─ 채널 연결 · 지식 · 설정                       ← 가끔
```

**모든 목록 → 상세는 같은 문법이다.** 목록 행은 문이고, 상세는 **Case 레이아웃 하나**를 쓴다
(Inquiry Case, Review Case, 반복 문제 상세).

### 5-2. nav (제안)

| 그룹 | 항목 | 현재와의 차이 |
|---|---|---|
| (없음) | **오늘** `/` | 라벨만 「홈」→「오늘」 *(PO 결정)* |
| 일 | **확인할 일** `/customer-operations/cases` | h1도 「확인할 일」로 이름을 하나로 |
| 일 | **반복 문제** `/memory` | **nav에 추가**. h1 「고객운영 메모리」→「반복 문제」. Demo Core 7화면 중 nav 밖에 있던 유일한 화면 |
| 기록 | 상품 · 리뷰 · 문의 · 주문 | 그대로. 리뷰는 채널 탭 대신 **채널 필터**(§6-5) |
| 준비 | 채널 연결 · 지식 · 설정 | 그대로. **고객 운영 관리**는 설정 아래 첫 행으로 이동하고 홈 pill 링크는 유지 |

사이드바의 「대화 / 지난 대화」는 nav **아래**로 내린다. 대화는 기능이고 목적지가 아니다.

### 5-3. 오래된 화면 처리 (삭제 0, 제안만)

| 화면 | 제안 |
|---|---|
| `/overview` | **설정 ›「숫자와 리포트」**로 `/reports`와 함께 모은다. 홈의 CO branch에도 「자세한 숫자」 텍스트 링크 1개 |
| `/reports` | 위와 같음 |
| `/customer-operations` | 설정 아래 「고객 운영 관리」로 옮기고, **설정만** 남긴다. 결정·예외 목록 렌더를 빼고 「확인할 일 N건 →」 한 줄로 대체 |
| `/connect/imports*` · `/upload` · `/review-history` · `/channels/:id` | 채널 연결 아래에 그대로 두고, Phase 3에서 v2 primitive로 **재조립**(동작 무변경) |
| `/agent` | ORPHAN. 제거 또는 유지는 **PO 결정**(§8-4). 유지하면 legacy 어휘만 교체 |
| `/inbox*` redirect | 북마크 호환. 유지. legacy map 제거 시점은 기존 결정(Slice 6 이후)을 따른다 |

## 6. 화면 구조 (v2)

모든 구조는 **기존 데이터와 기존 컴포넌트의 재배치**다. 새로 읽는 API는 0이다.

### 6-1. 오늘 `/` (CO branch)

```
오늘 · 9월 22일 화 · ● 자동 확인 중 (다음 02:00)            ← 한 줄, 시스템 상태는 작게
┌──────────────────────────────────────────────────────────┐
│ 지금 확인할 일  27건                    [첫 번째 일 열기] │ ← 유일한 solid
│ 답변 필요 24 · 리뷰 3                                      │
├──────────────────────────────────────────────────────────┤
│ ☆ 리뷰 ★1  버튼 누르면 종이컵 두개씩 나옴         200일 대기│ ← 행 = 링크, 버튼 0
│ ☆ 리뷰 ★1  컵보관함은 좋은데 컵수거함은 …         102일 대기│
│ …(5행)                                                     │
│ 나머지 22건 모두 보기 →                                    │ ← 「+22」 대체
└──────────────────────────────────────────────────────────┘
실행 대기 4건 · 승인한 답변, 판매자센터 등록 전               ← 공유 낱말은 제목에서 한 번
  선바로 일체형 전선몰드 · 9월 1일 ›
반복 문제 · 판단이 필요한 것 1건 · 지켜보는 것 1건 →
─────────────────────────────────────────────
[무엇이든 물어보세요 …]                                       ← 한 줄, 칩은 스레드가 비어 있고
                                                               스크롤이 끝났을 때만
```

- 「자동 확인 1건 → 내 확인 필요 27건」 2칸 카드는 **첫 번째 칸이 판매자 일이 아니다**. 자동 확인은 상단
  상태줄로 옮기고, 「정리 0 · 관찰 0 · 초안 1(미발송)」은 hover나 disclosure로 보낸다.
- composer는 docked를 유지하되 **예시 칩을 fold 아래**로 보낸다. 칩 4개가 매일 아침 반복되는 것은 첫 사용자에게만 의미가 있다.

### 6-2. 확인할 일

```
확인할 일  27건 · 오래 기다린 순
[전체 27] [문의 24] [리뷰 3]                                  ← 필터 (새 기준 아님, 기존 kind)
────────── 올해 들어온 것 7건 ──────────
행(3줄 이내, 버튼 없음)
────────── 1년 넘게 기다린 것 20건 (접힘) ──────────           ← freeze의 두 그룹을 눈에 보이게
```

### 6-3. Case 레이아웃: Inquiry Case와 Review Case를 한 모양으로

```
← 확인할 일 (들어온 곳으로)                                  ← from 파라미터; 없으면 기록
[리뷰 · 네이버 · ★1 · 200일 대기]                           ← 메타 한 줄
“버튼 누르면 종이컵 두개씩 나옴”                             ← 가장 큰 본문 (lg)
상품: 원터치 디스펜서 … (링크)

┌ 확인한 것 ───────────────┐  ┌ 판매자의 결정 ─────────────┐
│ 자동 분류: 확인 필요 · 이유 │  │ ① 분류   확인 필요|지켜보기|참고│ ← 라벨로 두 줄을 구분
│ 반복 신호: 아직 없음        │  │ ② 처리   대응 필요|지켜보기|불필요│
│ 우리가 아는 것: 기준 2건    │  │ ─ 답변 초안 (대응 필요 시)   │
└───────────────────────────┘  │ [승인]  ← 유일한 solid       │
                                └──────────────────────────────┘
▸ 근거·분류 기준·기록 (접힘)
```

- Inquiry Case(`OperationsCase.tsx`)가 이미 이 모양에 가장 가깝다. 이것을 **기준**으로 삼아
  Review Case(`ReviewReplyTask.tsx`)를 같은 두 칸으로 옮긴다.
- **P0-4 해법은 문구와 배치뿐이다.** 두 컨트롤을 한 결정 패널 안에 번호와 라벨(「분류」/「처리」)로 묶는다.
  저장 경로, 선택지 값, 판정은 무변경이다. 「지켜보기」 낱말을 바꿀지는 어휘 결정이고 §8-3에 올린다.
- 반복되는 안전 문장(「마켓플레이스에는 전송되지 않습니다」)은 결정 패널 하단에 **한 번만** 둔다.
- `/inquiries/:id`는 같은 레이아웃 컴포넌트를 쓴다(P0-5). route는 둘 다 유지한다.

### 6-4. 반복 문제 `/memory`

- 첫 진입은 **목록만 전체 폭**으로 보여 준다(판단 필요 · 지켜보는 중 · 잠잠 그룹). 행은
  `제목 · 근거 N건 · 상태 단어` 한 줄이고, 심각도와 마지막 확인은 상세로 보낸다.
- 상세는 Case 레이아웃을 쓴다. 왼쪽 「확인한 것」에는 어디서 · 별점 분포 · 근거 3개를, 오른쪽
  「판매자의 결정」에는 판단 입력과 **조치 버튼**(첫 화면)을 둔다. 나머지(우리가 써 둔 것 · 개선 기회 · 기록)는 접는다.

### 6-5. 리뷰 기록

- `/reviews`는 redirect 대신 **전 채널 목록**을 보여 주고, 채널은 필터 칩이 된다. 기존 계정 단위 읽기를
  계정별로 부르는 것이므로 **backend 변경 없이 가능한지는 확인이 필요**하다. 불가능하면 탭을 유지하고
  탭을 필터 모양으로만 바꾼다(§8-5).
- 행은 3줄이다: `상태 · ★N · 날짜` / 고객 문장 / 상품. 「같은 분류 N건」과 분류 문장은 상세로 보낸다.
- 「내 답변 작업」은 제목을 **「승인 대기」**로 바꾸고, 홈의 「실행 대기」와 어휘를 짝지어 나란히 설명한다(P0-2).
- 「작업에서 제외」는 행이 아니라 상세로 옮긴다.

## 7. 공통 component 정리 범위

**원칙: 새 디자인 시스템 0 · 새 의존성 0 · 기존 기능 제거 0.** 이미 있는 v2 primitive를 기준으로 삼고,
legacy와 손으로 만든 사본을 그쪽으로 모은다.

| # | 모을 것 | 기준 컴포넌트 | 흡수 대상 (현재 사용처) | 효과 |
|---|---|---|---|---|
| C1 | 페이지 머리 | `ui/PageHead` (21) | legacy `PageHeader` (4) · 손으로 만든 h1 7곳(CustomerOpsHome, KnowledgeHome, OperationsCase, ReviewCollectionFlow, Upload, ReviewImport, AlertSettings) | h1 크기와 굵기가 하나로(현재 25px extrabold / 24px / text-2xl 셋) |
| C2 | 섹션·카드 | `ui/Section`+`ListBox`, `ui/Panel` | legacy `components/Section`(.card, ~12 파일: ChannelWorkspace 계열·MyReplyWork·Agent·Upload) · ring-shadow 박스(OperationsCase 8, KnowledgeHome 2) · IssueDetailPanel의 raw `<section><h3>` 8개 | 어휘 (b)와 (c)를 (a)로 |
| C3 | **작업 행** | `ui/DecisionRow` | `WorkItem`(9) · `ReplyWorkRow` · CustomerOperationsExceptions의 `ul` · Memory `IssueList` 행 · 리뷰 기록 행 | 3줄 · 행 = 링크 · 반복 행 안 solid 0 · 공유 낱말은 캡션으로(`lib/sharedWord.ts` 재사용) |
| C4 | 상태 단어 | `ui/Status` (27) + `lib/workState.ts` | `TriageTierChip` · `HealthBadge`(4) · 사용 0인 `StatusPill` | 상태 단어 표 하나(P0-1, P0-2의 어휘가 여기서 정해진다) |
| C5 | 요약 두 칸 | `ui/WorkFlowCard` (3) | 홈 · 케이스 · 지식이 이미 사용 | API를 고정하고 「왼쪽 = 시스템, 오른쪽 = 판매자」 규칙을 문서화 |
| C6 | **Case 레이아웃** | 새 **조립 컴포넌트** 1개(`CaseLayout`: header · subject · 확인한 것 · 결정 패널 · 접힘) | OperationsCase · ReviewReplyTask · InboxDetail · IssueDetailPanel | 판단 화면 넷이 한 모양. 내부 로직 컴포넌트(VocItemReplyPrep, InquiryResponsePanel 등)는 **그대로 끼운다** |
| C7 | 빈 상태 | `ui/Empty` (14) | legacy `EmptyState` (1, AlertSettings) | |
| C8 | 버튼 | `ui/Btn` (59) | `.btn-primary` 61곳 · `.btn-ghost` 59곳 · 정의 없는 `btn-secondary` 4곳 · raw `bg-brand text-white` | solid 1 규칙을 코드로 검사 가능 |
| C9 | 지표 | `ui/Metric` | legacy `StatCard` (ChannelSummaryCards) | |
| C10 | 목록/상세 분할 | 새 규칙(컴포넌트 아님): 상세는 **자기 스크롤** | CustomerInbox · CustomerMemory | P1-6의 7,071px 해소 |

**삭제 후보**(importer 0, 확인 후 별도 커밋, `refactors-need-stop-and-report-gates` 원칙):
`ui/Card`, `ui/InsightList`, `ui/Toolbar`, `components/StatusPill`, `components/DataBadge`,
`inbox/InboxList`, `inbox/InboxFilterRail`, `lib/homeActions.ts`, `lib/todayInbox.ts`의 `build*Today`.

**하지 않는 것**: shadcn이나 Radix 도입(Tailwind 3.4 저장소라 조용히 깨진다, `reviewnary_visual_system_v1.md`),
새 색 토큰, 새 서체, 토큰 마이그레이션, backend 변경, 상태 의미 변경, 정렬 기준 변경.

### 7-1. 단계

| Phase | 내용 | 조건 |
|---|---|---|
| 0 | 이 문서 | 완료 |
| 1 | **Demo Core 일곱 화면의 표현**: C3 · C4 · C5 · C6. P0-1~P0-5, P1-1~P1-4 | **§8-1 승인 후**. 각 화면이 §1 합격선을 통과하는지 같은 스크립트로 before/after 측정 |
| 2 | 기록 화면: 리뷰 · 문의 · Memory 분할(C10), 리뷰 행 3줄 | Phase 1 뒤 |
| 3 | 버튼 뒤의 오래된 화면을 v2 primitive로 재조립(C1 · C2 · C7 · C8 · C9) | 동작 무변경. 테스트 계약 유지 |
| 4 | IA 이동(nav 「반복 문제」 추가, 고객 운영 관리와 숫자·리포트를 설정 아래로) · 삭제 후보 정리 | §8-2 승인 후 |

각 Phase의 검증: frontend 전체 테스트, typecheck, 3폭(1440/1366/1152) AA 위반 0, 가로 스크롤 0,
§3 표 재측정.

## 8. product-owner 결정

1. **Demo Core freeze의 범위**: 「의미·계약 freeze」로 읽고 표현 변경을 허용하는가. Phase 1의 전제다.
2. **nav 변경**: 「반복 문제」 추가, 「홈」→「오늘」, 고객 운영 관리와 숫자·리포트를 설정 아래로 이동.
3. **「지켜보기」의 두 뜻**: 라벨로 구분(분류/처리)하는 것으로 충분한가, 아니면 disposition 쪽 낱말을 바꾸는가
   (예: 「나중에 보기」). 낱말 변경은 테스트가 고정한 어휘에 닿는다.
4. **`/agent`**: ORPHAN이다. 제거할지, legacy 어휘만 바꿔 유지할지.
5. **리뷰 기록의 첫 분기**: 채널 탭을 유지하는가, 전 채널 목록으로 바꾸는가(후자는 읽기 방식 확인 필요).
6. **숫자 라벨**(P0-3): 「확인 필요 리뷰 3 vs 14」처럼 정의가 다른 숫자에 범위 문장을 붙이는 것. 숫자 자체는 freeze 계약이다.

---

## 부록 A. route별 진입 근거 (요약)

| route | 페이지 (줄 수) | 진입 (비테스트 file:line) |
|---|---|---|
| `/` | AgentHome (612) + CustomerOpsHome (427) | nav |
| `/customer-operations/cases` | OperationsCaseQueue (123) | nav · CustomerOpsHome.tsx:201 · CustomerOperationsExceptions.tsx:64 |
| `/customer-operations/cases/:id` | OperationsCase (826) | lib/homeWork.ts:79 · CustomerOperationsExceptions.tsx:153 |
| `/customer-operations` | CustomerOperations (290) | CustomerOpsHome.tsx:100, :313 만 |
| `/reviews/reply/:id` | ReviewReplyTask (359) + VocItemReplyPrep (913) | lib/homeWork.ts:102 · ReplyWorkRow.tsx:60 · IssueDetailPanel.tsx:208 · ProductReviews.tsx:183 |
| `/reviews/:accountId` | ChannelReviews (938) | Reviews.tsx:110 (자동 redirect) |
| `/inquiries[/:ref]` | CustomerInbox (537) + InquiryResponsePanel (1149) | nav |
| `/memory[/:id]` | CustomerMemory (128) + IssueDetailPanel (270) | CustomerOpsHome.tsx:419 · SettingsHome.tsx:80 · RepeatedProblemList.tsx:38 |
| `/overview` | Overview (290) | AgentHome.tsx:288,299,303 (legacy branch 전용) |
| `/reports` | ReportsV2 (389) | SettingsHome.tsx:83 만 |
| `/agent` | Agent (838) | 없음 (AgentLaunch.tsx:37-47 · AppShellV2.tsx:44) |
| `/connect/imports` | OperationsHome (201) | ConnectHub.tsx:309 · HomeReviewOpsCard.tsx:60,74 |
| `/connect/imports/current` | Operations (313) | HomeReviewOpsCard.tsx:60 (needsHuman일 때) · ActiveRunCard.tsx:65 |
| `/connect/upload` | Upload (328, 마지막 변경 2026-07-07) | ConnectHub.tsx:297 · ChannelList.tsx:119 · ChannelWorkspace.tsx:371 |
| `/settings/alerts` | AlertSettings (235) | ConnectionSignal.tsx:24 · SettingsHome.tsx:71 · ConnectHub.tsx:244 |
| `/inbox/:ref` | InboxItemRedirect (53) | 없음 |

마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · DB 변경 0 · 코드 변경 0 ⇒ evidence 행 없음.

---

## 9. Phase 1 구현 결과 (2026-09-22, product-owner 승인 후)

**§8의 결정.** Demo Core freeze는 「제품 의미·상태 계약 freeze」다. 기존 기능과 상태 의미는 유지하고 UI 구조는
바꿀 수 있다. 결정 여섯: 홈 → **오늘** · **반복 문제를 nav에** · `/agent`는 seller nav 밖(삭제하지 않음,
원래 nav에 없었으므로 변경 없음) · 리뷰는 전 채널 목록 우선(**backend 필요 여부를 먼저 확인**) · 서로 다른
숫자에 **scope label** · 두 「지켜보기」는 backend 값을 유지하고 **seller-facing copy만 구분** · 리포트는
설정으로 보내지 않음(**무변경**). 첨부 mock이 이 메시지에 포함되지 않아 **구조 여섯 조항**(고정 sidebar ·
가운데 목록 · 오른쪽 contextual detail · 상단은 행동 가능한 요약만 · 행 버튼 없음, 선택 → 오른쪽 primary
하나 · overview → detail)만 reference로 썼다.

### 9-1. 한 문법: master-detail + CaseLayout

| 새 조립 | 하는 일 | 쓰는 곳 |
|---|---|---|
| `workspace/MasterDetail` | 가운데 목록과 오른쪽 상세, 열마다 자기 스크롤. **1200px 이상**에서만 두 열이고, 그 아래에서는 행이 예전처럼 자기 화면을 연다(`useWideLayout`, `selectionHref`) | 오늘 · 확인할 일 · 반복 문제 |
| `workspace/CaseLayout` | 한 건을 판단하는 모든 화면이 같은 다섯 부분(무엇인가 → 고객 문장 → **내가 할 일** → 확인한 것 → 더 보기)을 같은 순서로 그린다. page 변형은 결정 열이 오른쪽에 sticky, pane 변형은 고객 문장 바로 다음에 결정 | Inquiry Case · Review Case · 반복 문제 상세 · 문의 pane |
| `workspace/WorkRows` | 확인할 일 행을 한 곳에서 그림. **행 버튼 0**, 1년 넘은 백로그 **divider**(`isOldBacklog` 재사용, 숨김·재정렬 0) | 오늘 · 확인할 일 |
| `workspace/WorkItemPane` | 선택한 행을 **그것을 소유한 화면의 pane 변형**으로 그림(case → `OperationsCaseView`, review → `ReviewCaseView`, inquiry → 기존 `InquiryResponsePanel`). 재구현 0 | 오늘 · 확인할 일 |
| `CaseLayout`의 `DecisionCard` | 다음에 누를 것이 있는 결정 묶음만 brand 윤곽. 한 화면에 강조가 하나뿐 | Review Case · 반복 문제 |

`OperationsCase`와 `ReviewReplyTask`는 **route wrapper + view**로 나뉘었다. 읽기·쓰기·승인 경계·append-only
버전·fingerprint·「발송 화면으로」 handoff는 **한 줄도 바뀌지 않았다**. 같은 컴포넌트가 page와 pane에 놓일
뿐이다. `HomeWorkRow`는 `kind` · `subjectId` · `workItemId` 세 칸을 **싣기만** 한다(URL을 되파싱하지 않기
위해서다). dedupe · 정렬 · 건수는 무변경이다.

### 9-2. 화면별

- **오늘** — 상단은 **행동 가능한 세 수**다(확인할 일 · 실행 대기 · 반복 문제, 각각 목록으로 가는 링크). 「자동 확인
  24시간」은 그 아래 한 줄 context로 내려갔고, 집계 제외 경고는 별도 줄로 남는다. 가운데는 확인할 일 5행
  (freeze의 5줄 컷 그대로)과 「나머지 N건 모두 보기 →」(「+22」 대체), 그 아래 실행 대기와 반복 문제다.
  오른쪽은 선택한 항목이고 기본값은 첫 행이다. 실행 대기의 승인된 리뷰 답변과 반복 문제도 **pane에서 열린다**.
  composer는 목록 열 아래에 docked이고 예시 칩은 뺐다. 첫 문장을 보내면 기존 대화로 돌아간다
  (`ConversationWorkspace.emptyLayout`, send 경로 동일).
- **확인할 일** — h1이 「확인 필요」에서 **「확인할 일」**로 바뀌어 nav · 홈 섹션과 이름이 하나가 됐다. scope
  label은 「판매자님의 결정을 기다리는 문의와 리뷰」다. 행에 「검토」 버튼이 없다(27개 → 0).
- **Inquiry Case** — 제목이 곧 고객 문장인 경우 **「문의 내용」 블록을 다시 그리지 않는다**(같은 문장 두 번 → 한 번).
  빈 grid 칸 결함(subject 없을 때 결정 열 위에 생기던 간격)도 닫았다.
- **Review Case** — 제목은 **고객 문장**이다(「리뷰 처리」와 상품명 전체 대신). 상품은 제목 아래 한 줄로 갔다.
  두 판단은 번호 붙은 두 카드다: **① 이 리뷰의 중요도**(확인 필요 / 지켜보기 / 참고)와 **② 처리 방법**
  (대응 필요 / **두고 보기** / 조치 불필요). `TRIAGE_OPTIONS`의 MONITOR 라벨만 바꿨으므로 worklist · 기록 ·
  audit 문장이 같이 따라온다. 확인할 일에서 들어오면 뒤로 가기가 「← 확인할 일」이다(`?from=work`).
- **반복 문제** — h1 「고객운영 메모리」 → **「반복 문제」**. 넓은 화면에서는 첫 문제가 열린 채 시작한다
  (빈 2/3 칸 제거). 목록 행은 제목 + 사실 한 줄이고 심각도는 상세 머리로 옮겼다. 상세의 **「판단과 조치」가
  8번째 블록에서 3번째로** 올라왔다.
- **scope label** — 오늘(「리뷰는 확인 필요 리뷰 14건 중 아직 판단하지 않은 3건만 셉니다」) · 운영 숫자
  (「현재 미답변 문의」 ≠ 「확인할 일」) · 고객 운영 관리(「고객 운영 관리가 조사해서 연 건만」 + 확인할 일 링크) ·
  리뷰 「승인 대기」(「승인 전 · 승인한 답변은 오늘의 실행 대기에」). **숫자는 하나도 바꾸지 않았다.**
- **사이드바** — 「대화 · 지난 대화가 없습니다」를 nav **아래**로 내렸다.

### 9-3. before / after (1440×900, Demo Org, 같은 측정 스크립트)

| 화면 | ≤13px 글자 | 행 버튼 | 중첩 박스 | 비고 |
|---|---|---|---|---|
| 오늘 | 12% → **2%** | 5 → **0** | 0 → 0 | 오른쪽에 첫 일이 열린 채 시작. 상단의 가장 큰 수가 「자동 확인 1건」에서 **「확인할 일 27건」**으로 |
| 확인할 일 | **37% → 6%** | **27 → 0** | 0 → 0 | 선택 → 오른쪽 상세 |
| Inquiry Case | 10% → 8% | — | 0 → 0 | 같은 문장 2회 → 1회, 빈 grid 칸 제거 |
| Review Case | 0% → 0% | — | 0 → 0 | 첫 화면에서 두 판단이 번호로 갈리고 다음에 누를 곳(②)이 강조됨 |
| 반복 문제 목록 | **77% → 0%** | — | 0 → 0 | 빈 상세 칸 → 첫 문제 |
| 반복 문제 상세 | **47~51% → 0%** | — | **2 → 0** | 조치 버튼이 네 번째 화면 → 첫 화면 |

AA(axe wcag2a/aa) 위반 **0** · 가로 스크롤 **0** · off-host 요청 **0** · page error **0**이다. 1440×900과
1152×720(좁은 fallback) 모두 여섯 화면으로 확인했다. before/after 스크린샷은 실제 고객 문장을 담고 있어
scratchpad에만 둔다.

### 9-4. 리뷰 전 채널 목록: backend가 필요하다 (구현하지 않음)

확인 결과 **backend 변경 없이는 정직하게 만들 수 없다**:

- 지금 리뷰 기록의 읽기는 `GET /api/seller-accounts/{accountId}/channel-reviews`(tier · sort · page)로
  **계정 단위**다.
- org 범위 읽기 `GET /api/reviews/recent`는 **기간 창**이고 tier 필터 · attention 정렬 · 페이지가 없다.
- 클라이언트에서 계정별 페이지를 합치려면 서버의 attention 정렬 비교자를 FE에 복제해야 한다. 이는 제품 로직의
  두 번째 사본이다.

필요한 것은 **읽기 전용 endpoint 하나**(org 범위, `tier`·`sort`·`page`·`channel` 필터, 기존 행 매핑
`ReviewRows.row()` 재사용)다. semantic 변경은 없다. 착수는 backend 수정을 허용하는 별도 결정으로 올린다.
**그때까지 리뷰 화면은 무변경**이다.

### 9-5. 테스트

frontend **257 files / 3,084 tests / 실패 0** · typecheck clean · backend 파일 **0** · 마이그레이션 0 ·
마켓플레이스 0 · WRITE 0 · 모델 0.

**계약이 바뀌어 다시 쓴 테스트**는 모두 이번 결정이 바꾼 것이다:

- 이름: 오늘 · 확인할 일 · 반복 문제 · 두고 보기
- 행 버튼 제거: 「첫 행만 filled verb」 → 「어떤 행도 버튼 없음, `.bg-brand-700` 0」
- 홈 상단: `work-flow-card` → `today-summary`, 같은 내용 단언 + 링크 단언 추가
- 리뷰 행 href의 `?from=work`

**새 단언**: 넓은 화면의 선택·첫 행 기본 선택, 좁은 화면에서 빈 반쪽 없음, 심각도가 상세 머리로 이동.
**안전 테스트 약화 0**: 「이 화면에는 결정하는 컨트롤이 없다」, 실행 대기의 「발송·보내기 없음」, 반복 문제의
「버튼 없음」은 그대로 통과한다.

### 9-6. 하지 않고 보고

- 리뷰 전 채널 목록(§9-4, backend 필요)
- 문의 목록 · 상세 7,071px(Phase 2, 목록/상세 자기 스크롤)
- 버튼 뒤의 오래된 화면 재조립(Phase 3)
- 오늘 pane에서 반복 문제의 상태를 바꾸면 **오늘의 반복 문제 목록은 다음 읽기까지 옛 상태 단어를 보인다**
  (`onIssueChanged`가 AgentHome의 operations read를 다시 부르지 않음. 표시만 늦을 뿐 기록은 즉시 서버에 있다)
- 문의 pane은 제목을 sr-only로 둔다(응답 패널이 고객 문장을 첫 줄로 이미 그리므로)
- 1200px 미만에서는 master-detail이 아니다(좁은 화면은 예전처럼 행 → 전체 화면)
