# Product Assembly v1 — 목표 IA와 화면 책임 (정본)

> **Status: CANONICAL (product IA & screen responsibility).** 2026-08-17, 제품 오너 결정.
> SellerOps는 이 시점에 **"기능 개발" 단계에서 "제품 조립" 단계로 전환**한다. 이 문서는 사용자에게 보이는
> 제품의 **정보 구조(IA)·화면 책임·노출 채널**의 단일 정본이다. 프론트 상세 원칙(상태 규칙·언어 사전·
> 접근성·가이드 연결·Action Window 화면)은 `docs/sellerops_frontend_spec.md`가 계속 소유하며, 그 문서의
> §5·§6·§7·§17-A(IA·내비·라우트·슬라이스)는 이 문서로 대체된다. 범위 계약은 `docs/product-scope-v1.md`,
> 채널 capability 진실은 `docs/multi-channel-connector-roadmap.md` §4.1이 그대로 정본이다.
>
> 이 문서는 **short**를 유지한다. 상태·진행은 여기 쓰지 않는다(각 workstream 홈으로).

---

## 1. 제품 방향 (한 문단)

SellerOps는 **채널 중심 제품이 아니라 업무 중심 제품**이다. 셀러가 매일 묻는 질문은 하나다 —
**"오늘 내가 확인하거나 조치할 일은 무엇인가?"** 데이터의 source는 채널이지만, UX는 workflow(리뷰·문의·
주문)로 수렴한다. 채널은 화면 안의 **filter 또는 capability**이지 destination이 아니다. 지금 목표는
**인터뷰·데모가 가능한 깔끔한 제품**이며, 새 핵심 기능보다 기존 live-proven 능력의 조립이 우선이다.

## 2. 노출 채널 (product-owner decision)

- **채널 확장은 일시 중단**한다. 사용자에게 노출되는 채널은 **NAVER / Coupang / Cafe24 세 개뿐**이다.
- **화면에 보이는 채널 = 실제 usable한 채널.** 카탈로그에 남아 있는 다른 채널(ESM+/G마켓·11번가·SSG·
  오늘의집·카카오·자사몰/기타·파일 업로드 메타채널 등)은 어떤 사용자 표면에도 나타나지 않는다.
- 선언 위치(각 한 곳): 백엔드 `ProductChannels.java`(`/api/channels`가 여기로 좁혀진다), 프론트
  `lib/productChannels.ts`(데모 카탈로그·클라이언트 목록에 같은 규칙). 두 목록은 같아야 하며, 다르면 백엔드가
  진실이다.
- **이후 채널 추가**는 connector/capability proof(§4.1 현행표 갱신 + 라이브 증거) **후** 이 목록에 코드를
  추가해 **기존 UX에 끼우는 방식**으로만 한다. 채널마다 새 화면을 만들지 않는다.
- 이 결정은 `docs/product-scope-v1.md` §1·v1.7 ①의 "채널 집합은 열려 있다"를 **전략으로는 유지**하고
  **제품 표면에서는 제한**한다. 명명된 채널은 목적지이지 노출 약속이 아니다.

## 3. 목표 IA

```
운영 (매일 여는 곳 — "오늘 확인·조치할 일")
├─ 홈        /            Today Inbox — "오늘 확인하거나 조치할 일": 리뷰 · 문의 · 연결 (§4a)
├─ 리뷰      /reviews     연결된 채널의 리뷰 기록 — 확인 필요 순, 채널은 switcher (/reviews/:accountId)
├─ 문의      /inquiries   들어온 문의 — 답변 필요 순, 답변 준비 workflow (/inquiries/:itemRef)
└─ 주문      /orders      기간·채널 필터 집계

연결·설정 (데이터가 어디서 오는가)
├─ 채널 연결  /connect     세 채널의 연결·상태(연결됨/연결 필요/연결 중/재연결 필요/오류)·자료 가져오기
│   ├─ /connect/channels/:accountId   채널 상세(연결 정보·수집 설정·이력·기간 수집)
│   ├─ /connect/naver · /connect/coupang(+/renew/:id) · /connect/cafe24(+/tutorial,/result)  연결 wizard(live flow 유지)
│   ├─ /connect/upload · /connect/review-history   파일 업로드 · 과거 리뷰 가져오기(Action Window backfill)
│   └─ /connect/imports(+/current)   리뷰 수집 실행 · 답변 준비 작업대 (§4b)
└─ 설정      /settings    워크스페이스·연결 알림·계정 (+ 더 보기: 메모리·리포트)

route는 있으나 1차 메뉴에 없음
├─ /inbox            → /inquiries 로 리다이렉트 (A2에서 혼합 큐 흡수)
├─ /inbox/:itemRef   구 딥링크 resolver — 문의면 /inquiries/:id, 리뷰면 /reviews/:accountId?review=:id
├─ /memory           고객운영 메모리(반복 이슈 후보) — 홈 "참고"·설정에서 진입
├─ /reports          기간 리포트 — 홈 "참고"·설정에서 진입
└─ /agent            운영 에이전트 콘솔 — 화면 안 액션으로만
```

- 모바일 탭: 홈 / 리뷰 / 문의 / 주문 + 더보기(채널 연결·설정·나머지). 내비 모델은 `lib/nav.v2.ts` 하나이며
  세 렌더러(사이드·탭·드로어)가 이를 공유한다.
- **메모리·리포트를 1차 IA 밖으로 둔 것은 되돌릴 수 있는 결정**이다: 두 화면은 삭제하지 않았고, 홈은 이를
  "참고"(오늘 할 일은 아니지만 살펴볼 것)로 노출한다.

## 4. 화면 책임 (원칙)

| 화면 | 책임 | 채널 차이 처리 |
|---|---|---|
| 홈 | Today Inbox(§4a): 리뷰 · 문의 · 연결의 "지금 사람이 봐야 할 것"만, 각 count는 그 destination이 세는 수. 진행 중 Action Window run · "참고"(메모리·리포트) | 채널은 리뷰 항목의 채널별 share(각자 정확한 링크)로만 등장 |
| 리뷰 | h1 "리뷰" + workflow 문장; 계정별 리뷰 기록(`ChannelReviews`)을 하나의 문 뒤에 모음(채널 = h2/switcher). 규칙 tier가 순서를 소유, AI는 `AI 확인 필요` suggestion(C2 pilot candidate, org opt-in, default OFF), 피드백·행동 기록은 학습 자산으로 축적. 필터·선택은 URL과 양방향 | 서버의 `ReviewChannelCapabilityView`(aiTriage / originalLocate / replySupported)로 버튼·문구 결정. 채널 고유 어휘(쿠팡 상품평)는 `channelVocabulary` 한 곳 |
| 문의 | 인박스 workflow를 문의로 scope: 답변 필요 → 답변함, 서버 count 헤더, 답변 방향 제안(발송 없음), 필터는 URL과 양방향 | 채널 filter는 로드된 행에서만; 제안 불가는 capability 문장으로 |
| 주문 | 기간·채널 집계 | 채널 select = `/api/channels`(=세 채널) |
| 채널 연결 | 세 채널의 연결 진입(가이드 연결·OAuth·튜토리얼), 상태 한 단어(§4b), 자료 가져오기, 리뷰 기록 진입 | 카드 액션·상태 단어는 계정 실제 상태(+health)에서만 |
| 설정 | 사실과 링크만. 토글 없음 | — |

### 4a. Today Inbox 계약 (홈, A2 — 2026-08-18)

홈은 "오늘 내가 확인하거나 조치할 일은 무엇인가?"에 **세 항목**으로 답한다. 순서 고정: **리뷰 · 문의 · 연결**.
정본 코드: `frontend/src/lib/todayInbox.ts`(순수 파생) + `components/home/TodayInbox.tsx`.

| 항목 | count source | destination (count가 정확히 같은 화면) |
|---|---|---|
| 확인이 필요한 리뷰 | 리뷰 기록 계정마다 `GET …/channel-reviews?tier=NEEDS_ATTENTION` 의 `total` (rules tier + pilot ON이면 AI 확인 필요 포함 — 서버의 같은 `FINAL_TIER_RANK` 식) | 채널별 share → `/reviews/:accountId?tier=NEEDS_ATTENTION`. 계정이 하나면 헤드라인도 링크; 여럿이면 헤드라인은 합계 표시만(링크 아님) |
| 답변이 필요한 문의 | 서버 count `InquiryRepository.countByOrgIdAndStatus(orgId, "UNANSWERED")` → `InboxResponse.unansweredInquiries` (A4). feed rows(`limit`, ceiling 500)는 목록·미리보기용일 뿐 count가 아니다 | `/inquiries?state=NEEDS_REPLY` — 헤더에 같은 서버 count를 인쇄하고, 필터가 그 행을 나열 |
| 확인이 필요한 연결 | 채널 상태 `RECONNECT_REQUIRED`/`PENDING` + 미확인 connector alert | 채널 행 → `/connect`, 알림 행 → `/settings/alerts`; 둘 다 있으면 헤드라인은 링크 아님 |

**"확인이 필요한 리뷰"의 정의는 하나다(A3):** 리뷰의 triage tier가 `NEEDS_ATTENTION`(rules tier; org opt-in 시
서버가 같은 final rank로 접는 `AI 확인 필요` 포함). 홈·리포트·`/reviews`가 모두 이 수를 쓴다 — 홈·리포트는
`hooks/useReviewAttention.ts` 한 곳으로 읽고(계정별 `?tier=NEEDS_ATTENTION`의 `total`), `/reviews`는 같은 필터의
`total`을 보여준다. 리포트의 옛 "저평점(2점 이하·NEGATIVE) feed 규칙"은 제거됐다.

규칙:
1. **count = destination count.** 한 화면이 그 수를 정확히 보여주지 않으면 그 숫자는 링크가 아니다.
2. **측정된 것만 숫자.** 읽기 실패 = "지금은 확인할 수 없습니다", 미연결 = "자료를 연결하면 표시됩니다". 0은
   성공한 읽기에서만. 리뷰는 계정별 fail-soft(실패한 채널을 문장으로 명시).
3. **행(row)은 열 것**: 리뷰 3건(계정 횡단 최신순 → `/reviews/:acc?review=:id`), 문의 3건(urgent → 최신 →
   `/inquiries/:id`), 연결은 채널·알림 각 행.
4. **주문 없음** — 주문 모델에 actionable 상태가 없다(`NormalizedOrderStatus` = PAID/UNKNOWN). 생기면 4번째 항목.
5. 딥링크 seam: `/reviews/:acc?tier=&review=` — **URL이 곧 필터·선택 상태(양방향)**: tier 버튼이 `?tier`를 쓰고
   `?review`를 지우며, 행 선택이 `?review`를 쓴다(replace, 히스토리 누적 없음). 모르는 tier 값은 무시하고 URL에서
   지운다. 채널 switcher는 `?tier`를 유지하고 `?review`는 버린다. `/inquiries?state=`는 mount 시 한 번 읽음.
6. `/inbox` 혼합 큐는 **흡수**: `/inbox` → `/inquiries`, `/inbox/:itemRef` → 소유 화면으로 resolve (유지).
7. **문의 URL 동기화(A4)**: `/inquiries?state=&channel=`이 곧 필터 상태(양방향, replace). 모르는 값은 행 로드 후
   URL에서 지운다. 행 링크는 현재 필터를 그대로 싣는다. `/api/inbox?type=INQUIRY&limit=500`으로 문의만 읽는다.
   **Residual**: 기간(period) 필터는 로컬 상태, `?channel` 값은 채널 코드가 아니라 표시명(`channelNameKo`)이다.

### 4b. 채널 연결 hub 계약 (A5 — 2026-08-18)

- **행 = 세 채널(NAVER / Coupang / Cafe24)뿐.** 카탈로그 read는 strict(`getChannelsStrict`, 백엔드가 이미 3종으로
  좁힘): 실패 시 "채널 정보를 불러오지 못했습니다", 로딩 시 "불러오는 중…", 데모 카탈로그로 조용히 대체하지 않는다.
- **상태 단어는 하나**(`lib/connectionState.ts`, 계정 실제 상태 + health에서만): 연결됨 · 연결 필요 · 연결 중 ·
  재연결 필요 · 오류. 버튼 동사도 상태당 하나: 연결하기 / 연결 계속하기 / 다시 연결하기 / 확인하기 / 연결 관리.
  카탈로그의 자체 status 문구(관리/요청하기/준비 중)는 사용자에게 보이지 않는다.
- **`/connect/imports` 결정: 유지(작업대).** `OperationsHome`은 (a) Action Window 리뷰 수집 실행 상태·이력·최근 실행,
  (b) 계정별 attention worklist + **NAVER 리뷰 답변 준비·가이드 제출**(live-proven)의 유일한 홈이다 — 중복이 아니라
  아직 workflow surface로 옮기지 못한 작업이다. hub 패널명을 "리뷰 수집 실행 · 답변 준비"로 바꿔 역할을 드러냈고,
  경로·기능은 그대로 둔다. 답변 준비를 `/reviews`(capability: `replySupported`)로 흡수하는 것은 A6 후보.
- 제거한 흔적: 도달 불가 notice 문구(로드맵 어투), `지원 준비 중` 라벨, dead 컴포넌트(`InboxFeed`, `DashboardGrid`,
  `StatusBadge`). 연결 wizard/OAuth/튜토리얼 코드는 손대지 않았다.

공통 규칙: 로딩·빈·오류 상태는 `sellerops_frontend_spec.md` §13; 언어는 §12(셀러 언어, 로드맵 문구 금지);
capability 정직성은 §15. **새 채널이 와도 FE 신규 화면이 최소가 되게** — 새 채널 = 목록 한 줄 + capability
row + 어휘 한 줄이 목표이며, 이를 깨는 설계는 이 문서를 먼저 고친다.

## 5. 이 조립에서 하지 않는 것

- 새 핵심 기능(Today Inbox·채널 횡단 리뷰 목록 endpoint·리뷰 답변 발송·자동 분류·silver weighting)
- 채널 추가, per-channel 신규 화면, 실험적 UI 확장
- 문서 삭제 — history/evidence 문서는 superseded 표시 또는 router 정리만

## 6. 조립 unit 기록

| unit | 내용 | 상태 |
|---|---|---|
| A1 (2026-08-17) | 문서 audit·정리 / 노출 채널 게이트(BE+FE) / 내비 홈·리뷰·문의·주문·채널 연결·설정 / `/reviews` switcher over 계정별 기록 / `/inquiries` scope / 리뷰 어휘 통일 / 채널 연결 3채널 카피 | 완료 (이 문서와 같은 브랜치) |
| A2 (2026-08-18) | 홈 → Today Inbox(§4a): 리뷰·문의·연결 세 항목, count = destination count, `/inbox` 흡수(리다이렉트 + 딥링크 resolver), `FeedItem.channelId` 추가, 리포트/업로드 결과 링크가 리뷰·문의로 | 완료 |
| A3 (2026-08-18) | 리뷰 화면 정리: "확인이 필요한 리뷰" 정의 하나(triage NEEDS_ATTENTION; 홈·리포트 공용 hook), `/reviews` h1 "리뷰" + workflow 문장(확인 필요 → 지켜보기 → 참고, AI 확인 필요 = 제안), 채널은 h2·switcher(계정 하나면 숨김), 필터 순서 확인 필요→지켜보기→참고→전체, `?tier`/`?review` 양방향 URL 동기화 | 완료 |
| A4 (2026-08-18) | 문의 화면 정리: 답변 필요 count = 서버 `countByOrgIdAndStatus(UNANSWERED)`(feed limit과 분리, 홈·`/inquiries` 동일), workflow 문장(답변 필요 → 답변함), 상태 옵션 순서·확인 필요 제외, `?state`/`?channel` 양방향 URL 동기화, 응답 불가 문구 capability 기반 | 완료 |
| A5 (2026-08-18) | 채널 연결 hub cleanup(§4b): strict 카탈로그 read + 로딩/오류/빈 상태, 상태 단어·버튼 동사 통일, `/connect/imports` = 작업대로 명확화(유지), 도달 불가 문구·dead 컴포넌트 제거 | 완료 |
| A6 (다음) | 리뷰 답변 준비를 workflow surface로: NAVER(`replySupported`) 계정의 답변 준비·가이드 제출 진입을 `/reviews` 상세에서 제공하고 `/connect/imports`는 수집 실행·이력 작업대로 축소 — 기존 reply live flow 보존, 새 기능 없음 | 제안 |

## 7. 라우터

| 필요한 것 | 문서 |
|---|---|
| 프론트 상세 원칙(상태·언어·접근성·가이드 연결·AW 화면) | `docs/sellerops_frontend_spec.md` |
| 범위 계약 | `docs/product-scope-v1.md` |
| capability 진실 | `docs/multi-channel-connector-roadmap.md` §4.1 |
| 리뷰 AI 데모·파일럿 상태 | `docs/workstreams/review_ai_triage_demo.md` |
| 리뷰 이벤트/네 기록 분리 계약 | `contracts/review-triage-events/v1/CONTRACT.md` |
| 제품 정체성·전략·상태 | `docs/sellerops_canonical_reference.md` |
