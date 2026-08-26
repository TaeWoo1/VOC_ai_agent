# Cafe24 Comment Answer Observation v1

> **상태:** 확정. 승인된 bounded live READ(`apr-c24-a3674-obs`, 2026-08-26)로 카페24 board-6 문의의
> **두 번째 답변 표현**을 확정하고, 그것을 관측 표면 안으로 들여놓은 기록.
> **marketplace WRITE 0 · DB 변경 0.**
>
> 상위 계약: `docs/inquiry_action_flow_v1.md`(채널별 WRITE capability) ·
> `docs/inquiry_answer_execution_v1.md`(A1 자식 글 확정) ·
> `docs/inquiry_thread_semantics_v1.md`(스레드 역할).
> 이 문서는 그 셋 중 어떤 capability 칸도 옮기지 않는다 — READ 관측이다.

---

## 1. 관측된 사건

2026-08-26, 판매자가 카페24 관리자 화면에서 문의 `cafe24:b6:a3674`(운영자 본인이 올린
「연동 테스트」 글)에 답변을 등록했다. SellerOps는 계속 **미답변**으로 표시했다.

DB가 말한 것:

| 값 | 관측 |
|---|---|
| `inquiries.status` | `UNANSWERED` |
| `inquiries.inform_status` | `N` |
| `thread_role` | `ROOT` (자식 글 없음) |
| `last_seen_at` | **2026-08-26 17:43:19 KST** |

`last_seen_at`이 결정적이다. routine sweep은 **답변 뒤에** 이 글을 다시 읽었고, 그러고도 `N`을
저장했다. 그러므로 「아직 수집이 안 돌았다」는 설명은 이 시점에 이미 배제되어 있었다 —
`IngestionService.applyInquirySource`는 재수집 때 소스의 status를 그대로 적용하며,
`sourceUnchanged`는 status 변화를 비교 대상에 포함한다.

---

## 2. 감사 — 계약이 말한 것과 말하지 않은 것

공식 사본 `docs/vendor/cafe24-admin-api/post-boards-articles-comments.md`(2026-08-24 채록)에서:

| 질문 | 계약의 답 |
|---|---|
| 댓글 READ API 존재 | **있음** — `GET /boards/{board_no}/articles/{article_no}/comments`, scope `mall.read_community` |
| parent/article 식별 | `article_no` · `comment_no` · `parent_comment_no` |
| 작성자 식별 | `writer`(최대 100) · `member_id`(최대 20) |
| 생성 시각 | `created_date` |
| 판매자/고객 구분 | **문서화되어 있지 않다.** reference는 댓글을 "shopping mall customer **or manager**"가 단다고 한 문장에 함께 적는다 |
| `reply_status`와 댓글의 관계 | **계약은 말하지 않는다.** 사본이 채록 시점에 미확정으로 기록해 둔 항목 그대로 |

코드가 하던 것: 카페24 문의의 `ANSWERED`는 **`reply_status=C` 하나에서만** 나왔다
(`Cafe24InquiryArticleMapper#toCanonicalStatus`). 댓글 READ는 `backend/`·`collector/` 어디에도
**구현이 없었다**. 그래서 이것은 신호를 잘못 읽은 결함이 아니라, 그 표현이 **관측 표면 밖**에
있었던 것이다.

---

## 3. 승인 매니페스트와 실행

| 항목 | 값 |
|---|---|
| `approvalId` | `apr-c24-a3674-obs` (소진됨 · 재사용 금지) |
| 채널 / 계정 | CAFE24 · `78da0eb3-3088-4ecb-919f-3e08dad1d402` (Demo Org `7146c50f…d8e0`) |
| 표면 | Admin API, board 6 (문의사항) |
| mode | **READ** — scope `mall.read_community` |
| 예산 | 5 (상한 7), `Cafe24AnswerSemanticProbeRunner.MAX_REQUESTS`가 매 호출 전에 검사 |
| 대상 | `3674` · 대조군 `3672`/`3673` — **셋 다 운영자 본인의 「연동 테스트」 글.** 실고객 문의 무접촉 |
| 커밋 | `692c5a78` (`feat/proactive-operations-agent-v1`) + 이 패키지의 probe 확장 |
| 실행 | 2026-08-26 18:21 KST, `Cafe24AnswerSemanticProbeRunner` (double-gated `ApplicationRunner`) |
| 사용 | **요청 7회**, WRITE 0, DB 변경 0, 저장 0 |

---

## 4. 결과

| # | 요청 | 관측 |
|---|---|---|
| R1 | articles by number `3674,3672,3673` | `3674`: `reply_status=N` · `reply=F` · `reply_user_id` 부재 · `depth=0` · parent 없음 · created `2026-08-26T00:13:09+09:00` |
| R2 | comments on `3674` | **댓글 1건** — `comment_no=39`, `parent_comment_no` 없음, body `SHORT`, created **`2026-08-26T14:56:24+09:00`**, **`member_is_mall=true`** |
| R3 | board 6 window `08-26 ~ 09-02` | window rows 1, **`children_of_target=0`** — 자식 답변 글 없음 |
| R4 | urgentinquiry reply `3674` | `replies=0` |
| R5 | urgentinquiry list `08-26` | `same_day_rows=0`, **`target_present_in_urgentinquiry=false`** — 긴급문의 경로 자체가 해당 없음 |
| R2-N | comments on `3673` | **0** |
| R2-P | comments on `3672` | **0** |

**`VERDICT = STANDARD_BOARD_COMMENT`.**

사용자 요청의 5분류로: **`COMMENT`**.

두 가지가 함께 성립해야 이 판정이 성립하고, 둘 다 성립했다.

1. **다른 표현이 없다.** 자식 글 0(A1 기각), 긴급문의 부재(B 기각). `verdict()`는 둘 이상이
   관측되면 `MULTIPLE_REPRESENTATIONS`를, 하나도 없으면 `UNPROVEN`을 반환한다 — 어느 쪽으로도
   추측하지 않는다.
2. **작성자가 확정된다.** `member_id == mall_id`. 이것은 새 추론이 아니라 카페24가 **상점명
   렌더링 조건으로 문서화한 동일성**이고, 2026-08-25 actor probe가 이 상점의 기존 답변
   **43/44**에서 관측한 바로 그 조건이다.

대조군 두 건의 댓글이 0이라는 것은 「댓글은 아무 데나 달려 있는 것이 아니다」를 보여 준다.
다만 **판정이 그것에 기대지 않는다** — authorship의 대리(proxy)는 authorship이 아니다.

### 그리고 이것이 왜 조용한 결함이었나

댓글 답변은 **`reply_status`를 바꾸지 않는다.** 14:56에 답변이 달렸고, routine sweep이 **17:43에
다시 읽고도** `N`을 저장했다. 판매자가 답한 지 세 시간 가까이 지난 고객 문의가 「미답변」으로
서 있었고, SellerOps가 가진 모든 신호가 그렇게 말하고 있었다.

---

## 5. 수정 — 최소 변경

### 5.1 새로 생긴 것

| 파일 | 역할 |
|---|---|
| `Cafe24BoardCommentsClient` | 한 글의 댓글 READ. `member_id`를 **private wire record에만** 묶고 `mall_id`와 비교해 **boolean만** 내보낸다 |
| `Cafe24BoardCommentRow` | `comment_no` · `article_no` · `created_date` · `authoredByMall`. 본문·작성자명·IP·첨부는 **필드가 없다** |
| `Cafe24InquiryAnswerObserver` | 경계 있는 관측: `comment=T` 발견 요청 1회 → 후보와 교집합 → 글당 댓글 READ 1회 (상한 `MAX_COMMENT_READS=20`) |

### 5.2 바꾼 것

- `Cafe24BoardArticlesClient.fetchCommentedArticleNumbers` — 문서화된 `comment=T` 필터.
  이것이 fan-out을 정한다: 「우리가 미답변으로 들고 있는 모든 글의 댓글을 읽는다」(백필 페이지에서
  최대 100회)가 「댓글이 하나라도 있는 글만 읽는다」(이 org에서는 1회)가 된다.
- `Cafe24InquiryArticleMapper.toCanonicalInquiry(..., Instant commentAnsweredAt)` — 증명된 판매자
  댓글이 있을 때만 `status=ANSWERED`, `answeredAt=댓글 시각`.
- `Cafe24ApiConnector` — **INQUIRY lane에서만** 관측을 부른다. 후보는 이 페이지가 미답변으로
  저장했을 행뿐이다(이미 `C`인 글, 스레드 REPLY는 제외).

### 5.3 바꾸지 **않은** 것 — 그리고 그 이유

- **downstream 0.** `IngestionService`는 이미 `becameAnswered`를 감지해
  `InquiryWorkItemWriter.reconcileConnectorAnswered`를 호출하고, 그것이 OPEN work item을
  `COMPLETED`로 옮기며 `VERIFICATION_RECORDED` audit을 남긴다. 새 이벤트·새 phase·새 테이블 **0**.
- **`answer_body` 미저장.** 댓글 본문은 가져오지 않는다. 요청받은 결함은 「답변한 문의가 미답변으로
  남는다」이고, 판매자의 문장을 저장하는 것은 **별개의 주장**이며 자체 downstream(Answer Memory)을
  갖는다. 저장하는 것은 **사실과 그 시각**뿐이다. 이는 자식 글 답변에서 `answer_body`를 승격하지
  않기로 한 `docs/inquiry_thread_semantics_v1.md`의 결정과 같은 자리에 선다.
- **`inform_status`는 여전히 `N`.** 채널이 말한 것을 그대로 적는다. (`N`, `ANSWERED`) 쌍은 모순이
  아니라 관측이다 — 카페24에는 답변 표현이 둘 이상이고 그중 하나만 그 플래그를 움직인다.
  `IngestionService`에 남아 있던 「그런 불일치는 실제로 일어나지 않는다」는 주석은 이제 틀렸으므로
  고쳤다.
- **새 scope 0.** 두 client 모두 커넥터가 이미 가진 `mall.read_community`를 쓴다. 재동의 없음.
- **댓글은 문의로 수집되지 않는다.** 이 lane은 canonical record를 **하나도** 만들지 않는다.
  고객의 댓글은 아무 항목도 만들지 않고, 판매자의 댓글도 새 행이 되지 않는다.

---

## 6. 회귀 (요청된 6항목)

| # | 요구 | 테스트 |
|---|---|---|
| 1 | seller comment → parent `ANSWERED` | `aSellerCommentAnswersTheParent` · `aShopCommentAnswersTheInquiryAndCompletesTheWorkItem`(E2E, work item `COMPLETED`) |
| 2 | customer comment → `ANSWERED` 금지 | `aCustomerCommentIsNotAnAnswer` · `customerCommentsDoNotAnswer` · `aCustomerCommentLeavesTheInquiryWaiting`(E2E, OPEN 유지) |
| 3 | unrelated comment → 영향 0 | `anUnrelatedCommentedArticleIsNeverRead` (후보가 아닌 글은 요청조차 쓰지 않는다) |
| 4 | reply article 기존 계약 유지 | `theReplyArticleContractIsUnchanged` · 기존 `reCollectingWithReplyStatusNtoCUpdatesInPlaceAndCompletesTheWorkItem` 무변경 통과 |
| 5 | REPLY child operational candidate 0 | `aThreadReplyIsNotAQuestion` · 기존 `replyArticle_isStoredAsHistoryButOpensNoWorkItem…` 무변경 통과 |
| 6 | duplicate answer attribution 0 | `aShopCommentOnAnAlreadyOpenInquiryCompletesItOnTheNextSweep` — `insertedIds()` 비어 있고 행 1개, work item 1개 |
| — | Cafe24 action execution proof 회귀 0 | `Cafe24ChannelReplyAdapter`/`Cafe24ReplyRequestShape` 무변경, 관련 스위트 전부 통과 |

추가로 fail-closed 항목: 작성자 불명(`member_id` 공백/부재) → 답변 아님; 시각 해석 불가(offset
없는 타임스탬프) → **아무것도 주장하지 않음**; rate limit → **lane만 잃고 페이지는 잃지 않음**;
observer 미주입(구 배선) → 이 lane이 없던 때와 **정확히 같은 동작**.

---

## 7. 남은 것 (정직하게)

- ~~라이브 재증명 미실행~~ → **2026-08-26 `LIVE_VERIFIED`** (승인 `apr-c24-a3674-reproof`,
  mode `READ`, WRITE 0). 이 lane은 **routine sweep 안에서** 대상을 옮겼다 — 진단 러너가 아니라
  판매자에게 실제로 도는 그 경로다. 관측 로그:
  `후보=1 댓글보유=1 조회=1 판매자답변확인=1 작성자불명=0 시각해석불가=0 상한초과미조회=0`
  (발견 1회 + 댓글 READ 1회 = **요청 2회**). 후보가 **1건**인 것은 백로그가 1건이라는 뜻이
  아니다 — 후보는 «이번 sweep 페이지가 미답변으로 저장했을 행»뿐이고, routine 창(14일) 밖의
  과거 백로그는 애초에 이 페이지에 오지 않는다. 그 백로그를 어떻게 할지가 §7의 두 번째 항목이다.
  결과: `cafe24:b6:a3674`가 `UNANSWERED` →
  **`ANSWERED`**, `answered_at` **`2026-08-26 14:56:24+09`**(댓글 자신의 시각이지 관측 시각이
  아니다), `inform_status`는 **여전히 `N`** — 채널이 말한 것과 우리가 내린 결론은 계속 다른 칸에
  있다. org 미답변(ACTIVE) **35 → 34**. 승인된 READ의 결과를 DB에 재생하는 방식은 **쓰지
  않았다** — 그것은 수집의 증명이 아니라 수집의 흉내다.
- **work item은 `COMPLETED`가 아니라 `PROPOSED`에 남았고, 그것이 맞다.** `reconcileConnectorAnswered`는
  **`OPEN`인 항목만** 닫는다. 이 문의에는 프로액티브 에이전트가 이미 초안을 붙여 두었으므로
  (`OPEN → PROPOSED`), 커넥터의 관측이 판매자의 진행 중인 작업을 취소하지 못한다. 큐에서는 어차피
  빠진다 — `findProactiveCandidates`가 `i.status = 'UNANSWERED'`를 요구하기 때문이다. 화면에서
  실제로 stale work로 보이는지는 §4의 별도 감사 항목이며, 이 패키지는 **고치지 않았다**.
- **routine window 밖은 닿지 않는다.** 관측은 sweep의 14일 창 안에서만 일어난다. 이 org의 과거
  미답변 백로그(대부분 5월)는 이 창 밖이므로, 그중 댓글로 답변된 것이 있다면 여전히 미답변으로
  남는다. 이는 기존 routine 동작과 같고, 백필은 별도 결정이다.
- **발견 요청이 상한(100)에 닿으면 그렇게 로그에 적는다.** 조용히 자르지 않는다 — 잘린 읽기는
  「아무도 댓글을 안 단 게시판」과 화면에서 구별되지 않기 때문이다.
- **`writer`/`password`는 여전히 미보유.** 이 문서는 READ만 다룬다. 댓글 **쓰기**
  (`POST .../comments`)의 capability는 `docs/inquiry_action_flow_v1.md`에서
  `NEEDS_VERIFICATION` 그대로다.

---

## 8. Historical reconciliation — 설계와 **승인 매니페스트** (미실행)

§7이 적어 둔 한계 — routine 창(14일)은 과거 백로그에 닿지 않는다 — 를 닫기 위한 계획이다.
**아직 실행하지 않았다.** 아래 매니페스트가 승인되기 전에는 어떤 요청도 나가지 않는다.

### 8.1 무엇을 확인하려는 것인가

마켓플레이스 호출 **0회**로 한 DB 감사 결과(2026-08-26):

| 항목 | 값 |
|---|---|
| Demo Org(`7146c50f`) Cafe24 · `ACTIVE` + `UNANSWERED` | **25** |
| (참고) 같은 org의 전 채널 합계 | 34 = Cafe24 25 · Coupang 5 · NAVER 4 |
| board | **전부 board 6** |
| `thread_role` | **25건 전부 null** — 08-25 repair가 `REPLY` 44건을 `EXCLUDED_THREAD_REPLY`로 옮겼고, 남은 ROOT는 명시적으로 표기되지 않았다 |
| `answer_body` / `answered_at` | **25건 전부 부재** — 답변 표현을 하나도 관측한 적이 없다는 뜻이다 |
| `inform_status` | `N` 21 · **`P` 3** · null 1 |
| 비밀글 | 15 (product-owner 결정으로 workload에 포함) |
| `last_seen_at` | **25건 전부 `2026-08-22 14:41`** — 과거 백필이 남긴 값이고, 이후 routine sweep은 이 행들을 **한 번도 다시 보지 않았다** |
| 작성 연도 | 2014–2025 (2016년이 10건으로 최다) |
| work item phase | `OPEN` 22 · `PROPOSED` 2 · `ACTION_PENDING` 1 |

25건 전부 `answered_at`이 비어 있다는 것은 「25건 전부 미답변」의 증거가 **아니다**. 우리는 이
행들에 대해 답변 표현을 **한 번도 조회한 적이 없다** — a3674 하나로 이미 확인했듯, 판매자가 관리자
화면에서 답한 흔적은 `reply_status`에 남지 않는다. 이 실행이 답하려는 질문은 정확히 하나다:
**「25건이 정말 미답변 25건인가?」**

### 8.2 요청 예산 — 왜 25×N이 아니라 1+N인가

기존 두 메서드가 이미 필요한 것을 절반씩 들고 있다: `fetchByArticleNumbers`는 **정확한 집합**을
(`article_no` 콤마 구분, 08-25 repair에서 증명됨), `fetchCommentedArticleNumbers`는 **댓글 필터**를
(`comment=T`) 쓴다. 계약의 LIST 파라미터 표는 둘을 **나란히** 싣고 서로 배타라고 적지 않는다
(`docs/vendor/cafe24-admin-api/get-boards-articles.md`). 그래서 발견은 한 번이다:

```
GET /boards/6/articles?article_no=<25개>&comment=T&limit=25   ← 1회
GET /boards/6/articles/{article_no}/comments                  ← 발견된 후보당 1회
```

**실패 모드가 안전한 쪽으로 기운다.** 두 필터가 결합되지 않고 `comment`가 무시되면 응답은
**상위집합**(25건 전부)이 되고, 우리는 최대 25번의 댓글 조회를 하게 된다 — 예산을 아끼지 못할 뿐
**틀린 답을 얻지는 않는다**. 반대 방향의 실패(조용히 잘려 「댓글 없음」으로 보이는 것)는 발생할 수
없다: 요청한 `article_no`와 돌아온 집합을 대조해 로그에 적는다.

`start_date`/`end_date`는 **보내지 않는다**. 계약이 「1회 호출당 조회 기간 1년 초과 불가」라고 적고
있는데 이 백로그는 11년에 걸쳐 있으므로, 날짜 창으로 접근하면 최소 12회의 발견 요청이 된다.
정확한 집합을 이름으로 부르는 쪽이 더 적고 더 정확하다.

### 8.3 승인 매니페스트 — `apr-c24-hist-comments`

| 항목 | 값 |
|---|---|
| approvalId | `apr-c24-hist-comments` |
| channel / account | Cafe24 · `78da0eb3` (org `7146c50f`) |
| surface | Admin API — `mall.read_community` (**기존 스코프, 재동의 없음**) |
| board(s) | **6 하나** |
| operation | board comment 관측 (historical reconciliation) |
| **mode** | **`READ`** |
| 대상 | **정확히 25개 `article_no`**: `19,25,72,77,78,80,81,82,85,86,89,90,97,113,160,194,208,213,218,230,248,250,280,281,284` — 이 목록 밖의 글은 요청 자체가 표현할 수 없다 |
| date/window | **없음**(정확한 집합으로 지정) |
| discovery requests | **1** |
| max comments GET | **25** (후보 1건당 1회, 상한) |
| **absolute max requests** | **26** |
| 자동 재시도 | **0** |
| allowed actions | `GET` **둘뿐** — 위 두 경로. `POST`/`PUT`/`DELETE` 없음 |
| **WRITE** | **0** |
| 저장되는 데이터 | 증명된 판매자 댓글이 있는 부모에 한해 `inquiries.status='ANSWERED'` + `answered_at`(**댓글 자신의 시각**). 그 외 **아무것도 쓰지 않는다** |
| 저장되지 **않는** 것 | `answer_body` · 댓글 본문 · 댓글 id · 작성자명 · `member_id` · 고객 댓글의 존재 여부 · 새 문의 행 |
| PII / body logging | **없음** — 로그는 개수뿐(`후보 / 댓글보유 / 조회 / 판매자답변확인 / 작성자불명 / 시각해석불가`) |
| `inform_status` | **건드리지 않는다** — 채널이 말한 것과 우리가 내린 결론은 다른 칸이다 |

### 8.4 정확성 규칙 (실행 시)

- 판매자 댓글(`member_id == mall_id`) → 부모 `ANSWERED`.
- **고객 댓글 → `UNANSWERED` 유지.** 고객이 자기 문의에 댓글을 다는 것은 답변이 아니다.
- **작성자 불명(`member_id` 공백/부재) → `UNANSWERED` 유지.** 추정하지 않는다.
- 자식 **답변 글** 계약은 **무변경** — 이 실행은 그 경로를 건드리지 않는다.
- **댓글은 문의 행이 되지 않는다.** canonical record를 하나도 만들지 않는다.
- `answer_body` **미저장** — 「답변했다」와 「이렇게 답했다」는 다른 주장이다.
- 진행 중인 판매자 작업은 취소되지 않는다: `reconcileConnectorAnswered`는 `OPEN`만 닫으므로
  `PROPOSED` 2건 · `ACTION_PENDING` 1건은 phase 그대로 남는다(§8.6).

### 8.5 감사만으로 드러난 것 — **계약 모순 하나** (고치지 않았다)

25건 중 **3건의 `inform_status`가 `P`**다. 같은 vendored 계약이 `P`를 두 번, **다르게** 정의한다:

- 속성 표: `P` = **처리중**(in progress)
- LIST 필터 표: **「`N: Unanswered`, `P: Answer`」** — 그리고 속성 표에 있는 `C`는 필터 값으로
  **아예 등장하지 않는다**(이 모순은 계약 사본에 이미 verbatim으로 적혀 있다).

코드(`CommunityReplyStatus`)는 속성 표를 따라 `P → IN_PROGRESS → UNANSWERED`로 **fail-closed** 매핑한다.
필터 표를 따랐다면 이 3건은 답변완료다. 어느 쪽이 맞는지는 **이 저장소가 답할 수 없고**, 추측으로
매핑을 바꾸는 것은 「판매자가 답한 문의를 미답변으로 둔다」를 「답하지 않은 문의를 답변완료로
숨긴다」로 바꾸는 것뿐이다 — 두 번째가 더 나쁘다. **그대로 두고 보고한다.** §8의 실행은 이 질문을
우회한다: 그 3건에 판매자 댓글이 있으면 `P`와 무관하게 `ANSWERED`가 되고, 없으면 `P`는 미해결로
남는다.

### 8.6 감사만으로 드러난 것 — **stale work 정확히 1건** (고치지 않았다)

`inquiries.status`가 `ANSWERED`인데 work item이 아직 살아 있는 행은 이 org 전체에서 **하나**다 —
`cafe24:b6:a3674`, `PROPOSED`. 실측 노출:

| 화면 | 게이트 | 이 1건이 보이는가 |
|---|---|---|
| 작업 큐 `?phase=OPEN` | `i.status` 게이트 **없음** | 아니오 (`OPEN` 22건은 전부 진짜 미답변 — `OPEN`은 자동으로 닫히므로) |
| 작업 큐 `?phase=PROPOSED` | `i.status` 게이트 **없음** | **예** (3건 중 1건이 이미 답변됨) |
| 문의 목록(Inbox) | `status`로 분류 | 아니오 — **「답변함」**으로 간다 |
| 홈 KPI · 채널표 · 요약 | `status = 'UNANSWERED'` | 아니오 |
| Agent tools | `phase=OPEN`만 요청 | 아니오 |
| 프로액티브 후보 | `i.status='UNANSWERED'` **있음** | 아니오 |
| 문의 상세 패널 | **phase만** 본다 | **예** — 초안·전송 흐름이 그대로 보인다 |

**전송은 막힌다.** `InquiryPublishService`의 전송 직전 검사에 `ALREADY_ANSWERED`가 있고
(`answered_at != null || answer_body 존재`), 이 lane이 **`answered_at`을 쓰기 때문에** 이 행은
거기서 거절된다. 중복 답변은 **불가능하다**.

다만 그 게이트는 `status`가 아니라 **두 필드**를 본다. 오늘 `ANSWERED`이면서 두 필드가 모두 빈 행이
**103건** 있고(Cafe24 89 · Coupang 9 · NAVER 5), 그 중 살아 있는 work item을 가진 것은 **0건**이라
실제 노출은 **없다**. 이것은 잠재적 구멍이지 현재의 결함이 아니며, 이 패키지의 comment lane은
자기 표현에 대해서는 그 구멍을 **닫았다**(`answered_at`을 쓰므로).

**제안(구현하지 않음).** 작업 큐 쿼리에 `i.status='UNANSWERED'`를 더하는 것은 **추천하지 않는다** —
우리 자신의 전송이 성공해 `ANSWERED`가 된 `EXECUTED` 항목이 검증 전에 화면에서 사라진다. 대신
**상세 패널이 이미 내려받고 있는 `detail.status`를 읽어**, 이미 답변된 대상에는 「이 문의는 이미
답변되었습니다」를 보이고 전송 CTA를 비활성화하는 편이 맞다. 숨기는 것이 아니라 말해 주는 것이고,
새 phase도 새 event도 필요 없다. **product-owner 결정 사항이다.**
