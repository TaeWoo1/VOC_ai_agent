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
