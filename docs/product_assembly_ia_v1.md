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
├─ 홈        /            오늘 확인할 고객 신호 + 연결 상태 (Today Inbox는 다음 unit)
├─ 리뷰      /reviews     연결된 채널의 리뷰 기록 — 확인 필요 순, 채널은 switcher (/reviews/:accountId)
├─ 문의      /inquiries   들어온 문의 — 답변 필요 순, 답변 준비 workflow (/inquiries/:itemRef)
└─ 주문      /orders      기간·채널 필터 집계

연결·설정 (데이터가 어디서 오는가)
├─ 채널 연결  /connect     세 채널의 연결·상태·자료 가져오기; 채널 상세 /connect/channels/:accountId
└─ 설정      /settings    워크스페이스·연결 알림·계정 (+ 더 보기: 메모리·리포트)

route는 있으나 1차 메뉴에 없음
├─ /inbox     문의+리뷰 혼합 큐 — 홈 신호 카드·메모리 근거 링크·리포트가 아직 가리킴
├─ /memory    고객운영 메모리(반복 이슈 후보) — 홈 카드·설정에서 진입
├─ /reports   기간 리포트 — 설정에서 진입
└─ /agent     운영 에이전트 콘솔 — 화면 안 액션으로만
```

- 모바일 탭: 홈 / 리뷰 / 문의 / 주문 + 더보기(채널 연결·설정·나머지). 내비 모델은 `lib/nav.v2.ts` 하나이며
  세 렌더러(사이드·탭·드로어)가 이를 공유한다.
- **메모리·리포트를 1차 IA 밖으로 둔 것은 되돌릴 수 있는 결정**이다: 두 화면은 삭제하지 않았고, 홈/Today
  Inbox unit이 "오늘 확인할 일" 안에서 그 자리를 정한다.

## 4. 화면 책임 (원칙)

| 화면 | 책임 | 채널 차이 처리 |
|---|---|---|
| 홈 | 사람이 봐야 할 것 · 돌아가는 것 · 연결해야 할 것. 숫자는 측정된 것만 | 채널명은 서버가 준 것 그대로 |
| 리뷰 | 계정별 리뷰 기록(`ChannelReviews`)을 하나의 문 뒤에 모음. 규칙 tier가 순서를 소유, AI는 `AI 확인 필요` suggestion(C2 pilot candidate, org opt-in, default OFF), 피드백·행동 기록은 학습 자산으로 축적 | 서버의 `ReviewChannelCapabilityView`(aiTriage / originalLocate / replySupported)로 버튼·문구 결정. 채널 고유 어휘(쿠팡 상품평)는 `channelVocabulary` 한 곳 |
| 문의 | 인박스 workflow를 문의로 scope. 답변 제안 생성, 발송 없음 | 채널 filter는 로드된 행에서만 |
| 주문 | 기간·채널 집계 | 채널 select = `/api/channels`(=세 채널) |
| 채널 연결 | 세 채널의 연결 진입(가이드 연결·OAuth·튜토리얼), 상태, 자료 가져오기, 리뷰 기록 진입 | 카드 액션은 계정 실제 상태에서 |
| 설정 | 사실과 링크만. 토글 없음 | — |

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
| A2 (다음) | 홈 → Today Inbox: "오늘 확인·조치할 일" 한 목록 — 리뷰 tier·문의 답변 필요·연결 조치를 한 큐로, 홈 카드 count 정의 통일 | 제안 |

## 7. 라우터

| 필요한 것 | 문서 |
|---|---|
| 프론트 상세 원칙(상태·언어·접근성·가이드 연결·AW 화면) | `docs/sellerops_frontend_spec.md` |
| 범위 계약 | `docs/product-scope-v1.md` |
| capability 진실 | `docs/multi-channel-connector-roadmap.md` §4.1 |
| 리뷰 AI 데모·파일럿 상태 | `docs/workstreams/review_ai_triage_demo.md` |
| 리뷰 이벤트/네 기록 분리 계약 | `contracts/review-triage-events/v1/CONTRACT.md` |
| 제품 정체성·전략·상태 | `docs/sellerops_canonical_reference.md` |
