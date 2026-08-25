# Inquiry Answer Execution v1 — 1단계: 계약 재조정과 READ proof manifest

> 상태: **중간 보고 (승인 대기)**. 2026-08-25. 브랜치 `feat/agent-evidence-scope-integrity`.
> 이 문서는 offline 계약 재조정과 READ proof 설계까지만 담는다. **마켓플레이스 요청 0 ·
> WRITE 0 · adapter 구현 0 · DB mutation 0.** semantic verdict는 §7 manifest가 승인되어
> 실행된 뒤에만 확정된다.

## 0. 왜 이 package의 1단계가 계약 재조정인가

2026-08-25 오전 이 저장소는 Cafe24 답변 경로에 대해 이렇게 적었다:

> `reply_status`는 글 **생성** 시에만 설정할 수 있고 `PUT`은 받지 않는다 ⇒ **이미 있는 문의
> 글을 수정해 답변 완료로 표시하는 계약상의 방법이 없다.** 유일한 후보는 댓글 POST이다.

첫 문장은 지금도 참이다. **결론은 틀렸다.** 그리고 틀린 방식이 이 package의 교훈이다 —
없는 것을 봤다고 한 것이 아니라, **찾아본 자리가 전부인 줄 알았다.**

| 어제 본 것 | 어제 보지 않은 것 |
|---|---|
| `boards/{board_no}/articles` 의 `PUT` | 같은 리소스 `POST`의 `reply_article_no` — *"If you want to add an reply to a post, enter the number of the post."* |
| `articles/{article_no}/comments` | `urgentinquiry` + `urgentinquiry/{article_no}/reply` (`GET`/`POST`/`PUT`) — reference 전체에서 **답변의 본문을 발행하는 유일한 리소스** |

`PUT`이 `reply_status`를 받지 않는다는 관측에서 「방법이 없다」로 간 것은 관측이 아니라
**추론**이었고, 그 추론은 "생성"이 새 질문을 올리는 것만을 뜻한다고 가정했다. Cafe24에서는
**답변도 글이다** — `parent_article_no` · `reply_sequence` · `reply_depth` 세 필드가 게시글
속성 목록에 나란히 있고, 답변 본문을 담는 필드가 게시글 속성 어디에도 없는 이유가 그것이다.
답변의 본문은 **자식 글 자신의 `content`**다.

**정정:** 이미 있는 문의 글에 답변을 붙이는 계약상의 방법은 **있다**. 다만 그것이 이 몰의
board 6에서 실제로 쓰이는 방식인지는 여전히 **증명되지 않았고**, 후보는 하나가 아니라 셋이다.

## 1. 재취득한 공식 계약 (사본 고정)

2026-08-25, 영문판(`https://developers.cafe24.com/docs/en/api/admin/`)과 국문판
(`.../docs/ko/api/admin/`)을 **각각 내려받아 대조**했다. 두 판은 일치한다.

| 사본 | 담는 것 |
|---|---|
| `docs/vendor/cafe24-admin-api/get-boards-articles.md` | **재취득·정정본.** 4개 endpoint(단건 `GET`은 **존재하지 않는다**), 게시글 속성 전체, LIST 파라미터, `POST`·`PUT` 파라미터 **전량**과 그 차집합 |
| `docs/vendor/cafe24-admin-api/post-boards-articles-comments.md` | 댓글 `GET`/`POST`/`DELETE`, 필수 `content`·`writer`·`password` (기존 사본, 변경 없음) |
| `docs/vendor/cafe24-admin-api/urgentinquiry-and-reply.md` | **신규.** 긴급문의 `GET`, 긴급문의 답변 `GET`/`POST`/`PUT`, 답변 속성(`content`·`status` F/I/T·`user_id`) |

### 1.1 어제 사본 자체의 오류 두 개 (정정하여 기록)

1. **단건 게시글 `GET`은 없다.** 어제 사본은
   `GET /boards/{board_no}/articles/{article_no}`를 endpoint로 적었다. reference의 *Endpoints*
   블록은 `GET`(목록)·`POST`·`PUT`·`DELETE` 넷뿐이고 "Retrieve a board post" 단수 절은 문서
   어디에도 없다. **한 글을 읽는 방법은 LIST의 `article_no` 필터**이며 이 필터는 쉼표로 여러
   개를 받는다 — 이 사실이 §7 manifest의 요청 수를 결정한다.
2. **`POST`의 `reply_article_no`를 누락했다.** 위 §0의 결론이 뒤집힌 지점이 정확히 여기다.

### 1.2 `PUT`은 재확인해도 `reply_status`를 받지 않는다

사용자 지시는 "이전 결론이 현재 공식 문서와 충돌한다"였다. **재취득 결과, 그 특정 항목에서는
충돌이 확인되지 않았다.** 영문·국문 두 판 모두 `PUT /boards/{board_no}/articles/{article_no}`의
파라미터는 `shop_no`·`board_no`·`article_no`·`title`·`content`·`rating`·`sales_channel`·
`board_category_no`·`display`·`notice`·`fixed`·`display_time_start_hour`·
`display_time_end_hour`·`attach_file_url1`~`5`이고 `reply_status`는 없다. 국문판의 `PUT` 설명도
"게시물의 제목, 내용과 평점, 노출 시간 등의 정보를 수정할 수 있습니다."다.

`reply_status`가 등장하는 자리는 문서 전체에서 넷이며 그 중 요청 파라미터는 **`POST`(글 생성)와
LIST 필터** 둘뿐이다. 나머지 둘은 속성 목록(게시글, 긴급문의)이다.

**그러므로 정정되는 것은 「`PUT`이 받는다」가 아니라 「받지 않으므로 방법이 없다」 쪽이다.**

### 1.3 세 개의 답변 표현 후보

| # | 표현 | WRITE endpoint | 필요한 행위자 값 | 답변 본문이 사는 곳 |
|---|---|---|---|---|
| **A1** | 질문에 달린 **답변 글** | `POST /boards/{board_no}/articles` + `reply_article_no` | `writer`·`client_ip` **필수** (`member_id`·`reply_user_id`·`reply_status` 선택) | 자식 글의 `content` |
| **A2** | 질문에 달린 **댓글** | `POST /boards/{board_no}/articles/{article_no}/comments` | `writer`·`password` **필수** | 댓글의 `content` |
| **B** | **긴급문의 답변** | `POST /urgentinquiry/{article_no}/reply` | `user_id` **필수** | reply의 `content` |

세 후보 모두 scope는 `mall.write_community`다. **reference는 board 6이 이 중 무엇을 쓰는지
말하지 않는다.**

## 2. 현재 Cafe24 inquiry source identity (코드·DB 감사, 호출 0)

| 항목 | 값 | 근거 |
|---|---|---|
| endpoint | `GET https://{mall_id}.cafe24api.com/api/v2/admin/boards/{board_no}/articles` | `Cafe24BoardArticlesClient#articlesUri` |
| board_no | **6** (문의사항). board 4 = 구매후기(커뮤니티 lane), board 9 = 1:1 맞춤상담 **미수집** | `Cafe24BoardArticleMapper.PRODUCT_INQUIRY_BOARD_NO = 6` |
| 쿼리 파라미터 | `start_date`·`end_date`·`limit`·`offset` 뿐 | 같은 메서드 |
| `article_no` semantics | **표준 게시판 글 번호.** 긴급문의 번호가 아니다 | 응답 필드 `article_no`를 그대로 |
| external_id | `cafe24:b6:a{article_no}` | `Cafe24InquiryArticleMapper#externalId` |
| source_subtype | **null** (Cafe24는 subtype을 두지 않는다) | DB: 3,312행 전부 null |
| 투영하는 필드 | `article_no`·`title`·`content`·`product_no`·`rating`·`created_date`·`updated_date`·`reply_status`·`secret`·`order_id` | `Cafe24BoardArticleRow` |
| **투영하지 않는 필드** | `parent_article_no`·`reply`·`reply_user_id`·`reply_sequence`·`reply_depth`·`article_type`·`writer`·`writer_email`·`member_id`·`client_ip` | 같은 record |
| ANSWERED 신호 | `reply_status` → `CommunityReplyStatus` (`C`만 ANSWERED) | `Cafe24InquiryArticleMapper#toCanonicalStatus` |
| 답변 본문 | **저장하지 않는다** — 게시글 행이 답변 본문을 싣지 않으므로 | 같은 mapper (`answer_body`에 null) |

**코드만 보고 가정하지 않은 것 (그리고 이것이 §4의 존재 이유다):** 이 `article_no`가 긴급문의
`article_no`와 같은 식별자 공간인지 **알 수 없다**. 두 리소스 어느 쪽 문서도 서로를 언급하지
않고, 긴급문의 LIST에는 `board_no` 파라미터조차 없다. `boards/6/articles`의 `a246`과
`urgentinquiry`의 `a246`이 같은 글이라는 근거는 **현재 0**이다.

## 3. 이미 저장된 데이터가 말해 주는 것 (호출 0)

Demo Org `7146c50f-…`, 채널 CAFE24, 계정 `78da0eb3-…` (`카페24 자사몰`, CONNECTED):

| 구분 | `reply_status` | 건수 | 기간 |
|---|---|---|---|
| 계정 결합 | `C` (처리완료) | **43** | 2014-10-28 ~ **2023-08-24** |
| 계정 결합 | (공백) | 44 | 2014-10-28 ~ 2023-09-08 |
| 계정 결합 | `N` | 21 | ~ 2025-02-06 |
| 계정 결합 | `P` (처리중) | 3 | 2019-04-12 ~ **2025-02-19** |
| 백필(계정 null) | `N` | 3,199 | 2026-05-04 ~ 05-06 |
| 백필(계정 null) | `C` | 1 | **2025-03-24** |
| 백필(계정 null) | (공백) | 1 | 2025-03-27 |

**이 표가 이 package를 가능하게 한다.** 판매자는 이 몰에서 board 6 문의에 실제로 답했고, 그
결과가 `reply_status=C`로 이미 우리 저장소에 있다. **답변의 표현이 무엇인지는 READ만으로
확정할 수 있다** — 답변되지 않은 고객 문의를 하나도 건드리지 않고.

`answer_body`는 43건 전부 null이다. **즉 우리는 「답변되었다」는 사실은 알고 「무엇으로
답변되었는지」는 모른다** — 그 간극이 정확히 semantic verdict가 메울 자리다.

## 4. semantic verdict를 위해 답해야 하는 질문 (READ로만)

| # | 질문 | 답이 갈라놓는 것 |
|---|---|---|
| Q1 | `reply_status=C`인 글이 `reply`·`reply_user_id`·`reply_depth`에 무엇을 싣는가 | `reply_user_id`가 있으면 실제 운영자 ID가 존재한다는 뜻 — §6의 절반이 풀린다 |
| Q2 | 그 글에 **댓글**이 있는가 | A2 후보의 생사 |
| Q3 | 같은 board에 `parent_article_no = {그 글}`인 **자식 글**이 있는가 | A1 후보의 생사 |
| Q4 | 같은 `article_no`가 **긴급문의**에 존재하며 `/reply`가 답변 본문을 돌려주는가 | B 후보의 생사 + 식별자 공간 공유 여부 |
| Q5 | 아직 답변되지 않은(`N`) 글은 Q1~Q4에서 **무엇이 다른가** | 대조군 없이는 "댓글이 있다"가 "댓글이 답변이다"의 근거가 되어 버린다 |

Q5가 목록에 있는 이유: 지시에 "comments가 존재한다는 이유로 seller answer라고 판정하지 마"가
있고, 그것을 지키는 방법은 판정을 조심하는 것이 아니라 **대조군을 같이 읽는 것**이다.

## 5. 행위자 값 (`writer` / `password` / `client_ip` / `user_id`) 감사

SellerOps가 Cafe24 연결에 대해 보관하는 값은 **정확히 둘**이다: `mall_id`, `refresh_token`
(`CredentialTemplates`, `Cafe24Authorizer#authorize`). 그 외 어떤 운영자 신원도 없다.

| 경로 | 필요한 값 | 현재 보유 | 상태 |
|---|---|---|---|
| A1 답변 글 | `writer` (필수) | ✗ | **`NEEDS_SELLER_CONFIGURATION`** |
| A1 답변 글 | `client_ip` (필수) | ✗ | **product-owner 결정 필요** — 서버 IP를 「작성자 IP」로 보내는 것이 정직한가 |
| A1 답변 글 | `member_id` (선택) | **`mall_id`가 있다** | reference: *"If member_id is the same as mall_id: The author will be returned as **shop_name**"* — **작성자를 지어내지 않고 상점명으로 표시하는 유일한 문서화된 방법** |
| A1 답변 글 | `reply_user_id` (선택) | ✗ | Q1이 관측하면 확보 가능 |
| A2 댓글 | `writer`·`password` (둘 다 필수) | ✗ | **`NEEDS_SELLER_CONFIGURATION`** · 임의 password 생성은 product-owner 결정 없이 금지 |
| B 긴급문의 답변 | `user_id` (POST 필수, PUT 선택) | ✗ | **`NEEDS_SELLER_CONFIGURATION`** · Q1의 `reply_user_id` 또는 Q4의 `user_id` 관측으로 확보 가능 |

**`member_id = mall_id`는 이번 재취득의 두 번째 실질적 발견이다.** 「고객에게 보이는 writer를
꾸며내지 마」라는 제약과 「`writer`가 필수」라는 계약이 정면으로 부딪치는데, 플랫폼이 그
출구를 문서화해 두었다 — 작성자 표시를 상점 이름으로 되돌리는 값이 우리가 이미 가진 값이다.
`writer` 자체는 여전히 필수 필드이므로 채워야 하지만, **표시되는 이름**은 지어낸 사람이 아니라
몰 자신이 된다. 이것이 실제로 그렇게 동작하는지는 WRITE 없이 확인할 수 없으므로 v1의 미해결
항목으로 남긴다.

## 6. OAuth grant 상태 — 재확인

| 사실 | 값 | 근거 |
|---|---|---|
| Demo Org Cafe24 부여 scope | `mall.read_community,mall.read_order,mall.read_product` | `connector_credentials.granted_scopes` (계정 `78da0eb3-…`) |
| `mall.write_community` | **없음** | 같은 행 |
| 요청 가능한가 | **아니오 — 구조적으로 막혀 있다** | `Cafe24OnboardingService` 생성자: scope 문자열에 `write`가 있으면 **기동 시 예외** ("카페24 OAuth 스코프는 읽기 전용이어야 합니다") |

**그러므로 「WRITE adapter를 구현할 수 있다」와 「이 계정으로 실행할 수 있다」는 서로 다른
사실이고, 지금은 두 번째가 거짓이다.** 그리고 write scope를 요청하려면 코드를 바꿔야 하는데,
그 fail-closed 가드는 실수로 들어간 것이 아니라 읽기 전용 계약을 지키려고 넣은 것이다.
**그것을 여는 것은 이번 단계의 작업이 아니라 별도의 product-owner 결정이다** — 이번 package는
가드를 건드리지 않았다.

READ proof에 필요한 scope는 `mall.read_community` 하나이며 **이미 부여되어 있다.** 즉 §7은
셀러에게 재동의를 요구하지 않는다.

## 7. Bounded READ proof manifest (승인 대기 — 아직 실행하지 않았다)

> **이 manifest는 실행되지 않았다.** 실행 코드도 아직 없다 — 승인 전에는 실행할 수 있는 것이
> 존재하지 않는 편이 안전하다.

| 항목 | 값 |
|---|---|
| org | Demo Org `7146c50f-ff6d-4c83-ae96-18c930e6d8e0` |
| seller account | `78da0eb3-3088-4ecb-919f-3e08dad1d402` (`카페24 자사몰`, CONNECTED, API) |
| 대상 | **`cafe24:b6:a246`** — REAL, 계정 결합, `reply_status=C`, 2023-08-24. 대조군 `a281`(`P`, 2025-02-19)과 `a218`(`P`) |
| 선택 규칙 | 「Demo Org 연결 계정에 결합되고 `reply_status=C`이며 가장 최근인 글」. 임의 선택 아님 |
| scope | `mall.read_community` (**이미 보유**) |
| DB mutation | **없음** — 진단 읽기 전용, 결과는 보고서로만 |
| WRITE | **0** |

### 요청 (최대 5, 전부 GET)

| # | 요청 | 답하는 질문 | 실패해도 안전한 이유 |
|---|---|---|---|
| R1 | `GET /boards/6/articles?article_no=246,281,218&limit=3` | Q1 + Q5 대조군 | 한 요청으로 세 글의 메타데이터. LIST가 쉼표 집합을 받으므로 가능 |
| R2 | `GET /boards/6/articles/246/comments` | Q2 | 댓글 유무·작성자 유형만 센다 |
| R3 | `GET /boards/6/articles?start_date=2023-08-24&end_date=2023-08-31&limit=100` | Q3 | `parent_article_no=246`인 자식 글을 찾는다. **7일 창** — 계약 한도는 1년, 우리는 1주 |
| R4 | `GET /urgentinquiry/246/reply` | Q4 (전반) | 404여도 결론이 되지 않는다 — R5가 이유를 가른다 |
| R5 | `GET /urgentinquiry?start_date=2023-08-24&end_date=2023-08-24&limit=100` | Q4 (후반) | R4의 부재가 「답변 없음」인지 「긴급문의가 아님」인지 구별. **하루 창** |

R5가 필요한 이유: **부재는 두 가지를 뜻할 수 있고 그 둘은 반대 결론으로 이어진다.** R4만으로
「긴급문의 경로 아님」이라고 적으면, 그것은 관측이 아니라 어제와 같은 종류의 추론이다.

### 읽는 필드 / 버리는 필드

| 읽는다 | 버린다 (보고서·로그·DB 어디에도 남기지 않는다) |
|---|---|
| `article_no` · `parent_article_no` · `reply` · `reply_status` · `reply_user_id` · `reply_sequence` · `reply_depth` · `created_date` · `comment_no` 개수 · 긴급문의 `status`·`user_id`·`count` | `writer` · `writer_email` · `member_id` · `phone` · `client_ip` · `nick_name` · **모든 `content`/`title` 본문** · 첨부 URL |

**본문은 존재 여부와 길이 구간만 기록한다.** 답변 본문이 무엇인지가 아니라 **답변 본문이
거기 있는지**가 이 proof의 질문이기 때문이고, 그 구별이 고객 글을 보고서에 옮기지 않게 한다.

### 이 manifest가 증명하지 못하는 것 (미리 적는다)

- 표본은 **한 몰의 한 게시판의 한 글**이다. 여기서 나오는 결론은 이 몰의 board 6에 대한
  것이지 Cafe24 일반에 대한 것이 아니다.
- 2023년 글이다. 그 사이 몰의 운영 방식이 바뀌었을 수 있다 — R1의 `P` 대조군(2025-02-19)이
  부분적으로만 이를 보완한다.
- 어떤 READ도 **WRITE가 무엇을 할지**는 증명하지 못한다. A1/A2/B 중 무엇이 답변으로 *보이는지*
  알아낸 뒤에도, 우리가 그 방식으로 쓰면 같은 결과가 되는지는 별개의 (WRITE) 증명이다.

### verdict 규칙 (관측 → 분류, 추측 금지)

| 관측 | verdict |
|---|---|
| `a246`에 `parent_article_no=246`인 자식 글이 있고 `N` 대조군에는 없다 | `STANDARD_BOARD_REPLY_ARTICLE` |
| `a246`에 댓글이 있고 `N` 대조군에는 없다 | `STANDARD_BOARD_COMMENT_AND_STATUS` |
| `urgentinquiry/246/reply`가 답변 본문을 돌려준다 | `URGENT_INQUIRY_REPLY` |
| 둘 이상이 동시에 성립 | **`UNPROVEN`** — 어느 것이 원인인지 모른다 |
| 셋 다 부재 | **`UNPROVEN`** (「지원하지 않음」이 아니다) |

`reply_status=C`라는 이유만으로 어떤 댓글/글이 답변이라고 판정하지 않는다. `article_no`가
같다는 이유만으로 같은 문의라고 판정하지 않는다 — R5가 그 동일성을 따로 관측한다.

## 8. 이번 단계에서 하지 않은 것

- adapter 구현 0 (A1·A2·B 어느 것도) · WRITE 코드 0 · 새 HITL 구조 0
- `Cafe24OnboardingService`의 write-scope fail-closed 가드 **변경 없음**
- `InquiryReplyCapabilityRegistry`의 CAFE24 transport **변경 없음** (`NEEDS_VERIFICATION` 유지)
  — 새 후보 두 개는 근거 기록으로만 반영
- Agent reasoning graph **WRITE 0** 유지 · Answer Memory 변경 0 · OrderFact 변경 0
- 마켓플레이스 요청 0 · DB mutation 0 · 로컬 스택 재기동 0

## 9. 다음 (승인 후)

1. §7 manifest 실행 → §4 Q1~Q5 관측 → §7 verdict 규칙으로 **하나의 분류**
2. verdict가 `UNPROVEN`이면 **거기서 멈춘다** — 근거 없는 adapter는 이 package의 실패다
3. verdict가 확정되면 그 경로 하나만 기존 Inquiry Action Executor에 연결하고,
   §5의 행위자 값과 §6의 grant는 각각 자기 상태(`NEEDS_SELLER_CONFIGURATION` /
   `RECONSENT_REQUIRED`)로 남는다 — **구현 가능과 실행 가능은 계속 두 개의 사실이다**

---

# 2단계 — READ proof 실행 결과 (2026-08-25, 승인 하에)

> **실행됨.** 마켓플레이스 요청 **5회 (상한 7)**, 전부 `GET`. **WRITE 0 · 상품/문의 데이터 mutation 0.**
> 실행 수단: `Cafe24AnswerSemanticProbe` + `Cafe24AnswerSemanticProbeRunner`, 커넥터 플래그와
> `sellerops.connector.cafe24.diagnostic.answer-semantics.enabled` **이중 게이트** 뒤의 진단.
> 스케줄러를 끈 격리 부팅에서 1회 실행했으므로 이 5회 외에 어떤 채널 호출도 발생하지 않았다.

## 10. 실제 요청과 관측

| # | 요청 | 결과 |
|---|---|---|
| R1 | `GET /boards/6/articles?article_no=246,281,248&limit=10` | `OK` 200, 3행 |
| R2 | `GET /boards/6/articles/246/comments` | `OK` 200, **댓글 0** |
| R3 | `GET /boards/6/articles?start_date=2023-08-24&end_date=2023-08-31&limit=100` | `OK` 200, 2행, **타깃의 자식 1** |
| R4 | `GET /urgentinquiry/246/reply` | `OK` **200, reply 0** (404 아님) |
| R5 | `GET /urgentinquiry?start_date=2023-08-24&end_date=2023-08-24&limit=100` | `OK` 200, **0행 — 타깃 부재** |

컨트롤용 댓글 조회 2회는 **쓰지 않았다**: R2가 댓글 0을 돌려준 순간 대조군이 반증할 대상이
없어졌다. 예산 7 중 5 사용.

### R1 — C / P / N 구조 비교

| article | `reply_status` | `reply` | `reply_user_id` | `reply_sequence` | `reply_depth` | `parent_article_no` | 본문 |
|---|---|---|---|---|---|---|---|
| **246 (타깃)** | **`C`** | `F` | **존재** | 2 | 0 | null | MEDIUM |
| 281 (P 대조) | `P` | `F` | **존재** | 1 | 0 | null | LONG |
| 248 (N 대조) | `N` | `F` | **부재** | 1 | 0 | null | SHORT |

두 가지가 여기서 정해졌다.

1. **`reply`는 답변 신호가 아니다.** 답변이 완료된 글에서도 `F`다. 필드 설명("whether replied
   for 1:1 query")이 가리키는 것은 board 6가 아니다. 답변 여부를 말하는 필드는 `reply_status`
   하나뿐이고, SellerOps가 이미 그것만 쓰고 있었던 것은 **맞았다.**
2. **`reply_user_id`는 `C`·`P`에 있고 `N`에는 없다.** 이 몰에는 실재하는 운영자 ID가 있으며,
   그 값은 판매자가 실제로 손댄 글에만 붙는다 — §5의 「운영자 신원이 어디서 오는가」에 대한
   첫 번째 실물 근거다.

### R3 — 답변은 글이었다 (A1 확정)

```
article_no=247  parent_article_no=246  reply_depth=1  reply_sequence=1
reply_status=null  reply_user_id 부재  body=MEDIUM  created=2023-09-08
```

**관계가 실제 타깃에 묶여 있다** — 창 안에 함께 있었다는 근접성이 아니라 `parent_article_no`가
246이다. 이것이 판정 규칙이 요구한 결합이다.

부수 관측 하나(결론 아님): 창은 08-24~08-31인데 자식의 `created_date`는 **09-08**이다. 즉
LIST의 날짜 필터는 **글 자신의 날짜가 아니라 스레드(부모)의 날짜로 걸리는 것으로 보인다.**
질문을 가져오면 답변이 딸려 온다는 뜻이라 검색에는 유리하지만, 이 문서는 그것을 계약으로
승격하지 않는다 — 한 번의 관측이다.

### R4·R5 — 긴급문의는 이 문의가 아니다 (B 기각)

R4는 **404가 아니라 200에 reply 0**을 돌려줬다. 그것만으로는 「긴급문의인데 답변이 없다」와
「애초에 긴급문의가 아니다」를 가를 수 없다 — **그래서 R5가 있었다.** 같은 날 긴급문의 목록은
**0행**이었고 타깃은 그 안에 없다. 두 번째 관측이 있어야 첫 번째가 뜻을 갖는다.

`article_no`가 두 리소스에서 같은 숫자라는 이유로 같은 문의라고 판정하지 않았고, 실제로
같지 않았다.

## 11. Semantic verdict

**`STANDARD_BOARD_REPLY_ARTICLE`**

| 후보 | 판정 | 근거 |
|---|---|---|
| A1 답변 글 | **성립** | `article 247`의 `parent_article_no == 246`, `reply_depth=1` |
| A2 댓글 | 기각 | 타깃의 댓글 **0** (대조군이 필요 없는 종류의 0) |
| B 긴급문의 답변 | 기각 | reply 0 **그리고** 같은 날 긴급문의 목록에 타깃 부재 |

하나만 성립했으므로 `MULTIPLE_REPRESENTATIONS`도 `UNPROVEN`도 아니다.

## 12. 제품 질문에 대한 답

> **"판매자가 board 6 문의에 답변했을 때, 그 답변 본문과 완료 상태를 어떤 API로 다시 확인할 수
> 있는가?"**

**이미 호출하고 있는 그 엔드포인트로 확인할 수 있다.** 새 endpoint도, 새 scope도, 새 연결도
필요 없다.

| 무엇 | 어디 |
|---|---|
| 답변 **본문** | 자식 글의 `content` — `GET /boards/6/articles`가 이미 돌려주고 있다 |
| 답변 **완료 상태** | 부모 글의 `reply_status=C` — 이미 읽고 있다 |
| 답변 **작성자(운영자)** | 부모 글의 `reply_user_id` — **투영하지 않고 있다** |
| 부모–자식 **관계** | `parent_article_no` · `reply_depth` — **투영하지 않고 있다** |

즉 답변 본문은 **한 번도 우리 손 밖에 있던 적이 없다.** 투영하지 않은 두 필드 때문에 그것이
답변인 줄 몰랐을 뿐이다.

## 13. 그 대가 — 발견된 결함 (이 package에서 고치지 않았다; **`docs/inquiry_thread_semantics_v1.md`에서 수정됨**)

> **후속 (2026-08-25).** 신규 수집은 고쳐졌다 — `parent_article_no`를 투영하고 `SourceThreadRole`로
> root/reply를 가르며, 답글은 work item을 열지 않고 `EXCLUDED_THREAD_REPLY`로 현재 읽기에서 빠진다.
> 새 요청도 새 scope도 필요 없었다(그 필드는 이미 모든 응답에 있었다). 이미 저장된 historical 행은
> 역할이 기록된 적이 없어 그렇게 고칠 수 없고, **exact `article_no` bounded re-read**가 승인 대기 중이다.
> 답글의 **작성자**는 여전히 미증명이므로 자식 본문은 `answer_body`로 승격되지 않는다.


`parent_article_no`를 읽지 않는다는 것은 **자식 글을 질문과 구별하지 못한다**는 뜻이고,
board 6의 모든 글을 문의로 수집하는 현재 경로에서 그 결과는 하나뿐이다:

```
cafe24:b6:a247 | 2023-09-08 | inform_status=(공백) | status=UNANSWERED | REAL | body 492자
```

**판매자 자신의 답변이 「고객이 답변을 기다리는 문의」로 저장돼 있다.**

DB에서 본 규모(계정 결합 111행 기준):

| | 건수 |
|---|---|
| `reply_status='C'` (실제 문의, 답변됨) | 43 |
| `inform_status` 공백 | **44** |
| 그 중 **`C` 글 바로 다음 번호**인 것 | **37** |

`parent_article_no`를 저장하지 않으므로 DB만으로는 증명할 수 없다 — 증명된 것은 247→246
한 건이다. 그러나 자식 글의 `reply_status`가 `null`이라는 R3의 관측과 44개의 공백,
그 중 37개가 답변된 글의 바로 다음 번호라는 사실은 같은 방향을 가리킨다.

**영향:** 답변 대기 큐가 판매자 자신의 문장으로 부풀어 있고, 그 문장들이 RAG·Answer Memory의
문의 측 코퍼스에 문의로 앉아 있다. **이것은 이번 승인 범위 밖이므로 고치지 않았고, 다음
package의 1순위로 보고한다.**

## 14. 아직 `UNPROVEN`인 것

1. **WRITE는 무엇도 증명되지 않았다.** A1이 답변으로 *보인다*는 것과, 우리가 A1으로 쓰면 같은
   결과가 된다는 것은 다른 문장이다. 특히 `POST`에 `reply_status=C`를 실으면 그것이 **자식 글의
   상태**가 되는지 **부모 글의 상태**가 되는지 계약도 이번 관측도 말하지 않는다 — 관측된 자식의
   `reply_status`는 `null`이었다.
2. 표본은 **한 몰 · 한 게시판 · 한 스레드**다.
3. R3의 날짜 필터 동작(부모 날짜로 스레드가 딸려 온다)은 **한 번 본 것**이다.
4. `member_id = mall_id`가 작성자를 상점명으로 렌더링한다는 계약 문구는 **WRITE 없이 확인 불가**.
5. 이 몰의 실제 운영자 ID **값**은 읽지 않았다 — 존재만 관측했다(`reply_user_id_present`).

## 15. Cafe24 Action Executor에 필요한 행위자 값 (verdict 확정 후)

경로가 A1으로 정해졌으므로 필요한 값도 정해졌다 — **A2의 `password`는 더 이상 필요 없다.**

| 값 | 계약상 | 현재 | 필요한 결정 |
|---|---|---|---|
| `writer` | **필수** | 미보유 | 표시 이름을 무엇으로 할지 — `member_id=mall_id`면 **상점명으로 렌더링**되므로 `writer`는 내부 값이 된다 |
| `client_ip` | **필수** | 미보유 | **product-owner 결정** — 서버 IP를 「작성자 IP」로 보내는 것이 정직한가 |
| `member_id` | 선택 | **`mall_id` 보유** | 작성자를 지어내지 않는 유일한 문서화된 출구 |
| `reply_user_id` | 선택 | 미보유(존재는 관측됨) | 과거 답변 글에서 읽어 재사용할지 vs 판매자에게 물을지 — **결정 필요** |
| `title` | **필수** | — | 답변 글의 제목 규칙 (예: 원문 제목 접두) — **결정 필요** |
| `password` | 선택 | — | A1에서는 선택이므로 **임의 생성 문제가 사라졌다** |

## 16. write scope / 재동의

변함없다. 부여 scope는 `mall.read_community,mall.read_order,mall.read_product`이고
`mall.write_community`가 없다. 그리고 `Cafe24OnboardingService`가 write scope 요청을 **기동 시
거부**하므로, 재동의는 셀러의 동의 이전에 **코드 변경 + product-owner 결정**을 먼저 요구한다.
이번 package는 그 가드를 건드리지 않았다.

## 17. 다음 WRITE adapter는 single-step인가

**single-step일 가능성이 높고, 아직 확정할 수 없다.**

계약상 `POST /boards/6/articles`는 `reply_article_no` · `content` · `reply_status` · `reply_user_id`를
**한 호출**에 받는다. 그러므로 §8이 가정했던 「댓글 POST → 상태 PUT」 2단계 문제(부분 성공,
`PARTIAL / RECONCILIATION_REQUIRED`, 중복 답변 위험)는 **A1에서는 발생하지 않는다** — 애초에
호출이 하나다.

확정을 막는 것은 §14-1이다: 그 한 호출의 `reply_status`가 **부모**에 붙는지 자식에 붙는지
모른다. 자식에만 붙는다면 부모를 `C`로 만들 방법이 필요한데 `PUT`은 `reply_status`를 받지
않으므로, 그 경우 **답변은 보내지되 완료 표시는 불가능**할 수 있다 — single-step이 아니라
**one-step-and-a-gap**이다. 이것은 WRITE 없이 답할 수 없고, 답이 무엇이냐에 따라 executor의
성공 판정과 verification 규칙이 통째로 달라진다. **다음 package의 첫 질문이 이것이어야 한다.**

---

# 3단계 — Cafe24 Answer Execution v1 (2026-08-25, 진행 중)

Thread Semantics Recovery v1이 CLOSED된 뒤 시작한 package. 목표는 **grounded draft → Human
Approval → reply article WRITE → READ-back Verification → `EXECUTOR_SENT_VERIFIED` Memory**이고,
그 앞에 §17이 지목한 질문 — **행위자 값과 `reply_status`의 부착 지점** — 을 먼저 닫는다.

이 절은 **marketplace 호출 0** 상태에서 할 수 있는 만큼을 기록한다. 라이브 관측(§19)은 manifest만
작성했고 실행하지 않았다.

## 18. 요청 필드 감사 — 계약만으로 끝나는 부분 (`Cafe24ReplyRequestShape`)

§15의 표를 코드로 옮겼다. 문서가 아니라 코드에 두는 이유는 하나다: adapter가 읽을 값과 감사가
말하는 값이 서로 다른 파일에 있으면 언젠가 갈라진다. 출처는 `docs/vendor/cafe24-admin-api/
get-boards-articles.md` **하나뿐이고**, 테스트가 그 파일의 존재와 해당 endpoint 문자열을 확인한다.

**분류는 세 가지다** — `REQUIRED`(계약이 필수라고 적은 것) · `OPTIONAL_USED`(받고, 우리가 보낼
이유가 있는 것) · `NOT_USED`(받지만 보내지 않기로 한 것). 그리고 각 필드에 **어디서 값이 오는가**
(`Sourcing`)를 따로 붙였다. 이 둘이 분리되어 있어야 「필수인데 값이 없다」가 표현된다.

| 필드 | 계약 | 소싱 | 상태 |
|---|---|---|---|
| `board_no` | REQUIRED | 보유 | 대상 행이 들고 있다 |
| `content` | REQUIRED | 보유 | 사람이 승인한 초안, 해시에 묶인 값 |
| `reply_article_no` | OPTIONAL_USED | 보유 | **이 필드가 글을 답변으로 만든다** — 승인된 부모의 번호 |
| `writer` | REQUIRED | **미해결 · 관측 필요** | 고객에게 보이는 이름. 지어내기 금지 |
| `title` | REQUIRED | **미해결 · 관측 필요** | 계약에 규칙 없음 |
| `client_ip` | REQUIRED | **product-owner 결정** | 「작성자의 IP」 — 흉내내지 않는다 |
| `member_id` | OPTIONAL_USED | **계약이 문서화** | `mall_id`와 같으면 작성자가 **상점명**으로 렌더링 |
| `reply_status` | OPTIONAL_USED | **미해결 · 관측 필요** | 부모/자식 어디에 붙는지 미증명 |
| `reply_user_id` | NOT_USED | — | 필수 아님 + 의미 미증명 ⇒ 과거 값이 있다고 복사하지 않는다 |
| `secret` | NOT_USED | product-owner 결정 | 기본값을 고르는 것이 곧 **고객 노출 결정**이다 |
| `password` | NOT_USED | — | A1에서는 선택(댓글 POST에서만 필수) |
| 나머지 17개 | NOT_USED | — | shop_no · created_date · writer_email · nick_name · notice · fixed · deleted · reply · reply_mail · rating · sales_channel · input_channel · board_category_no · product_no · category_no · order_id · naverpay_review_id · attach_file_urls |

`writeReady()`는 **선언이 아니라 파생**이다 — 위 표에 `UNRESOLVED_NEEDS_OBSERVATION` /
`PRODUCT_OWNER_DECISION`이 하나라도 남아 있으면 false다. boolean을 뒤집어서 켤 수 있는 스위치는
없고, 증거를 들고 행을 고쳐야만 바뀐다. 현재 blocker는 **`writer` · `title` · `client_ip` ·
`reply_status`** 넷이다.

## 19. Part A — 기존 판매자 답변의 행위자 관측 (manifest 작성, **미실행**)

계약이 답할 수 없는 것은 하나뿐이다: **이 판매자가 이미 쓴 답변이 실제로 무엇을 담고 있는가.**
그건 읽으면 알 수 있고, 읽을 대상은 이미 우리 DB가 증명해 두었다.

### 대상 — 새로 찾지 않는다

`Cafe24ThreadRepair`가 기록한 **`thread_role='REPLY'` 44행**과 각 행이 지목한
**`thread_parent_external_id` 44개**. 둘의 합집합은 **87개 article**(한 건은 답글의 답글이라 부모가
답글 집합 안에 있다 — depth 2). 이 번호들은 승인된 이전 READ의 산출물이고, 관측은 그 밖의 어떤
번호도 만들지 않는다. 부모를 지목하지 못하는 행은 **추정하지 않고 건너뛴다**.

窓도 없고 이웃 스캔도 없다: `article_no` 콤마 필터만 쓴다(계약이 공표한 형태).

### 나가는 것과 나가지 않는 것

`Cafe24ReplyActorProbe`는 SellerOps에서 **유일하게 Cafe24 article의 사람 필드를 실체화하는
곳**이다 — `writer` · `member_id` · `client_ip` · `title`. 질문이 문자 그대로 "실제 답변이 이 중
무엇을 담고 있는가"이기 때문이고, 그래서 그 필드들은 다른 어디에도 없다. 값은 `observe()` 안에서
**존재 플래그 · 동일성 클래스(sha-256, 비교만 하고 출력 안 함) · 세 가지 제목 관계**로 접히고,
public `Report`는 **수와 플래그뿐**이다 — 테스트가 record component 타입으로 강제한다.
`content`는 아예 파싱 필드가 없다.

로그로 나가는 것: 요청 수 · 응답/미응답 수 · 각 필드 존재 건수 · `member_id == mall_id` 건수 ·
writer 종류 수 · 부모의 `reply_status` C/P/N 분포 · 제목 관계 3분류 · `reply_depth` 최대값.

### 이 관측이 증명하지 못하는 것 (미리 적는다)

1. **`POST`의 `reply_status=C`가 부모를 `C`로 바꾸는지** — 기존 답변이 전부 「부모=C, 자식=null」로
   보여도 그것은 **WRITE의 side effect가 아니라 최종 상태**다. 관측은 *verification의 기대 상태*
   근거일 뿐, POST 한 번으로 그렇게 된다는 증명이 아니다.
2. **Cafe24 UI가 내부적으로 POST 외의 write를 하는지** — READ로는 알 수 없다.
3. `client_ip`가 응답에 **없을 수도 있다**. 없으면 그 사실 자체가 결과이고
   (`replyClientIpPresent=0`), 그때 `client_ip`는 관측이 아니라 **네트워크 구성 결정**으로 남는다.

관측과 WRITE semantics를 섞지 않는다.

### Approval Manifest — 실행 대기

| 항목 | 값 |
|---|---|
| 채널 / 계정 | CAFE24 · 데모 제조사 org의 API 계정 1개 |
| surface | `GET /api/v2/admin/boards/6/articles?article_no=…` (LIST, 콤마 필터) |
| operation | READ 전용 관측 |
| mode | **READ** |
| scope | `mall.read_community` (이미 보유, 변경 없음) |
| 대상 | 증명된 REPLY 44 + 그 부모 44 = **distinct 87 article** |
| 요청 수 | batch 25 ⇒ **4회**, 하드 상한 **6회** |
| WRITE | **0** — probe에 `postForm` 경로가 없고, 스텁이 호출되면 테스트가 실패한다 |
| DB 변경 | **0** |
| 미답변 고객 문의 접촉 | **0** (대상은 답변이 달린 스레드뿐) |
| 되돌리기 | 해당 없음(읽기) |

## 20. Part K — 운영 미답변 KPI 일관성 (실행됨, 호출 0)

product-owner 결정: **비밀글도 판매자가 처리해야 하는 업무이므로 canonical unanswered에 포함한다.
비밀 여부는 privacy/display 문제이지 workload 제외 조건이 아니다.**

고친 것은 이름이 같은데 코퍼스가 다른 두 숫자다. 홈 카드(`/api/dashboard/summary`)는 비밀글을
빼고 세고, overview KPI·Inbox·리포트·Operator는 빼지 않았다 — 그리고 **둘 다 「미답변 문의」라고
적혀 있었다**. 판매자가 어느 쪽이 틀렸는지 알 방법이 없었다.

- `DashboardService.summary`의 `unanswered`가 `countByOrgIdAndStatus`(비밀글 포함)를 읽는다.
- 같은 이유로 24시간 신규 문의 카드도 포함 기준으로 바꿨다 — **오늘 들어온 비밀글은 오늘 들어온
  업무다.** (결정문은 미답변만 명시했으나 근거가 동일해 함께 옮겼고, 여기에 적어 둔다.)
- `countByOrgIdAndStatusExcludingSecret` · `countByOrgIdAndReceivedAtAfterExcludingSecret`는
  **삭제했다.** 남겨 두면 같은 이름으로 다시 집계될 두 번째 코퍼스가 코드에 남는다.
- 비밀 content 자체는 그대로 org 경계 안에 있고, 일반 분석(item analysis) 제외도 그대로다 — 그건
  다른 질문이고 자기 술어를 유지한다.

실측(데모 제조사 org, REAL·ACTIVE·UNANSWERED): 전체 **25** · 비밀글 제외 **10** · 차이 **15 =
비밀글 15**. 이 수정으로 홈 카드는 10 → **25**가 되어 overview·Inbox와 같은 수를 말한다.

## 21. 이번 절에서 하지 않은 것

marketplace READ 0 · WRITE 0 · OAuth 변경 0 · `mall.write_community` 요청 0 · adapter 0 ·
reconsent 0 · Agent tool 변경 0. 행위자 추론 0, 과거 답변의 Answer Memory import 0.
