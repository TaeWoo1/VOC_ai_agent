# Product Operations Continuity v1

2026-09-04. HEAD at start: `ab0caf74`.

새 dashboard가 아니다. **상품 화면이 이미 말하고 있는 사실을 실제 doorway로 완성한다.**
Chat · Grounded Drafting · Knowledge model · Retrieval · Guided execution · 승인 경계 · Action
Executor는 **freeze**이고 이 패키지가 더한 write는 **0**이다.

---

## 0. 감사 먼저 — 실제 브라우저, 코드 수정 없이

실제 Demo Org, 1440×900@2×. 대상 상품 `0811fead…`(선바로 일체형 전선몰딩, 리뷰 1,761 · 문의 8 ·
미답변 1 · 문제 근거 80 · 반복 문제 15건).

| | before |
|---|---|
| 신호 타일 | **4개** — 리뷰 · 문의 · 미답변 문의 · 문제 근거. 이 중 **문 2개**(문의·미답변 문의). |
| 리뷰 숫자 | 1,761. **누를 수 없다.** |
| 문제 근거 | 80. **누를 수 없고**, 이 페이지 어디에도 갈 곳이 없다. |
| 반복되는 문제 | y=428, **15건 중 5건만 렌더**되고 10건이 더 있다는 말이 **없다**. 행은 링크가 아니다. |
| 섹션 순서 | 신호 → **채널 리스팅** → 반복되는 문제 → 상품 지식 → 자료 → 우리가 갖고 있는 정보 |
| 상품 지식 / 자료 | `/knowledge`로 가는 경로 **0**. 이 상품에 대해 **무엇이 부족한지** 말하는 줄 **0**. |
| `/inquiries` 기록 | 50행 고정. `totalCount` 94는 정직하게 표시되지만 **51번째 행에 도달할 방법이 없다**. |

즉 상품 화면의 숫자 넷 중 **둘이 막다른 길**이었다.

---

## 1. Product → Reviews

### 1-A 먼저 read path를 감사했다 — 그리고 **재사용하면 안 되는** 이유를 측정으로 찾았다

리뷰를 상품으로 좁혀 읽는 read는 **이미 있었다**: `GET /api/reviews/recent?productId=`
(`RecentReviewService`). 그런데 그 read는 `ProductChannels.VISIBLE_CODES`(NAVER · Coupang ·
Cafe24)로 좁혀져 있고 **타일의 숫자는 그렇지 않다**(`countByOrgIdAndProductId` = org + product,
채널 무관).

실측(Demo Org):

```
product 173f6c9f…  signals.volume.reviews = 2    /api/reviews/recent?productId=…  total = 0
product 32a25881…  signals.volume.reviews = 2    /api/reviews/recent?productId=…  total = 0
```

원인은 이 org의 **GMARKET 리뷰 11건**(REAL, 상품 8개에 결합)이다. GMARKET은 seller-visible
채널이 아니므로 window read가 세지 않는다. 그 read에 문을 연결했다면 판매자는 **「리뷰 2」를
누르고 빈 목록에 착지**했을 것이다 — 이 패키지가 없애려는 바로 그 결함의 더 나쁜 버전.

그래서 **가장 작은 read capability를 새로 만들었다**:

- `ReviewRepository.findByOrgIdAndProductId(org, product, Pageable)` — `countByOrgIdAndProductId`
  **바로 옆에, 같은 술어로**. 둘 다 평범한 JPA라 `realDataOnly` 필터를 똑같이 통과하고, 어느
  쪽도 그 조건을 손으로 적지 않으므로 **서로 어긋날 자리가 없다**.
- `ProductReviewsService` · `GET /api/products/{productId}/reviews?page=&size=` →
  `{ productId, productName, total, page, size, items }`.
- 행은 **기존 `RecentReviewItemView` 그대로**이고, 매핑도 하나다 — `ReviewRows.row()`를 뽑아
  window read와 공유한다. **같은 리뷰가 대화와 화면에서 다르게 읽히는 두 번째 사본을 만들지
  않는다.**

라이브 검증:

```
0811fead…   figure 1761  ↔  door total 1761
173f6c9f…   figure    2  ↔  door total    2      (window read 였다면 0)
```

`ProductReviewDoorwayTest`가 이것을 **두 서비스를 함께** 단언한다 — 목록이 행을 돌려주는지만
보는 테스트는 이 결함 위에서 초록이었을 것이다.

### 1-B 목적지: `/reviews?productId=`

- **계정 스위처가 없다.** 한 상품의 리뷰는 한 계정의 것이 아니고, 눌린 숫자도 그렇게 세지지
  않았다. 여기서 첫 계정으로 redirect하면 **묻지 않은 더 좁은 질문에 답하는 것**이다. 채널은
  탭이 아니라 **행의 사실**이 된다.
- **범위를 말하고, 해제할 수 있다** — 「{상품명}의 리뷰만 보고 있습니다 · 전체 리뷰 보기」.
  판매자가 여기서 필터를 건 것이 아니라 **필터를 통해 도착했으므로**, 보이지 않는 범위는 곧
  잘못 읽히는 숫자다.
- **work queue와 archive가 같은 범위를 존중한다.** 내 답변 작업은 **서버가** 좁힌다
  (`GET …/reply-work?productId=`).
- 모든 행은 `/reviews/reply/{reviewId}` — Review Approval Path v1이 지은 **그 하나의 작업
  화면**을 연다. 이 컴포넌트에는 write가 **0**이다(승인·초안·제외 어느 것도 없다). 문이지 방이
  아니다.

### 1-C work queue를 클라이언트에서 거르지 **않은** 이유 — 안전 fence가 옳았다

처음에는 `OperatorVocItem`에 `productId`를 실어 화면에서 걸렀다. `OperatorAttentionItemsJsonContractTest`
가 **직렬화된 바이트에서 `productid`를 찾아** 즉시 빨개졌다. 그 fence는 옳다: 이 표면은 제품
식별자를 나르지 않기로 되어 있고, 「우리 uuid는 괜찮다」는 예외를 만드는 순간 규칙이 선호가 된다.

⇒ 필드를 **되돌리고** 좁히기를 **쿼리 안으로** 옮겼다:
`findCommittedReplyWorkByChannel(..., :productId, ...)` — `(:productId is null or r.productId = :productId)`
한 절, 문장 하나. `null`이면 예전과 바이트 동일.

**읽은 뒤 거르지 않는 이유**도 같은 종류다: 상한 뒤에 거르면 계정의 to-do가 페이지보다 길 때
이 상품의 일이 조용히 사라진다. 그리고 **`productName`으로는 절대 거르지 않는다** — 그것은 display
name이고(정직하게 보일 수 없으면 withheld) 두 상품이 같은 카탈로그 이름을 가질 수 있다.

라이브: 계정 to-do **3건 → 이 상품 2건**, 응답 본문에 `productId` 키 **없음**.

---

## 2. Product → Issue evidence

**새 issue detection system 0.** 근거를 보여 주는 화면은 이미 있었다 — 고객운영 메모리의 이슈
상세(`/memory/{issueId}`: 왜 올라왔나 · 근거 인용 · 기록). 상품 화면이 거기로 **링크하지 않았을
뿐**이다.

- 반복되는 문제의 **모든 행이 문**이 된다 → `/memory/{issue.id}`.
- **5건에서 조용히 멈추지 않는다** — 나머지는 `Disclosure`로 「문제 10건 더 보기」. 숫자를 알면서
  말하지 않는 것은 갈 곳 없는 숫자와 같은 결함이다.
- **문제 근거 타일은 사라지고 그 숫자는 섹션 제목으로 옮겼다.** 그것은 독립된 수가 아니라
  **아래 나열된 이슈들의 근거 수의 합**이었고, 갈 곳이 없던 유일한 숫자였다. 이제 그 합을
  만드는 행 하나하나가 문이다. **사실은 사라지지 않았고 자리를 옮겼다.**

결과: 타일 행의 **숫자 셋이 전부 문**이다. **0은 문이 아니다**(빈 목록을 여는 컨트롤은 지키지
못한 약속) — 라이브에서 문의 0·미답변 0 상품은 평범한 사실로 렌더된다.

---

## 3. Product operations hierarchy

과도한 재배치는 하지 않았다. **한 번 옮겼다** — 채널 리스팅은 판매자가 이미 아는 상품의 제원인데
신호 타일 바로 아래에 있어서, 이 페이지에 오는 두 이유(고객이 뭐라 하나 · reviewnary가 무엇으로
답할 수 있나)가 300px 아래에서 시작했다.

```
before  신호 → 채널 리스팅 → 반복되는 문제 → 상품 지식 → 자료 → 우리가 갖고 있는 정보
after   신호 → 반복되는 문제 → 상품 지식 → 자료 → 채널 리스팅 → 우리가 갖고 있는 정보
```

실측 y: 반복되는 문제 **428 → 234**(fold 900 위), 상품 지식 776 → 631, 자료 1,256 → 1,110,
채널 리스팅 234 → 1,289. 문서 높이 1,589 → 1,637px. **새 카드 0 · 새 색 0 · 새 컴포넌트 0.**

---

## 4. Knowledge continuity

**Knowledge capability 재구현 0.**

- 상품 지식 / 자료 섹션에 「**회사 전체 지식에서 보기**」 → `/knowledge`. 문구가 **회사 전체**라고
  말하는 것이 요점이다: 상품 지식 source와 상품 문서는 그 화면에서 **같은 객체**로 나열되지만
  그 화면에는 상품 필터가 없다 — 「이 상품의 자료」라고 약속하는 링크는 모든 상품의 자료를 보여
  주는 페이지에 착지한다. **링크는 자기가 가는 곳을 말한다.**
- **부족한 정보**: 열린 `확인 필요` 중 **이 상품의 것만** 세어 한 줄
  (「이 상품에 대해 확인이 필요한 항목이 N건 있습니다 · 확인하러 가기」). 편집기·수락·기각은
  전부 `/knowledge`에 그대로 있고 여기에 **두 번째 받은함을 만들지 않는다**. 좁히는 축은
  `productId`(binding)이고 이름이 아니다. **읽기에 실패하면 아무것도 말하지 않는다** — 이
  컴포넌트는 빈 목록과 못 읽은 목록을 구별할 수 없고, 구별할 수 있는 척하면 안 된다.
- PRODUCT scope 유지는 **라이브로 확인**했다: `b76c186e…` 상품에서 열린 candidate 1건이 그
  상품 화면에만 나타나고(다른 상품·ORG scope는 걸러진다) 목적지는 같은 `/knowledge` 받은함이다.

---

## 5. Reviews product filter와 Chat continuity

- `/reviews/reply/{reviewId}` · `/reviews/{accountId}/reply/{reviewId}` · 승인 경계 ·
  `contentFingerprint` · append-only 초안 버전 · guided reply · Action Executor **전부 무변경**.
- product 범위에서 열든 계정 기록에서 열든 **같은 URL, 같은 화면, 같은 승인 컨트롤**이다.
- `/reviews?productId=`의 Agent launcher는 기존 `agentContext`에 `productId`를 실어 보낸다
  (Contextual Agent Contract Completion v1의 그 seam, 새 계약 0).
- 필터 해제는 `/reviews`로 돌아가고 채널 스위처가 다시 나타난다(라이브 확인).

---

## 6. Archive completeness

`GET /api/inquiries/rows`는 `MAX_LIMIT`=50에 **항상 page 0**을 물었다. `totalCount`는 정직했고
**도달 불가능**했다 — 실측 이 org의 기록 **94행 중 44행**. 기록이 자기 크기를 말하면서 걸어갈 수
없으면 그것은 아카이브가 아니라 검색창이다.

- 서버: `page` 파라미터 하나(`PageRequest.of(pageIndex, size, sort)`), 응답이 자기 page를 echo.
  **부재 = 예전과 바이트 동일**이라 Agent의 ROWS lane을 포함한 모든 기존 caller가 그대로다.
- 화면: 문장(「나머지는 위에서 찾아 주세요」) → **컨트롤**(「더 보기」 + `50 / 94건`). 행은 교체가
  아니라 **누적**되고, 필터가 바뀌면 page는 1로 되돌아간다(다른 질문에 페이지 번호는 뜻이 없다).
  **더 볼 것이 없으면 컨트롤이 렌더되지 않는다.**
- 라이브: 50 → **94행**, 그 뒤 「더 보기」 사라짐.
- `/reviews` 기록은 **이미 정직했다**(page/size + 「21–22번째 · 총 22개」) ⇒ 무변경.
- 상품 리뷰 기록도 같은 규칙: 페이저는 **움직일 수 있는 방향만** 렌더한다.

**거대한 table framework 0.**

---

## 7. Data-origin

`ab0caf74`의 `VERIFY_FIXTURE` / `DEMO_SEED` / `REAL` 구분 **무변경**. 새 read는 두 지점에서
`realDataOnly`를 물려받는다 — 상품 조회(`ProductQueryService.byId`)와 리뷰 count/list. 라이브에서
합성 상품 두 개(`e3bde7ee` · `b70fee36`)는 **404**로 도달 불가였고(남의 org와 같은 메시지라 probe
불가), 행 단위 배제는 `ProductReviewDoorwayTest`가 REAL 상품 위의 `VERIFY_FIXTURE` 리뷰로 고정한다
— **figure와 door가 함께 1을 답한다.**

---

## 8. QA — 실제 브라우저 1440 / 1366 / 1152

8개 route × 3폭: `/products/{p}` · 비가시 채널만 가진 상품 · `/reviews?productId=` ×2 ·
`/reviews` · `/memory/{issue}` · `/inquiries` · `/reviews/reply/{review}`.

- **AA 텍스트 노드 위반 0**(틴트 위 합성 계산) · 가로 스크롤 **0** · off-host 요청 **0**.
- 콘솔: agent-runtime(8787) 미기동과 로그인 페이지 config의 navigation-abort뿐. 새 endpoint 유래 **0**.
- 정직 보고: 전체 frontend suite 한 번의 실행에서 실패 1건이 났고 **이름을 잡지 못했다**; 이어진
  네 번의 전체 실행은 전부 2,725/0이었다. 이 패키지가 건드린 파일로 보이지 않으나 확인하지 못했다.

**click path (세 폭 동일, 스크롤 0)**

| 경로 | 클릭 | 좌표 |
|---|---|---|
| 상품 → 이 상품 리뷰 → 정확한 리뷰의 승인 | **2** | 타일 y=114 → 첫 행 y=191 → 승인 y=594 |
| 상품 → 반복되는 문제 → 그 이슈의 근거 | **1** | 이슈 행 y=307 → `/memory/{id}` |
| 상품 → 미답변 문의 → 그 상품의 문의 | **1** | 타일 y=114 |

**edge**: 60자 상품명은 줄바꿈되고 가로 스크롤 0 · 리뷰 0 상품은 정직한 빈 상태(그 화면은
타일이 문이 아니므로 URL로만 도달) · 업무 0이면 「이 상품의 답변 작업」 섹션 자체가 렌더되지
않음 · 리뷰 1,761건은 20행 + 페이저.

**마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 승인 0 · 마이그레이션 0 · DB 행 변경 0**
⇒ evidence 행 없음.

테스트: backend **3,792** / 실패 0 · frontend **2,725** / 실패 0 · typecheck clean.

---

## 9. 계약이 바뀌어 다시 쓴 테스트 (안전 테스트 약화 0)

- `CustomerInbox.test` — 「최근 2건을 보여 드립니다. 나머지는 위에서 찾아 주세요」 단언은 참이었고
  **막다른 길이었다**. 새 단언은 그때 단언하던 것 전부(페이지가 유한하다 · 전체 수가 보인다 ·
  다 담은 기록은 아무 말도 하지 않는다)에 **길**을 더한다: 「더 보기」가 서버에 다음 페이지를
  요청한다.
- 그 외 기존 테스트 변경 **0**. `OperatorAttentionItemsJsonContractTest`의 제품-식별자 fence는
  **약화하지 않고 설계를 바꿨다**(§1-C).

---

## 10. 고치지 않고 보고

1. **GMARKET 리뷰 11건은 `/reviews` 화면에서 여전히 볼 수 없다.** `reviewAccounts`가
   product channel만 나열하므로 채널 스위처에 지마켓 탭이 없고, 이제 그 행들이 보이는 유일한
   곳은 **상품 범위 리뷰 기록**이다. 타일의 숫자를 좁힐지(= 판매자가 가진 행을 숨김) 채널 집합을
   넓힐지는 **product-owner 결정**이다 — CLAUDE.md는 seller-visible 채널을 셋으로 선언하고 있다.
2. **`/memory`의 좌측 목록은 org 전체다.** 상품에서 들어가면 상세는 정확히 그 이슈이지만 옆
   목록은 회사 전체 이슈다. 상품 범위 이슈 read가 없고, 이 패키지는 새 issue surface를 만들지
   않기로 했다.
3. **이슈 근거의 인용은 `/inbox/{reviewId}`로만 링크된다**(그 id가 로드된 inbox에 있을 때).
   리뷰 근거를 `/reviews/reply/{reviewId}`로 잇는 것은 자연스러워 보이지만 근거를 **읽는** 행위에
   답변 작업 화면을 여는 것이라 별개 결정으로 남긴다.
4. **`/inquiries` 문서 높이 5,550px** — 큐 21건이 전부 실제 업무이고 더 보기 이전 기준이다.
   레이아웃 결함이 아니라 백로그의 길이.
5. **상품 지식 섹션은 여전히 카드 두 개를 세로로 쌓는다**(각 지식 source의 전문 미리보기).
   이 패키지의 대상이 아니었다.
6. **Orders / Reports / Settings 무변경.** §12 참조.
7. **`frontend/CLAUDE.md` 충돌**: 그 workstream(Action Window Frontend)에 금지된 `backend/**`를
   이 패키지가 수정했다. 근거는 conflict priority 1(현재 태스크의 명시적 product-owner 지시 —
   「없다면 seller-facing doorway를 만들기 위한 가장 작은 read capability를 추가해도 된다」).
   변경은 전부 **읽기**이고 state semantics 변경 0 · 가짜 상태 0 · write 0.

---

## 11. 남은 UX debt (Orders / Reports / Settings / Products)

- **Orders** — 필터 → 숫자 4 → 추이 → 채널별 매출. workflow가 없고 이 패키지는 없는 workflow를
  만들지 않았다.
- **Reports** — nav에 없고 설정 아래에 있다.
- **Settings** — 고객운영 메모리와 리포트가 아직 설정 아래 산다. `/memory`는 이제 상품 화면에서
  링크되지만 **주 내비게이션에는 없다** — 근거를 보러 가는 화면이 메뉴 집 안에 있는 것은
  IA 결정으로 남는다.
- **Products 목록** — 이름이 숫자 코드인 행(데이터 사실), 그리고 상품 목록에서 상품별 업무
  상태(승인 대기 등)를 볼 방법이 없다.
- 합성 행의 표시 규칙은 `ab0caf74`가 소유한다.
