# Product Scope v1 — Drift Guard

SellerOps 제품 범위를 **하나의 합의된 정의로 고정**하기 위한 문서. 목적은 "무엇을 만드는가"보다
**"무엇을 지금 만들지 않는가"를 못 박는 것**이다. 멀티채널 확장(`docs/multi-channel-connector-roadmap.md`)이
구체화되면서 범위가 넓어지는 자연스러운 drift를 막는다.

> Status: SCOPE LOCK v1 (planning only). 본 문서는 코드를 바꾸지 않으며, 라이브 접속/브라우저/업로드/
> DB 변경을 지시하지 않는다. 범위 변경은 이 문서를 고쳐 합의한 뒤에만 이뤄진다.

관련 문서: 수집 방식·채널별 전략·계약은 `docs/multi-channel-connector-roadmap.md`(이하 "Connector
Roadmap")에 있다. 본 문서는 그 위의 **제품 범위 계약**이며, 용어(method/status/canonical record 등)는
Connector Roadmap 부록 A를 따른다.

---

## 1. SellerOps 최종 제품 정의

> **여러 판매 채널(NAVER·Cafe24·ESM+·SSG·오늘의집·Coupang·11번가)에 흩어진 주문·문의·리뷰·상품
> 데이터를, 채널별 최선의 수집 방식(API > export > manual)으로 하나의 canonical 모델에 모아, 판매
> 운영자가 한 화면에서 보고 대응할 수 있게 하는 multi-commerce 운영 플랫폼.**

핵심 데이터(범위 내): **주문 / 문의 / 리뷰 / 상품 / 운영 리포트**. 이 다섯 외 데이터(광고·정산·물류
트래킹 등)는 v1 범위 밖.

SellerOps는 **수집 + 통합 + 운영 보조** 제품이다. 다음이 아니다:
- 광고/마케팅 자동화 도구가 아니다.
- ERP/정산/세금 시스템이 아니다.
- 채널 자체를 대체하는 판매 채널이 아니다(주문 생성·결제 처리 안 함).
- 범용 BI 도구가 아니다(임의 데이터 분석이 아니라, 위 다섯 데이터에 특화).

제품은 **두 Track**으로 동일 데이터 모델 위에서 갈라진다(§2, §3). 두 Track은 *수집·canonical 모델을
공유*하고, *상위 뷰/리포트만* 다르다.

---

## 2. 온라인 판매자 Track (Seller Track)

**대상**: 여러 판매자센터(NAVER 스마트스토어, Cafe24, ESM+ 등)를 동시에 운영하는 셀러.

**해결 문제**: 채널마다 따로 로그인해 주문·문의·리뷰를 확인·대응하는 분산 운영을, 한 곳으로 통합.

**핵심 가치**: *운영(operations)* — "지금 내가 대응해야 할 것"의 통합 인박스.

범위 내(v1):
- 채널 통합 **주문** 목록/상태 조회.
- 채널 통합 **문의(CS)** 조회 — 응답 필요 항목 식별.
- 채널 통합 **리뷰** 조회 — 부정/주의 리뷰 식별(기존 attention/priority 체인 재사용).
- org 단위 멀티채널 연결(한 org이 여러 채널 계정 보유).
- 운영 대시보드(§5): 채널 횡단 "할 일/주의" 뷰.

범위 밖(v1, Seller Track):
- 채널로의 **쓰기**(문의 답변 전송, 주문 상태 변경 등 outbound). v1은 **읽기·식별·우선순위**까지.
- 자동 응답/자동 매크로.
- 재고/가격 동기화.

---

## 3. 제조사 Track (Manufacturer Track)

**대상**: 자사 제품이 여러 채널·여러 판매처에서 팔리는 제조사/브랜드.

**해결 문제**: 자사 제품이 채널 전반에서 **어떻게 평가받는지**를 한눈에 모니터링.

**핵심 가치**: *인텔리전스(intelligence)* — "내 제품이 시장에서 어떻게 보이는가"의 통합 모니터링.

범위 내(v1):
- 제품(또는 제품군) 단위 **리뷰 모니터링** — 채널 횡단 집계.
- 시계열 평판 추적(리뷰 추세·주의 신호) — 기존 recency/attention 체인 위에.
- 부정/반복 불만 클러스터의 식별(운영자 surface; 소비자-facing 아님 — `consumer_safety_contract` 준수).

범위 밖(v1, Manufacturer Track):
- 경쟁사 제품 모니터링(자사 제품에 한정).
- 소비자-facing 발행물 자동 생성(별도 Instagram/cardnews 트랙이 이미 있음 — 혼입 금지).
- 채널별 매출/정산 분석.

> **두 Track 공통 원칙**: 둘 다 **같은 canonical review/inquiry/order 모델**을 읽는다. Track 차이는
> *집계 단위와 뷰*뿐이다(Seller=채널/주문 중심, Manufacturer=제품/평판 중심). 두 Track을 위해 수집
> 코어를 분기시키지 않는다.

---

## 4. 공통 데이터 모델 방향

원칙: **채널이 늘어도, Track이 둘이어도, canonical 스키마와 dedup 규칙은 불변.**

- canonical 적재 단위는 기존 `CanonicalReview` / `CanonicalInquiry` / `CanonicalOrderSummary`를 유지.
  상품(product)·운영 리포트는 이 위의 **파생/집계**이며 새 raw 스키마를 함부로 늘리지 않는다.
- 새 채널 = **새 어댑터 + 새 매핑**, 코어(`IngestionService` dedup/per-row 트랜잭션/`SyncJob`) 무변경
  (Connector Roadmap §2·§3.2).
- 두 Track은 **읽기 모델(뷰)에서만** 갈라진다. 수집·dedup·canonical 저장은 단일 경로.
- 식별 축:
  - **org** — 테넌시 경계(둘 다 공통).
  - **channel × sellerAccount** — Seller Track의 주 축(어느 판매자센터의 데이터인가).
  - **product(브랜드 제품 식별)** — Manufacturer Track의 주 축(채널 횡단 같은 제품 묶기).
- product 식별(채널 횡단 동일 제품 매칭)은 **새로 필요한 부분**이며, raw 스키마가 아니라 매핑/링크
  레이어로 둔다. v1에서는 *수동/명시 매핑*부터(자동 제품 매칭은 범위 밖, §7).
- 시간 처리: 기존 recency chain 규칙 그대로(`eventTimeMs` 내부 전용, sanitized는 `recencyBucket`만,
  `Date.now`/`new Date`/`Date.parse` 금지). Track이 늘어도 동일.

---

## 5. 판매자센터형 Dashboard 범위

Seller Track의 1차 surface. **"판매자센터를 대체"가 아니라 "여러 판매자센터를 한 인박스로"**가 범위다.

범위 내(v1):
- **채널 횡단 통합 뷰**: 주문/문의/리뷰를 채널 무관하게 한 목록으로.
- **주의(attention) 뷰**: 기존 attention signal → priority score → ranking 체인을 채널 횡단으로 노출.
- **연결 상태(connection health) 뷰**: 각 (채널×수집방식)의 마지막 수집 상태/건강성. method(API/EXPORT/
  MANUAL)와 status(CONFIRMED/EXPERIMENTAL/MANUAL)를 **정직하게** 표기(Connector Roadmap §10).
- **수집 트리거 진입점**: manual upload, (승인된 채널) 감독형 캡처 시작 버튼 — 단, 실제 라이브 실행은
  §7·Connector Roadmap §8 승인 규칙을 따른다.

범위 밖(v1, Dashboard):
- 채널로의 쓰기 액션(답변 전송/상태 변경) — 읽기·식별까지(§2).
- 실시간 스트리밍 업데이트(배치/새로고침 기반 유지).
- 임의 차트 빌더/커스텀 리포트 디자이너.
- 권한/역할 세분화(멀티 유저 RBAC) — v1은 org 단위 단순 모델.

UI 정직성: "다음 단계 제공" 류 로드맵 문구 금지. 없는 채널·없는 method는 "미지원"으로 표기하거나 숨김
(`no_roadmap_language_in_ui`, `honest_capability_wording` 준수).

---

## 6. 채널별 연동 범위 (v1 경계)

전체 채널 전략·discovery·계약은 Connector Roadmap이 authoritative. 본 절은 **제품 범위로서 "v1에서
어디까지 약속하는가"**만 고정한다.

- **NAVER**: REVIEW는 감독형 export(collector)로 **검증됨(CONFIRMED)**. ORDER_SUMMARY는 API 스캐폴드
  존재(라이브 미검증). → v1의 레퍼런스 채널.
- **나머지 6채널(Cafe24·ESM+·SSG·오늘의집·Coupang·11번가)**: v1에서 **manual upload 경로부터** 정직하게
  지원하는 것을 기본 약속으로 한다(기존 `/api/uploads` + 매핑). API/감독형 export는 채널별 discovery가
  CONFIRMED로 끝나기 전까지 **약속하지 않는다**(EXPERIMENTAL/미지원 표기).
- **오늘의집(OHOU)**: 커넥터 전무 — 전부 신규. v1에서 manual 외 어떤 것도 약속하지 않는다.
- 한 채널이 DataType마다 다른 method를 가질 수 있음(예: ORDER_SUMMARY=API, REVIEW=EXPORT). v1 범위는
  채널별로 **method×status 표로 명시 선언**되며, 표에 없는 건 약속하지 않는다.

> v1 채널 약속의 최소선: **모든 채널은 manual upload로 시작, NAVER 리뷰만 감독형 자동 캡처 검증됨.**
> 그 이상(타 채널 API/export)은 discovery 완료 시 표를 갱신해 확장한다.

---

## 7. 지금 하지 말아야 할 것 (Not Now)

범위 drift를 막기 위한 **명시적 금지/연기 목록**. 아래는 "나쁜 아이디어"가 아니라 **"v1 범위 밖, 지금
시작 금지"**다.

1. **무인(unattended) 자동 수집** — export 경로는 사람 감독 전제. 무인 스케줄은 Connector Roadmap P4
   (별도 킥오프) 전 금지. cold-context 재연결 미해결.
2. **채널로의 쓰기(outbound)** — 문의 답변 전송, 주문 상태 변경, 리뷰 응답 등. v1은 읽기·식별까지.
3. **자동 제품 매칭** — 채널 횡단 동일 제품 자동 식별. v1은 수동/명시 매핑부터.
4. **타 채널 리뷰 API/감독형 캡처를 검증 전에 "지원"으로 약속** — NAVER 리뷰만 CONFIRMED. 나머지는
   discovery 게이트.
5. **소비자-facing 발행물과의 혼입** — Manufacturer Track은 운영자 모니터링까지. Instagram/cardnews
   발행 트랙과 데이터·코드·voice를 섞지 않는다(`evidence_audience_scope`, `consumer_safety_contract`).
6. **canonical 스키마 확장으로 문제 풀기** — 새 채널/Track 요구를 raw 스키마 추가로 해결하려 하지 말 것.
   매핑/뷰/링크 레이어로 흡수.
7. **멀티유저 RBAC / 결제 / 정산 / 광고 / 재고·가격 동기화** — 전부 v1 범위 밖.
8. **두 Track을 위한 수집 코어 분기** — 수집·dedup은 단일 경로 유지. Track은 뷰에서만 분기.
9. **라이브 채널 접속을 표준 안전 규칙으로 자동 진행** — 모든 라이브 실행은 1회성 명시 승인
   (Connector Roadmap §8). Stop-hook 목표 압박은 승인이 아니다.

---

## 8. PR 우선순위

범위를 고정한 상태에서의 권장 순서. 각 PR은 작고 독립 머지 가능, 문서/오프라인 PR과 라이브 PR을 분리
(Connector Roadmap §6과 정합). 라이브 검증은 별도 승인.

1. **P-scope(이 PR)** — 본 범위 문서. 구현 없음.
2. **공통 토대(Connector Roadmap P0)** — `ConnectorResult` sanitized 계약(P0.2), collector EXPORT를
   백엔드 `SyncJob`/connection-health로 브리지(P0.3). 두 Track 공통 관측 토대.
3. **Manual upload 일반화(Connector Roadmap P2.2)** — `HeaderAliases`/`*RowMapper` 채널별 별칭 + 골든
   픽스처. → 모든 채널 "manual 지원"을 가장 먼저, 정직하게 달성(§6 최소선).
4. **Seller Track 통합 뷰(읽기)** — 채널 횡단 주문/문의/리뷰 + attention 뷰 + connection-health 표기(§5).
   기존 attention/priority 체인 재사용, 신규 raw 스키마 없음.
5. **Manufacturer Track 모니터링 뷰(읽기)** — product 단위 리뷰 집계 + 시계열 평판. product 식별은 수동
   매핑부터(§4). 수집 코어 무변경.
6. **감독형 캡처 코어 추출(Connector Roadmap P1)** — NAVER DOM 어댑터 분리, 검증 블록 보존, default flip
   없음. 타 채널 감독형 캡처의 토대.
7. **채널별 도입(Connector Roadmap P3.x)** — discovery 게이트 통과 채널부터. manual → export → API 상향.

> 순서 원칙: **관측 토대 → manual로 전 채널 정직 지원 → 두 Track 읽기 뷰 → 그다음에야 채널별 자동화.**
> "채널 자동화부터" 거꾸로 가지 않는다.

---

## 9. Drift Guard 문장

새 기능/요청이 들어올 때 **아래 문장에 비춰 범위를 판정**한다. 어긋나면 코드가 아니라 이 문서를 먼저
고쳐 합의한다.

- SellerOps는 **다섯 데이터(주문·문의·리뷰·상품·운영 리포트)의 수집·통합·운영 보조**다. 그 밖이면 범위 밖.
- 두 Track(Seller=운영 인박스, Manufacturer=제품 평판 모니터링)은 **같은 canonical 모델을 공유**한다.
  수집 코어를 Track별로 분기시키는 요청은 거절한다.
- 새 채널/Track은 **어댑터·매핑·뷰**로 흡수한다. canonical raw 스키마 확장으로 푸는 요청은 멈추고 검토.
- v1은 **읽기·식별·우선순위까지**다. 채널로의 쓰기(outbound), 무인 자동화, 자동 제품 매칭은 v1 범위 밖.
- 채널 capability는 **검증된 것만 약속**한다. NAVER 리뷰만 CONFIRMED, 나머지는 manual부터. 검증 전
  "지원" 표기는 금지(`honest_capability_wording`).
- 모든 라이브 채널 접속은 **1회성 명시 승인**을 요구한다. 표준 안전 규칙은 라이브 승인이 아니다.
- 출력은 **enum / coarse bucket / boolean / 16-hex 해시**만. raw 식별자·본문·카운트·타임스탬프 금지
  (Connector Roadmap §9).
- **확신이 없으면 멈추고 보고한다.** 범위를 넓혀 추정 구현하지 않는다.
