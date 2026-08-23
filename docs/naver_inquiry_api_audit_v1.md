# NAVER 문의 API 감사 v1 — 공식 계약과 저장소 사실

*2026-08-24 · marketplace 접촉 0 · 자격 증명 사용 0 · 이 문서는 공개 vendor 문서와 저장소 코드만 읽어서 쓴다.*

## 0. 이 문서가 정정하는 것

`docs/demo_org_and_channel_knowledge_v1.md` §5-586·§743과
`docs/multi-channel-connector-roadmap.md` §4.1 NAVER INQUIRY 행은 NAVER 문의를 통째로
**UNSUPPORTED / 미확정**으로 적어 왔다. 그 판단은 **공식 계약과 맞지 않는다.**

NAVER 커머스 API는 문의 도메인에 **읽기 endpoint 두 개**를 공식으로 제공한다
(`docs/vendor/naver-commerce-api/llms.txt` §문의, 2026-07-22 vendored):

| 무엇 | endpoint | 이 저장소의 subtype |
|---|---|---|
| 상품 문의 (스마트스토어 Q&A) | `GET /v1/contents/qnas` | `NAVER_PRODUCT_QNA` |
| 고객 문의 (네이버페이) | `GET /v1/pay-user/inquiries` | `NAVER_CUSTOMER_INQUIRY` |

**NAVER TalkTalk은 별개이고, 이 판단은 바뀌지 않는다** — 커머스 API 문의 도메인에 TalkTalk
endpoint가 없다. 없는 API를 추측하지 않고, 이번 package에서 Action Window도 만들지 않는다.

두 endpoint의 원문은 이 커밋에서 vendor 사본으로 고정했다:
`docs/vendor/naver-commerce-api/get-v1-contents-qnas.md` ·
`docs/vendor/naver-commerce-api/get-v1-pay-user-inquiries.md`.

## 1. A. 상품 문의 — `GET /v1/contents/qnas`

**공식 문서에서 읽은 것 (추측 아님):**

| 항목 | 계약 |
|---|---|
| pagination | `page` (int32, **첫 페이지 = 1**) · `size` (int32, **페이지당 최대 100**) |
| 페이징 종료 판정 | 응답 `totalElements` · `totalPages` · `first` · `last` |
| 조회 기간 | `fromDate` · `toDate` **둘 다 필수**, `string(date-time)` ISO 8601 |
| 답변 필터 | `answered` (boolean) — `false`면 미답변만 |
| 문의 식별자 | `contents.questionId` (int64) |
| 등록 시각 | `contents.createDate` (date-time) |
| 본문 | `contents.question` (string) |
| 판매자 답변 | `contents.answer` (string) |
| 답변 여부 | `contents.answered` (boolean) |
| 상품 식별자 | `contents.productId` (**int64**) |
| 상품명 | `contents.productName` (string) |
| 작성자 | `contents.maskedWriterId` (마스킹된 식별자) |
| 오류 | 400 `BAD_REQUEST` · 401 `UNAUTHORIZED` · 403 `FORBIDDEN` · 404 `NOT_FOUND` · 500 `INTERNAL_SERVER_ERROR` |
| rate-limit | endpoint 문서에 없음. 채널 공통 계약이 지배 — `intro-restriction.md`: 429 `GW.RATE_LIMIT`(초당 토큰버킷, 앱·API 단위) / 429 `GW.QUOTA_LIMIT`(판매자 리소스 단위). `Retry-After` 없음, 헤더로 잔량만 제공 |
| retry 권고 | 문서 본문: 500은 지수 백오프 재시도, `totalPages`로 종료 조건을 두어 **무한 루프 방지** |

**문서가 스스로 말하는 routine semantics** — "직전 호출의 `toDate`를 다음 호출의 `fromDate`로
**약간 겹쳐** 호출하는 워크플로우가 안전"하다. 즉 이 API의 정기 수집 창은 *고정 N일*이 아니라
**직전 관측 지점 + 겹침**이다. 임의의 "28일" 같은 값을 만들 근거가 이 문서에는 없다.

**공식 문서에 없는 것 (그러므로 만들지 않는다):**
- **비밀글/공개 여부 필드가 없다.** Cafe24 `is_secret`에 해당하는 것이 이 응답에 없으므로
  NAVER 상품 Q&A는 `is_secret = null`(= 분류하지 않음)로 남는다. 없는 필드를 추측하지 않는다.
- **주문 식별자가 없다.** 상품 Q&A는 주문에 매이지 않는다.
- **최대 조회 기간 길이가 명시돼 있지 않다.** 문서는 "기간 길이 검증 실패 시 400"이라고만 한다 ⇒
  기간은 짧게 잡고, 400을 실패로 취급한다(넓혀 보며 탐색하지 않는다).

**해결되지 않은 식별자 질문 (live-verifiable, 이 문서에서 결정하지 않음):**
`contents.productId`가 **채널상품번호(`channelProductNo`)인지 원상품번호(`originProductNo`)인지
공식 문서가 말하지 않는다.** 이 저장소의 `channel_products.external_product_id`는
`NaverProductsClient` 기준 **`channelProductNo`**다(`NaverProductsClient:182`).
⇒ 귀속은 **정확 일치**로만 하고, 일치하지 않으면 **귀속하지 않는다**. 어느 쪽인지는 라이브 1회가
답한다(일치율이 곧 답이다). 이름 매칭으로 메우지 않는다.

## 2. B. 고객 문의 — `GET /v1/pay-user/inquiries`

| 항목 | 계약 |
|---|---|
| pagination | `page` (**1 ~ 1000000**) · `size` (**페이지당 10 ~ 200**) |
| 페이징 종료 판정 | `totalPages` · `totalElements` · `first` · `last` · `numberOfElements` |
| 조회 기간 | `startSearchDate` · `endSearchDate` **둘 다 필수**, **`yyyy-MM-dd`** (문의 **등록일** 기준) |
| 답변 필터 | `answered` (**string** `"true"`/`"false"`) — 생략 시 전부 |
| 문의 식별자 | `content.inquiryNo` (int64, **필수**) |
| 등록 시각 | `content.inquiryRegistrationDateTime` (`yyyy-MM-dd'T'HH:mm:ss.SSSXXX`, 필수) |
| 제목 / 본문 | `content.title` (필수) · `content.inquiryContent` (필수) |
| 판매자 답변 | `content.answerContent` · `content.answerContentId` · `content.answerRegistrationDateTime` · `content.answerTemplateNo` |
| 답변 여부 | `content.answered` (boolean, 필수) |
| 문의 유형 | `content.category` — 상품·배송·반품·교환·환불·기타 |
| 주문 식별자 | `content.orderId` (string, **필수**) · `content.productOrderIdList` (쉼표 구분) |
| 상품 식별자 | `content.productNo` (**string**, 선택) · `content.productName` · `content.productOrderOption` |
| **구매자 PII** | `content.customerId` · `content.customerName` (**필수 필드**) |
| 오류 | 400 · 401 · 404 · 405 · 406 · 415 · 500 |
| retry 권고 | 문서 본문: 500은 백오프 재시도, **동일 페이지 연속 실패일 때만** 운영자 알림 |

**PII가 이 응답에는 실제로 들어온다.** `customerId`/`customerName`은 필수 응답 필드다. 저장소의
기존 계약(`CanonicalInquiry` javadoc, `IngestionService` — "Buyer PII (row.author()) is
intentionally NOT persisted")이 여기에 그대로 적용된다: **읽고 버린다. 저장하지 않고, 로그에
찍지 않고, 어떤 dedupe key에도 넣지 않는다.**

**상품 Q&A와 중복될 가능성** — 없다고 볼 근거가 계약에 있다: 식별자 공간이 다르고
(`questionId` vs `inquiryNo`), 상품 Q&A는 리스팅에 달리고 고객 문의는 **주문**에 달린다
(`orderId` 필수). 다만 dedupe key는 **subtype으로 namespace**해서 두 번호 공간이 우연히
겹치더라도 충돌할 수 없게 만든다.

**해결되지 않은 것 (live-verifiable):**
- `content.productNo`가 어떤 상품번호인지 명시가 없다 — 상품 Q&A와 같은 취급(정확 일치 또는 무귀속).
- endpoint 설명문이 "네이버페이 **구매회원으로 등록된 본인 계정**에 누적된 고객 문의"라고 쓰여
  있다. 판매자 애플리케이션 토큰으로 호출했을 때 **판매자가 받은 문의**가 내려오는지는 문서만으로
  단정할 수 없다. 라이브 1회가 답한다. 답이 "아니오"여도 그것이 결과이고, 그때는
  `NAVER_CUSTOMER_INQUIRY`가 `NEEDS_VERIFICATION`에서 올라가지 않는다.
- 권한 그룹: 두 endpoint 모두 애플리케이션이 **문의 API 그룹 권한**을 가져야 한다
  (`intro-restriction.md` §권한 그룹). 권한이 없으면 403이며, **우회하지 않는다** — 판매자가
  자기 애플리케이션에 권한을 추가하는 행동이다(NAVER PRODUCT 권한과 같은 선례, §4.1).

## 3. 저장소 사실 — 지금 있는 것과 없는 것

| 사실 | 근거 |
|---|---|
| `DataType.INQUIRY`는 이미 1급 타입이다 | `connector/DataType.java` |
| `NaverApiConnector`는 ORDER_SUMMARY · PRODUCT만 라우팅하고 나머지는 `UnsupportedDataTypeException` | `NaverApiConnector:144` |
| NAVER 커넥터 전체가 `sellerops.connector.naver.enabled` 뒤에 있고, 클라이언트가 없으면 그 capability를 **광고하지 않는다** | `NaverConnectorConfiguration` · `NaverApiConnector:85` (products null ⇒ PRODUCT 미광고) |
| 정규 문의 모델은 `inquiries` 테이블 + `CanonicalInquiry` | `inquiry/Inquiry.java` |
| `inquiries.product_id`는 **nullable** (V1) | `V1__init.sql:78` |
| 문의에 **source subtype 컬럼이 없다** | `Inquiry.java` 전체 |
| 문의 ingest는 항상 `productService.resolveOrCreate(productName, sku)` — 이름으로 찾고 **없으면 만든다**. 이름도 sku도 없으면 `(미지정 상품)`을 만든다 | `IngestionService:177` · `ProductService:64` |
| 채널 상품 identity는 `(channel_id, external_product_id)` 유일키이고, NAVER는 거기에 **`channelProductNo`**를 넣는다 | `ChannelProductRepository.findByChannelIdAndExternalProductId` · `NaverProductsClient:182` |
| 이름으로 product를 만들지 않는 선례가 이미 있다 | `ProductService.findBySku` javadoc (Cafe24 review promotion) |
| routine / historical 2-lane 원칙이 이미 코드에 있다 | `Cafe24ArticleCursor.routineWindow` · `NaverOrdersClient.ROUTINE_MAX_LAG = 14일` |
| `ROUTINE_MAX_LAG` 14일은 **이 저장소가 이미 "최근 운영 수집"이라고 정의한 값**이며 새로 만든 값이 아니다 | `NaverOrdersClient:104-111` |
| answered 문의는 unanswered queue에 들어가지 않는다 — 이미 그렇게 되어 있다 | `IngestionService:245` (`openWorkItem`은 `UNANSWERED`일 때만) |
| Cafe24 SPAM dismissal은 **Cafe24 rule**이며 채널 간 복사 대상이 아니다 | `InquiryOperationalState` · `docs/inquiry_operational_truth_v1.md` |
| 재수집 시 변화 없어도 `last_seen_at`을 남긴다 (absence ≠ 삭제) | `IngestionService:200` |
| 합성 데이터는 `RealDataOnly` 필터로 기본 읽기에서 빠진다 | `Inquiry` `@Filter` |

## 4. 이 감사가 만든 안전 발견 — **capability를 켜면 스케줄이 저절로 생긴다**

`SelfPilotReconciler.ROUTINE_TYPES = (REVIEW, INQUIRY, ORDER_SUMMARY)`이고, reconciler는
CONNECTED 계정에 대해 **커넥터가 지원한다고 말하는** 타입의 60분 schedule을 없으면 만든다
(`SelfPilotReconciler:160-165`). 즉 `NaverApiConnector.capabilities()`에 `INQUIRY`를 넣는
순간, canonical Demo Org의 NAVER 계정에 **60분 routine이 자동 생성되어 라이브 호출이 시작된다** —
승인 없는 마켓플레이스 접촉이다.

그래서 이 package는 두 개의 fence를 둔다.

1. **문의 클라이언트는 자기 플래그 뒤에 있다** (`sellerops.connector.naver.inquiry.enabled`,
   기본 `false`). 플래그가 꺼져 있으면 빈이 없고, 커넥터는 INQUIRY를 **광고하지 않는다** —
   PRODUCT 클라이언트가 없을 때 PRODUCT를 광고하지 않는 것과 같은 모양.
2. **자동 스케줄은 `CONFIRMED` capability에만 생긴다.** live proof 전 NAVER INQUIRY는
   `NEEDS_VERIFICATION`이므로 reconciler가 만들지 않는다. 오늘 자동 생성되는 capability는
   전부 이미 `CONFIRMED`이므로 (`Cafe24 ORDER/REVIEW/INQUIRY`, `Coupang ORDER/INQUIRY`,
   `NAVER ORDER`) 이 fence는 **현재 동작을 하나도 바꾸지 않는다**. `NEEDS_VERIFICATION`을
   달고 있는 것은 PRODUCT뿐이고 PRODUCT는 애초에 `ROUTINE_TYPES`가 아니다.

이 두 번째 fence가 이 package의 일반 원칙이다: **광고는 도달 가능성이고, 자동 반복은 증명이다.**

## 5. 남은 분류

| 질문 | 분류 |
|---|---|
| 두 endpoint의 요청/응답 계약 | **저장소·문서 확인 완료** (§1·§2) |
| `contents.productId` / `content.productNo`가 어느 상품번호인가 | **라이브 1회로만 확인 가능** — 정확 일치 시도 후 일치율을 기록 |
| `pay-user/inquiries`가 판매자 토큰으로 판매자 문의를 주는가 | **라이브 1회로만 확인 가능** |
| 문의 API 그룹 권한을 이 애플리케이션이 가졌는가 | **라이브 1회로만 확인 가능** (403이면 판매자 행동, 우회 없음) |
| 두 source를 한 schedule로 묶을지 | **PART 2** — failure isolation을 라이브에서 보고 결정 |
| TalkTalk | **커머스 API 미지원 유지** — coverage limitation |
