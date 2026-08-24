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
