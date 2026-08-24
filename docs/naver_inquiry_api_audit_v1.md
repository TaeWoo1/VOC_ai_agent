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

---

## 6. 구현 — 무엇이 만들어졌고, 무엇이 켜져 있지 않은가

*2026-08-24, 마켓플레이스 호출 0회. 아래는 전부 offline 회귀로 증명된 것이다.*

| 만든 것 | 무엇 |
|---|---|
| `NaverProductQnaClient` | `GET /external/v1/contents/qnas` — page 1-based, size 100(리소스 상한), 종료는 `last`→`totalPages` 순 |
| `NaverCustomerInquiriesClient` | `GET /external/v1/pay-user/inquiries` — page 1-based, size 200(리소스 상한), `yyyy-MM-dd` |
| `NaverInquiryCursor` | 두 source가 각자의 lane을 갖는 하나의 cursor. routine / bounded 구분 |
| `NaverInquiryCollector` | 한 run이 한 source를 끝까지 쓸고 다른 source로 넘어간다. 배선되지 않은 source는 **호출되지 않는다** |
| `InquirySourceSubtype` | `NAVER_PRODUCT_QNA` · `NAVER_CUSTOMER_INQUIRY` (닫힌 어휘, `inquiries.source_subtype`) |
| `ChannelProductRef` | "이 행은 채널 식별자로만 귀속한다"는 선언. 있으면 이름 경로가 **도달 불가**가 된다 |
| `inquiries.answer_body` / `answered_at` | 판매자가 플랫폼에 이미 남긴 답변. 채널 중립, 없는 source는 NULL |
| `SelfPilotReconciler` fence | 자동 routine schedule은 **`CONFIRMED` capability에만** 생긴다 |

**켜져 있지 않은 것:** `sellerops.connector.naver.inquiry.product-qna.enabled` ·
`…inquiry.customer.enabled` 둘 다 **기본 `false`**. 둘 다 꺼져 있으면 커넥터는 INQUIRY를 **광고조차
하지 않고**, 런타임 동작은 이 package 이전과 바이트 단위로 같다.

### 6.1 회귀

backend **2,779 tests · 0 failures · 0 errors** (이전 2,738 → **+41**). 새 테스트가 고정하는 것:

| 무엇 | 어디 |
|---|---|
| 두 리소스의 요청 파라미터가 공식 계약 그대로 | `NaverInquirySourcesTest` (15) |
| 없는 필드는 주장하지 않는다 (비밀글·raw token·answer 시각·제목) | 같은 곳 |
| `customerId`/`customerName`이 canonical row 어디에도 없다 | 같은 곳 |
| 두 식별자 공간이 namespace로 갈라져 있다 | 같은 곳 |
| 첫 창은 14일(기존 `ROUTINE_MAX_LAG`), 다음 창은 직전 끝에서 열린다 | `NaverInquiryRecurrenceTest` (10) |
| 뒤처진 routine cursor는 backlog를 걷지 않고 재시작한다 | 같은 곳 |
| 완주한 sweep은 커서를 끝 너머에 주차하지 않는다 (PRODUCT 결함) | 같은 곳 |
| 한 source만 배선하면 다른 source는 **0회** 호출된다 | 같은 곳 |
| 배선 없으면 INQUIRY를 광고하지 않고, 배선되면 `NEEDS_VERIFICATION` | `NaverInquiryCapabilityFenceTest` (6) |
| 미검증 capability는 자동 schedule을 얻지 못한다 | `SelfPilotReconcilerTest` |
| 식별자 귀속: 정확 일치 또는 무귀속. **상품 생성 0** | `IdentifierProductAttributionTest` (9) |
| 이름이 같은 두 리스팅이 합쳐지지 않는다 | 같은 곳 |
| 이름/SKU 경로는 기존 source에 대해 **불변** | 같은 곳 |

read-only fence(`NaverReadOnlyFenceTest`)는 **더 정밀해졌다**: 마커가 명사 `answer`에서
**write 경로**(`/external/v1/pay-merchant`, `qnas/`, `/answer`)로 바뀌었다. 명사 마커는 GET 응답의
`answerContent`를 읽는 것과 답변을 등록하는 것을 구별하지 못했다.

## 7. 라이브 read manifest (준비) — **실행하지 않았다**

**상태: 준비됨. 마켓플레이스 호출 0회.** 아래는 전부 코드·로컬 DB에서 확인한 사실이다.

### 7.0 먼저 — 지금은 실행할 수 없다 (판매자 행동 필요)

canonical Demo Org의 NAVER 계정은 **`RECONNECT_REQUIRED`**다.

| 사실 | 값 |
|---|---|
| 계정 상태 | `RECONNECT_REQUIRED` (`seller_accounts`, 2026-08-24 조회) |
| 마지막 성공 | `ORDER_SUMMARY` SUCCESS 2026-08-23 14:17 KST |
| 그다음 | `ORDER_SUMMARY` **FAILED** 2026-08-23 15:18 KST — `CREDENTIAL_REJECTED` |
| 지금 schedule | `ORDER_SUMMARY` 60분 · `PRODUCT` 1440분 — **둘 다 auth-paused** |

**자격 증명 재연결은 판매자의 행동이다.** 우회하지 않고, 대신 호출하지 않는다. 재연결 전에는 두
문의 endpoint 어느 쪽도 200을 줄 수 없으므로, 이 manifest는 **재연결 이후에** 유효하다.

부수 효과로 확인된 것: 계정이 `CONNECTED`가 아니므로 self-pilot reconciler는 어떤 schedule도 만들지
않는다. §4의 fence와 **독립적으로** 지금은 자동 호출이 불가능하다.

### 7.1 baseline — 이 proof가 움직여야 할 숫자

| 값 | 지금 |
|---|---|
| NAVER 채널의 `inquiries` 행 | **8건 — 전부 `DEMO_SEED`** (합성). 기본 읽기에서 `RealDataOnly`가 제외한다 |
| NAVER **REAL** 문의 | **0건** |
| `source_subtype`을 가진 행 | 0 (컬럼이 방금 생겼다) |
| NAVER `channel_products` | **77 리스팅** — 상품 귀속이 맞을 수 있는 후보의 전부 |

합성 8건은 **REAL 결과에 섞이지 않는다.** proof의 성공 기준은 "REAL 문의가 0에서 N이 되는가"이지
"문의가 8에서 8+N이 되는가"가 아니다.

### 7.2 manifest — run A · 상품 문의만

| 필드 | 값 |
|---|---|
| channel | `NAVER` (`9e53507e…`) |
| org / account | canonical Demo Org · 기존 계정 **재사용** (새 계정 만들지 않음) |
| DataType | **`INQUIRY` 하나.** ORDER_SUMMARY / PRODUCT / REVIEW는 이 run에서 호출하지 않는다 |
| source | **상품 문의 1개.** `…inquiry.product-qna.enabled=true`, `…inquiry.customer.enabled=false` |
| operation | 경계 있는 1회 읽기 (`POST /api/seller-accounts/{id}/sync {"dataType":"INQUIRY"}`, trigger `MANUAL`) |
| 기간 | 운영자가 고르는 bounded window (routine lane 아님) — cursor `bounded=true`, 재계산·확장 없음 |
| mode | **`READ_ONLY`** |
| SellerOps의 라이브 액션 | **GET 하나뿐**: `GET /external/v1/contents/qnas?fromDate&toDate&page&size=100` (+ 토큰 mint 1회) |
| WRITE | **0 — 구조적으로.** 두 client에 GET 외의 메서드가 없고, `NaverHttpClient`에 put/delete/patch가 없으며, `NaverReadOnlyFenceTest`가 답변 등록 경로 3종을 이름으로 거부한다 |
| 요청 볼륨 | **⌈N/100⌉ + 1.** 상세 조회가 **없다** — 목록 리소스가 질문·답변·상품번호를 전부 준다 (Coupang PRODUCT proof의 N+⌈N/10⌉과 다른 점) |
| 기존 schedule | 재연결로 되살아난 `ORDER_SUMMARY`/`PRODUCT` routine은 **건드리지 않는다** |
| INQUIRY schedule | **만들지 않는다 — 코드가 이미 그렇다.** capability가 `NEEDS_VERIFICATION`이라 reconciler가 건너뛴다 (§4) |
| 되돌릴 수 없는 것 | 없음. 읽기뿐이고 재실행은 `external_id` 멱등이다 |

### 7.3 manifest — run B · 고객 문의만

run A와 동일하되 **플래그가 반대**다 (`product-qna=false`, `customer=true`), endpoint는
`GET /external/v1/pay-user/inquiries?startSearchDate&endSearchDate&page&size=200`,
요청 볼륨은 **⌈N/200⌉ + 1**.

두 run을 나누는 이유는 하나다: **한 endpoint의 403·페이지 수·귀속률이 다른 endpoint의 것과 섞이지
않게** 하기 위해서다. 어느 쪽이 실패해도 다른 쪽의 결과는 그대로 읽힌다.

### 7.4 이 proof가 실제로 답하는 질문 (지금은 답할 수 없는 것들)

1. **`contents.productId`가 채널상품번호인가 원상품번호인가** — 77개 리스팅에 대한 일치율이 답이다.
   일치 0이면 원상품번호이며, 그때는 이름으로 메우지 않고 **관측을 기록하고 멈춘다**.
2. **`content.productNo`도 같은 질문** — 그리고 `productNo`가 실제로 내려오기는 하는지(선택 필드).
3. **`/v1/pay-user/inquiries`가 판매자 토큰으로 판매자 수신 문의를 주는가** — 문서 설명문이
   "구매회원 본인 계정"이라고 쓰여 있어 단정할 수 없다. 아니면 `NEEDS_VERIFICATION`에서 올라가지 않는다.
4. **애플리케이션이 문의 API 그룹 권한을 갖고 있는가** — 403이면 판매자 행동이며 우회하지 않는다.
5. **REAL 문의가 실제로 존재하는가** — 0건도 결과다. `ZERO`와 `NOT_SUPPORTED`는 같은 뜻이 아니고,
   그 구분이 PART 3의 전제다.

### 7.5 승인

`docs/sellerops_live_approval_contract.md`. 이 run은 **READ_ONLY**이고 WRITE 승인을 요구하지 않는다.
채널/계정/범위가 바뀌거나 코드·브랜치가 바뀌면 승인은 `REVOKED`이며 다시 받는다.

**여기서 멈춘다.** 위 두 run 중 어느 것도 실행하지 않았다.

### 7.6 Run A 사전 상태 (2026-08-24, 마켓플레이스 호출 0회)

| 확인 | 값 | 방법 |
|---|---|---|
| NAVER seller account | **1개** — 기존 `bdccb7a7…` 재사용. 새로 만들지 않음 | DB |
| 계정 상태 | `RECONNECT_REQUIRED` | DB |
| **credential sealed / open** | **`status: OK`** — `sealedKeyFingerprint` == `availableKeyFingerprint` == `IWLweMSEqoTt…`, `keyId` == `activeKeyId` == `self-pilot-1`, `sellerActionable: false` | `GET /api/seller-accounts/{id}/credential-diagnosis` (채널 호출 없음) |
| ⇒ 진단 | **금고 문제가 아니다.** 저장된 자격 증명은 활성 키로 열린다. NAVER가 거부한 것은 `client_id`/`client_secret` 자체다 (2026-08-23 15:18 `CREDENTIAL_REJECTED`) | 위 두 줄 |
| INQUIRY schedule | **0** — capability가 `NEEDS_VERIFICATION`이라 reconciler가 만들지 않는다 | DB |
| ORDER_SUMMARY / PRODUCT schedule | **운영자 pause로 전환 완료** (`enabled=false`, `paused_reason=null`, `next_run_at=null`) | `PUT …/schedule` |
| 두 source 플래그 | **둘 다 미무장** — `backend/.env.local`에 `…NAVER_INQUIRY…` 항목 없음 | grep |

#### 재연결이 두 schedule을 되살린다 — 그래서 먼저 껐다

`SellerAccountReauthService.onReconnected`는 `paused_reason`이 있는 schedule을
`enabled=true, next_run_at=now`로 **되살린다**. 즉 재연결 직후 `ORDER_SUMMARY`(60분) ·
`PRODUCT`(1440분) routine이 즉시 뜨고, 그 요청과 로그가 Run A의 것과 섞인다.

경합에 기대지 않고 **재연결 전에** 둘을 운영자 pause로 바꿨다. 두 행은 `paused_reason`
하나만 다르고 둘 다 `enabled=false`이며, `onReconnected`는 이유가 있는 행만 되살린다 —
그 성질은 javadoc 문장이었고 이제 `SellerAccountReauthServiceTest`가 고정한다.

**복원 기준선** (proof 후 되돌릴 값 — auth 사고 이전 상태):

| data type | cadence | enabled |
|---|---|---|
| `ORDER_SUMMARY` | INTERVAL 60분 | `true` |
| `PRODUCT` | INTERVAL 1440분 | `true` |

#### Run B 사전 조건 — privacy fence, offline 증명 완료

`NaverInquiryPrivacyFenceTest` (6 tests). 고객 문의는 이 저장소에서 **처음으로 구매자 이름을
주는 리소스**이므로, 규칙이 "받은 적이 없어서 지켜진다"에서 "구조로 지켜진다"로 바뀌어야 했다.
나갈 수 있는 문 네 개를 각각 막고 고정했다:

| 문 | 고정된 것 |
|---|---|
| projection record | `CustomerInquiry`에 `customerId`·`customerName`·`orderId`·`productOrderIdList` **선언 자체가 없다** |
| canonical row | 실제 PII를 담은 전체 응답을 파싱해도 row 전체 렌더링에 이름·구매자ID·주문번호가 **없다** |
| 로그 | naver 패키지의 모든 `log.*` 인자에서 count 식(`…​.size()`)을 지운 뒤, body·content·row 전달이 **0건** |
| 예외 메시지 | 파싱 실패·HTTP 500 모두 상태코드만 말하고 응답 본문을 싣지 않는다 |

로그 fence는 단어 `rows`를 금지하지 않는다 — count를 먼저 지우고 본다. `rows={}`는 **몇 개인지**이고
규칙은 **무엇인지**에 대한 것이다.

**Run B는 실행하지 않는다.** Run A 결과 보고 후 별도로 판단한다.

---

## 8. Run A 라이브 결과 (2026-08-24) — 상품 문의는 **된다**, 그리고 `productId`는 채널상품번호였다

**canonical Demo Org · 기존 계정 `bdccb7a7…` 재사용 · `NAVER_PRODUCT_QNA` 단독 무장 ·
`READ_ONLY` · WRITE 0.** 고객 문의 플래그는 무장되지 않았으므로 `/pay-user/inquiries`는
**호출될 수 없었다**.

| 축 | 값 |
|---|---|
| run | `468960bb…` · `MANUAL` · `NAVER_API` · **`SUCCESS`** · 04:13:03→04:13:04 UTC (**1.35초**) |
| 창 | 2026-06-01 ~ 2026-08-24 (bounded, 운영자 범위 · routine lane 불변) |
| **요청 수** | **2회** — 토큰 발급 1 + `GET /external/v1/contents/qnas` 1. 페이지 `1/1`, `last=true` |
| received / mapped / inserted / skipped / failed | **13 / 13 / 13 / 0 / 0** |
| `questionId` uniqueness | **13행 = 13개 고유 external id** (namespace `naver-qna:`) |
| createDate 범위 | **2026-06-02 ~ 2026-08-19** |
| answered / unanswered | **13 / 0** — 전부 답변 완료. 답변 본문도 **13/13** 보존 |
| **열린 작업 항목** | **0** — answered는 history이지 셀러의 할 일이 아니다 |
| `source_subtype` | **13/13 `NAVER_PRODUCT_QNA`** |
| provenance | **13/13 `REAL`** |
| **productId coverage** | **13/13** — 모든 행이 상품번호를 들고 왔다 |
| **exact external-id match rate** | **13/13 = 100%** (`channel_products.external_product_id`, NAVER 리스팅 77개 대상) |
| canonical product attribution | **canonical product 6개**에 붙었다 |
| **unmapped productId** | **0** |
| 401 / 403 / 429 / WARN / ERROR | **0 / 0 / 0 / 0 / 0** |
| 생성된 상품 | **0** — `products` 320 → 320 |
| 합성 행 | **불변** — NAVER `DEMO_SEED` 8건 그대로, REAL 결과와 섞이지 않음 |
| INQUIRY schedule | **0** (run 전·중·후) |
| 계정 상태 | `PREPARING` **불변** — `ORDER_SUMMARY`만 CONNECTED 전이를 일으킨다 |

### 8.1 답이 나온 것 — `contents.productId`는 **채널상품번호**다

§1이 남겨 둔 질문의 답이다. 공식 문서는 어느 상품번호인지 말하지 않았고, 이 저장소는 리스팅을
**채널상품번호**로 키를 잡는다. 정확 일치를 시도했더니 **13/13이 붙었다** — 원상품번호였다면
일치는 0이었을 것이다. 추론이 아니라 관측이다.

붙은 리스팅(상품번호 → 건수): `6473457702` 6 · `9782702719` 2 · `9810503967` 2 ·
`557622761` 1 · `6355372669` 1 · `9809699005` 1.

이름 fallback도 placeholder 생성도 **한 번도 필요하지 않았다**. 필요했더라도 코드가 그것을 하지
않았을 것이고, 그때의 답은 무귀속이었다.

### 8.2 답이 나오지 않은 것

- **고객 문의는 여전히 미검증이다.** 호출되지 않았다.
- **13건이 전부 answered였다** — 미답변 문의가 unanswered queue에 들어가는 경로는 이 run이
  증명하지 못했다(열린 작업 항목 0이 정답인 상황이었다).
- **재수집 멱등은 아직 관측되지 않았다.** 같은 창을 한 번 더 읽으면 `stored=0 / skipped=13`이
  나와야 하고, 그것이 routine을 논하기 전의 가장 싼 다음 증명이다(요청 2회).
- **이 창 밖은 모른다.** 2026-06-01 이전 상품 문의는 읽지 않았다.

### 8.3 capability 갱신 — 관측된 범위만

verification 상태를 **리소스별로** 옮겼다. 런타임은 DataType당 단어 하나를 갖는데 NAVER는
문의 리소스가 둘이므로, 접는 방향이 보수적이어야 한다:

> **배선된 모든 source가 라이브로 증명됐을 때만 `CONFIRMED`.**

한 source만 증명된 채 다른 source가 배선돼 있으면 그 타입의 run은 둘 다 호출하므로, 타입은
증명되지 않은 것이다. proof를 source 하나만 무장해서 돌리는 이유도 같다 — "이 endpoint는
된다"가 endpoint에 대한 문장이지 혼합물에 대한 문장이 아니게 만든다.

| source | 상태 | 근거 |
|---|---|---|
| `NAVER_PRODUCT_QNA` | **`CONFIRMED`** | 이 run |
| `NAVER_CUSTOMER_INQUIRY` | `NEEDS_VERIFICATION` | 호출된 적 없음 |
| NAVER TalkTalk | 커머스 API **미지원** | 변화 없음 |

### 8.4 run 후 상태 — 무장 해제하고 원복했다

`CONFIRMED`가 된 capability는 계정이 `CONNECTED`가 되는 순간 **60분 INQUIRY routine을 자동
생성한다**. 그것은 PART 2의 결정이지 Run A의 부산물이면 안 되므로 **상품 문의 플래그를 다시
내렸다** — INQUIRY는 지금 광고되지 않는다(`supported=false`). 수집된 REAL 13건은 그대로 남는다.

`ORDER_SUMMARY` 60분 · `PRODUCT` 1440분은 **사고 이전 상태(enabled)로 복원**했다.

---

## 9. Run B 라이브 결과 (2026-08-24) — 고객 문의도 **된다**, 그리고 그것은 판매자의 화면이다

**canonical Demo Org · 기존 계정 `bdccb7a7…` · `NAVER_CUSTOMER_INQUIRY` 단독 무장 ·
`READ_ONLY` · WRITE 0.** 상품 문의 플래그는 내려져 있었으므로 `/v1/contents/qnas`는
**호출될 수 없었다**.

**창은 새로 발명하지 않았다.** 이 리소스의 공식 계약에는 **최대 조회 기간이 명시돼 있지 않다**
(§2 — 400은 "일자 형식·범위 등"이라고만 한다). 그래서 Run A와 **같은 창**(2026-06-01~08-24)을
썼다: 이미 승인된 범위이고, 두 source를 나란히 비교할 수 있게 한다.

| 축 | Run B | Run B2 (동일 창 재독) |
|---|---|---|
| run | `05872745…` `MANUAL` **`SUCCESS`** (1.32초) | `9063aea8…` `MANUAL` **`SUCCESS`** (0.17초) |
| **요청 / 페이지** | **2 / 1** (토큰 1 + 목록 1, `page 1/1 last=true`) | **2 / 1** |
| received / mapped / **inserted** / **skipped** / failed | 5 / 5 / **5** / 0 / 0 | 5 / 5 / **0** / **5** / 0 |
| 저장된 행 | 5 | **5 — 변화 없음** |
| `inquiryNo` uniqueness | **5행 = 5 고유** (`naver-payinq:`) | **중복 canonical row 0** |
| oldest / newest source time | **2026-06-09 / 2026-08-12** | 동일 |
| answered / unanswered | **5 / 0** | 동일 |
| `answer_body` / `answered_at` | **5/5 · 5/5** 보존 | 불변 |
| `source_subtype` | 5/5 `NAVER_CUSTOMER_INQUIRY` | 불변 |
| provenance | 5/5 `REAL` | 불변 |
| **product identifier coverage** | **5/5** — `content.productNo`가 실제로 내려온다 | 동일 |
| **exact product attribution** | **5/5**, canonical product **5개** | 불변 |
| **unattributed** | **0** | **0** |
| 401 / 403 / 429 / WARN / ERROR | **0 / 0 / 0 / 0 / 0** | 동일 |
| 신규 product | **0** (`products` 320 불변) | **0** |
| 열린 작업 항목 | **0** (전부 answered) · `inquiry_work_item` 3,338 불변 | 불변 |
| synthetic 행 | **불변** (NAVER `DEMO_SEED` 8) | 불변 |
| INQUIRY schedule | **0** | **0** |
| WRITE | **0** | **0** |

### 9.1 문서가 답하지 못한 seller-side semantics — 호출이 답했다

§2가 남긴 질문이다. 공식 설명문은 이 리소스가 "네이버페이 **구매회원으로 등록된 본인 계정**에
누적된 고객 문의"를 준다고 쓰여 있어, 문서만으로는 "이 **판매자**가 받은 문의"로 해석할 수 없었다.

**실제로는 판매자의 것이다.** 판매자 애플리케이션 토큰으로 호출했더니 5건이 내려왔고,
**5건 전부가 이 판매자 자신의 리스팅**(`channel_products.external_product_id` 정확 일치)을
가리켰으며, **5건 전부에 이 판매자가 직접 쓴 답변**이 들어 있었다. 남의 계정 문의가 이 셋을
동시에 만족할 수는 없다.

붙은 리스팅: `5538599862` · `6473457702` · `6479976384` · `9809699005` · `9809759315` (각 1건).
그리고 `content.productNo`도 **채널상품번호**다 — 상품 문의의 `productId`와 같은 번호 공간이다.

### 9.2 privacy fence — 라이브 확인

이 리소스는 `customerId`/`customerName`을 **필수 응답 필드로 실제로 보냈다.** 저장된 5행에서:

| 확인 | 결과 |
|---|---|
| canonical inquiry row | 구매자 식별자 **0** |
| DB persisted field | `author` **5/5 `NULL`** — 구매자 이름을 담을 수 있는 유일한 컬럼이 비어 있다 |
| application log | `customerName`·`customerId`·`orderId`·`productOrderIdList`·`inquiryContent`를 담은 로그 라인 **0** |
| raw response body logging | **0** — 로그는 건수·페이지·창만 말한다 |
| exception body | 발생 없음(오류 0). 구조는 `NaverInquiryPrivacyFenceTest`가 고정 |

저장된 것은 운영 내용뿐이다: 제목("배송중 파손건 문의" 등), 본문, 판매자 자신의 답변, 상품 귀속.

### 9.3 하지 않은 측정 — 주문 식별자 매칭

요청된 `knownSellerOrderMatches = X / N`은 **실행하지 않았다.** 이유를 적는다.

그 측정을 하려면 `content.orderId`를 projection record에 선언해야 하는데, 지금 그 필드가
**선언돼 있지 않다는 것 자체가** §9.2 첫 줄의 구조적 보장이다(`NaverInquiryPrivacyFenceTest` —
"선언되지 않은 필드는 나중에 한 줄로 저장되기 시작할 수 없다"). 일회성 진단을 위해 상시
보장을 약화시키는 거래다.

그리고 그 측정이 답하려던 질문에는 **이미 더 강한 답이 있다**: §9.1의 상품 귀속 5/5와 판매자
자신의 답변 5/5. 주문 매칭은 같은 결론에 대한 더 약한 두 번째 신호였다.

필요해지면(예: 상품 귀속이 0%인 계정) 별도 패키지로 만든다 — 원본 id를 들지 않는 단방향 다이제스트
비교로.

### 9.4 source별 판정

| source | 판정 | 근거 |
|---|---|---|
| `NAVER_PRODUCT_QNA` | **`CONFIRMED`** | Run A — 13/13, `productId` 100% 일치, 신규 product 0 |
| `NAVER_CUSTOMER_INQUIRY` | **`CONFIRMED`** | Run B + B2 — 5/5, `productNo` 100% 일치, **재수집 멱등 실측**, PII 저장 0 |
| NAVER TalkTalk | **커머스 API 미지원** | 변화 없음 |

이제 `DataType.INQUIRY`의 fold도 `CONFIRMED`다(배선된 모든 source가 증명됨).

### 9.5 아직 증명되지 않은 것

- **`NAVER_PRODUCT_QNA`의 재수집 멱등** — `DEFERRED`. Run A 뒤 계정이 `CONNECTED`가 되어,
  재무장하면 `CONFIRMED` 광고가 살아나 routine이 proof의 부산물로 생길 수 있었다. 규칙대로 멈췄다.
  고객 문의 쪽에서 같은 upsert 경로가 멱등임이 실측됐으므로 **경로 자체는 증명됐고**, 상품 문의
  고유의 잔여 위험은 그 source의 external id 형식뿐이다.
- **미답변 문의가 unanswered queue에 들어가는 경로** — 두 run 모두 18건 전부 answered였다.
- **2026-06-01 이전** — 두 source 모두 읽지 않았다.
- **routine recurrence** — PART 2에서 두 source를 함께 결정한다.

### 9.6 proof 종료 순서 (지켜진 순서)

1. `CUSTOMER_INQUIRY` 플래그 **OFF** → 재시작
2. **INQUIRY schedule 0 · `supported=false`(미광고) 확인** · REAL 18건 보존 확인
3. **그 다음에** source verification 상태를 코드·문서에 반영
4. `ORDER_SUMMARY` 60분 · `PRODUCT` 1440분 **baseline 복원**

두 source가 모두 `CONFIRMED`가 된 지금, 플래그를 켜면 `CONNECTED` 계정에 60분 INQUIRY routine이
**자동 생성된다**. 그것이 PART 2의 결정이며, 그때까지 두 플래그는 내려져 있다.

---

## 10. Routine recurrence 감사 (PART 2, 2026-08-24) — 마켓플레이스 접촉 0회

여기까지는 **코드만 읽어서** 판정한 것이다. 라이브 결과는 §11부터.

### 10.1 두 lane의 실행 계약

| 축 | 실제 동작 | 근거 |
|---|---|---|
| **execution order** | `activeSource()`가 고른 **한 lane의 한 페이지**가 곧 한 번의 `fetch`. 저장된 `active`를 우선 존중하고, 그 lane이 끝났으면 남은 lane으로 넘어간다. 아무 상태도 없으면 상품 문의부터. | `NaverInquiryCursor.activeSource` |
| **independent cursor** | 한 커서 문자열 안에 **lane별 독립 필드**(`qna`, `customer` — 각자 `from`/`to`/`page`/`done`). `withQna`/`withCustomer`는 자기 lane만 쓴다. 다른 lane의 페이지 번호를 건드리는 경로가 없다. | `NaverInquiryCursor` |
| **cursor commit timing** | **행을 저장한 뒤에만** 커서를 advance·persist 한다. 실패한 페이지의 위치는 기록되지 않는다. | `SyncRunExecutor:396-400` |
| **retry** | lane 안의 자동 재시도는 **없다**. 429는 예외로 올라와 커서를 **바꾸지 않은 채** `FetchPage.rateLimited`로 바뀌고, executor는 즉시 페이징을 멈추고 `next_retry_at`만 남긴다. | `NaverApiConnector:219-222` |
| **request/page budget** | run당 `MAX_PAGES=10_000` guard. 한도에 닿으면 조용한 성공이 아니라 **에러로 끝난다**. lane별 종료는 리소스 자신의 `last`/`totalPages`. 페이지 크기는 각 리소스의 공표 상한(100 / 200). | `SyncRunExecutor:376, 422-428` |
| **overlap** | 다음 창의 시작 = 이전 창의 끝. 네이버가 상품 문의에 대해 직접 안내하는 방식 그대로이고, 발명한 여유값은 없다. 경계에서 재전달되는 행은 `questionId`/`inquiryNo` upsert로 흡수된다. | `resumeFrom`/`resumeDate` |
| **routine vs bounded** | 다른 **커서 행**이다. bounded seed는 `cursor_key='backfill'`, routine은 `'primary'`. 그래서 Run A/B의 승인 창은 routine lane의 출발점을 재정의하지 않았다 — 감사 시점에 `INQUIRY/primary` 행은 **존재하지 않는다**. | `SyncRunExecutor:352` |

### 10.2 canonical failure cases

| 경우 | advance하는 커서 | 다음 run이 다시 읽는 것 | 성공한 source가 history를 다시 걷는가 |
|---|---|---|---|
| **A 성공 / B 실패** | A lane만 (`done=true`로 persist). B의 실패 페이지는 기록되지 않음 | B의 같은 페이지부터. A는 `done`이라 **호출 0회** | **아니오** |
| **A 실패 / B 미시도** | 없음 | A의 page 1부터. B는 손대지 않았으므로 잃은 진행이 없음 | **아니오** |
| **A 비어 있음 / B 성공** | 둘 다 | 두 lane 모두 끝났으므로 다음 사이클이 창을 재계산 | **아니오** |
| **둘 다 성공** | 둘 다 | 경계를 공유하는 새 창 | **아니오** |

`hasMore`는 행 수가 아니라 **커서**에서 나온다(`!next.bothDone(...)`). 그래서 상품 문의가 0행인 날에도 고객 문의는 같은 run 안에서 반드시 읽힌다 — 이것을 행 수로 판정했다면 조용한 하루가 다른 source를 통째로 건너뛰게 만들었을 것이다.

**whole-run status**: 한 source의 실패는 `errored`를 세우고, 이미 들어온 행이 있으면 `PARTIAL`, 없으면 `FAILED`. 성공한 source의 카운트는 지워지지 않는다.

### 10.3 이번 package에서 고친 것 — 조용히 건너뛴 구간

`routineLag()`는 **상품 문의 lane만** 읽고 있었다. 고객 문의만 배선된 배포(=source별 proof가 만드는 바로 그 형상)에서는 `resumeDate`가 창을 천장으로 clamp 하므로 **동작은 안전했지만**, 건너뛴 구간을 아무도 말하지 않았다. clamp가 문제가 아니라 침묵이 문제다 — "건너뛴 구간은 운영자의 bounded backfill 대상"이라는 문장은 운영자가 그 구간이 생겼다는 걸 볼 수 있을 때만 참이다.

두 lane을 다 보고 **더 뒤처진 쪽**을 보고하도록 고쳤다. 관측 전용이며 어떤 창도 이 함수 때문에 움직이지 않는다. 새 scheduler 구조는 만들지 않았다.

회귀 4건 추가 (`NaverInquiryRecurrenceTest`): A성공/B실패 후 재개 · A 첫 페이지 실패 · A 비어 있음 hand-over · 어느 lane이든 stale이면 이름을 남긴다.

---

## 11. 라이브 manifest — routine recurrence (준비, **실행하지 않았다**)

### 11.1 사전 상태 (2026-08-24, 마켓플레이스 호출 0회)

| 확인 | 값 | 방법 |
|---|---|---|
| NAVER seller account | **1개** — 기존 `bdccb7a7…` 재사용 | DB |
| 계정 상태 | **`CONNECTED`** | DB |
| INQUIRY schedule | **0** | DB |
| `ORDER_SUMMARY` / `PRODUCT` | **운영자 pause 완료** (`enabled=false`, `paused_reason=null`, `next_run_at=null`). 복원 기준값: 60분 enabled / 1440분 enabled | `PUT …/schedule` |
| 두 source 플래그 | **둘 다 미무장** (`.env.local`에서 주석 처리) | grep |
| `INQUIRY/primary` 커서 | **없음** — Run A/B는 `backfill` 커서 행만 썼다. routine lane은 아직 한 번도 돈 적이 없다 | DB |
| REAL 문의 | **18** (상품 13 · 고객 5), 전부 `ANSWERED`, 귀속 18/18 | DB |
| 회귀 | **2,796 / 0 failures / 0 errors** (신규 4건 = §10.3) | `./gradlew test` |

### 11.2 manifest

| 필드 | 값 |
|---|---|
| channel / org / account | `NAVER` · canonical Demo Org · 기존 계정 재사용 |
| DataType | **`INQUIRY` 하나.** `ORDER_SUMMARY`/`PRODUCT`는 운영자 pause 상태로 이 proof 동안 호출 0 |
| mode | **`READ_ONLY`** |
| 라이브 액션 | **GET 두 종류뿐** — `GET /external/v1/contents/qnas`, `GET /external/v1/pay-user/inquiries` (+ 토큰 mint) |
| WRITE | **0 — 구조적으로.** 두 client에 GET 외 메서드 없음, `NaverHttpClient`에 put/delete/patch 없음, `NaverReadOnlyFenceTest`가 답변 등록 경로를 이름으로 거부 |

**세 번의 읽기, 이 순서로:**

| # | 무엇 | 어떻게 격리하는가 | 예상 요청 |
|---|---|---|---|
| **L1** | 상품 문의 직접 재독 — Run A와 **같은** bounded window `2026-06-01~2026-08-24` | 기존 스위치 `sellerops.collect.scheduler-enabled=false`로 **스케줄 실행만** 끈 채 기동. 새 bypass도 새 maintenance API도 만들지 않는다. 무장은 `product-qna` 하나 | `⌈13/100⌉+1 = 2` |
| **L2** | **첫 routine run** — 두 source 모두 | 두 플래그 ON + 스케줄러 ON으로 재기동 ⇒ reconciler가 `INQUIRY` 60분 schedule 1개 생성, 스케줄러가 집행. 이번엔 자동 생성을 막지 않는다 | lane당 `⌈N/size⌉`, 14일 창 |
| **L3** | **즉시 recurrence** — 같은 routine 커서 위에서 한 번 더 | 운영자의 "지금 가져오기"와 같은 경로(`POST …/sync {"dataType":"INQUIRY"}`, backfill seed 없음 ⇒ `primary` 커서). 60분을 기다리는 대신 **같은 코드·같은 커서**를 쓴다 | L2와 같은 자릿수여야 한다. history를 다시 걷는 모양이면 **FAIL** |

**L2의 창은 발명하지 않는다**: routine lane의 첫 창은 `NaverOrdersClient.ROUTINE_MAX_LAG`(14일) — 이 저장소가 이미 이 채널에서 "최근"이라고 부르는 값이다. 그 구간은 Run A/B가 이미 넣은 행들과 겹치므로, **겹치는 행이 0건 insert 되는 것**이 곧 recurrence 증명이다.

**되돌릴 수 없는 것**: 없다. 읽기뿐이고 재실행은 `external_id` 멱등이다. proof 후 `ORDER_SUMMARY`/`PRODUCT`는 위 기준값으로 복원한다.

### 11.3 승인

`docs/sellerops_live_approval_contract.md`. **READ_ONLY**이며 WRITE 승인을 요구하지 않는다.
채널/계정/범위·코드·브랜치가 바뀌면 승인은 `REVOKED`.

**여기서 멈춘다.** L1·L2·L3 중 어느 것도 실행하지 않았다.

---

## 12. L1 실행 결과 (2026-08-24 15:15) — **BLOCKED: 자격 증명이 하루를 넘기지 못한다**

승인 `Seated and ready.` (2026-08-24). L1을 실행했고 **토큰 발급에서 멈췄다.**

| 측정 | 값 |
|---|---|
| run | `592c3c02…` · `INQUIRY` · `MANUAL` · **`FAILED`** · 0.30s |
| 문의 endpoint 요청 | **0** — `contents/qnas`에 도달하지 못했다. 토큰 mint가 먼저 거절당했다 |
| 오류 | `CREDENTIAL_REJECTED` |
| 저장된 행 변화 | **0** — REAL 문의 18건 그대로 |
| WRITE | **0** |
| 계정 | `CONNECTED` → **`RECONNECT_REQUIRED`** |

### 12.1 금고가 아니다 — 두 번째로 같은 진단

`GET …/credential-diagnosis`(채널 호출 없음): `status: OK`,
`sealedKeyFingerprint == availableKeyFingerprint == IWLweMSEqoTt…`, `keyId == activeKeyId == self-pilot-1`.
**봉인한 키로 열린다.** 거절한 것은 네이버이고, 거절당한 것은 `client_id`/`client_secret` 자체다.

시계도 아니다. 실패 직후 hikari가 28초 **역행**을 기록했지만, 시계가 ±2초로 재동기된 뒤 다시
`test-connection`을 한 번 던져도 같은 `INVALID_CREDENTIAL`이 나왔다. 전자서명 timestamp 문제였다면
여기서 통과했어야 한다.

### 12.2 이것은 오늘 처음이 아니다 — 같은 모양이 이틀 연속

| 날짜 | 마지막 성공 | 첫 실패 |
|---|---|---|
| 2026-08-23 | 14:17 `ORDER_SUMMARY` | **15:18** `CREDENTIAL_REJECTED` |
| 2026-08-24 | 13:36 `ORDER_SUMMARY`·`PRODUCT` (운영자 재입력 후) | **15:15** `CREDENTIAL_REJECTED` |

**이것이 PART 2가 답해야 할 질문에 직접 닿는다.** 60분 routine은 자격 증명이 하루를 버틴다는
가정 위에 서 있다. 이틀 연속 같은 창에서 죽는 자격 증명 위에서는 "recurrence가 안전하다"를
증명할 수 없다 — 증명되는 것은 재인증 경로뿐이다. 원인은 네이버 쪽 정보 없이 이 저장소에서
판정할 수 없다: **external-research / 판매자 행동 필요**로 분류한다.

### 12.3 지금 상태 — 멈춘 자리

| | |
|---|---|
| `INQUIRY` schedule | **1개, 60분** — reconciler가 15:15:26에 만들었다 (`schedulesCreated=1`, 중복 0). 인증 실패로 **system pause**(`paused_reason` 있음) ⇒ 재연결하면 **자동 재개**된다 |
| `ORDER_SUMMARY` / `PRODUCT` | **운영자 pause 유지**(`paused_reason=null`) ⇒ 재연결해도 **되살아나지 않는다**. 첫 routine proof의 attribution은 여전히 깨끗하다 |
| collect scheduler | **꺼져 있다**(L1 격리용). 따라서 재연결만으로는 아무 run도 뜨지 않는다 — 다시 켜는 시점은 내가 고른다 |
| 플래그 | `product-qna=true`, `customer=false` |
| REAL 문의 | **18** (상품 13 · 고객 5), 손실 0 |

L2·L3은 실행하지 않았다.

---

## 13. 안전 종료 (2026-08-24 15:31) — 아무것도 저절로 깨어나지 않는 상태

원인은 확정하지 않는다. 확정할 수 있는 것은 **지금 무엇이 자동으로 돌 수 있는가**뿐이고, 답은 **아무것도**다.

### 13.1 실행한 정리

| 조치 | 방법 | 결과 |
|---|---|---|
| 두 source 플래그 | `.env.local` 주석 처리 + 재기동 | **둘 다 OFF** ⇒ 커넥터가 `INQUIRY`를 **광고하지 않는다** ⇒ reconciler가 다시 만들 수 없다 |
| `INQUIRY` schedule | `PUT …/schedule {enabled:false}` — 운영자 경로 그대로 | `enabled=false`, **`paused_reason=null`** |
| `ORDER_SUMMARY` / `PRODUCT` | 이미 운영자 pause | `enabled=false`, `paused_reason=null` |
| collect scheduler | 운영자 기준값 `true`로 복원 | NAVER는 세 schedule 모두 disabled라 호출 0. Cafe24/Coupang routine은 이 proof 이전의 자기 기준값으로 돌아간다 |

**`paused_reason=null`이 핵심이다.** `SellerAccountReauthService.onReconnected`는 **이유가 있는** schedule만 되살린다. L1 실패가 남긴 system pause(재연결 시 자동 재개)를 **운영자 disable로 바꿔** 놓았으므로, 판매자가 자격 증명을 다시 넣어 계정이 `CONNECTED`가 되어도 NAVER 문의 수집은 **저절로 시작되지 않는다**. 다시 켜는 것은 사람의 결정이다.

### 13.2 검증

| 확인 | 값 |
|---|---|
| 커넥터 capability `INQUIRY` | `supported=false` |
| NAVER schedule 3개 | 전부 `enabled=false`, `paused_reason=null`, `next_run_at=null` |
| REAL 문의 | **18** (상품 13 · 고객 5) — 삭제 0 |
| products / inquiry work items | **320 / 3,338** — 불변 |
| WRITE | **0** |

### 13.3 인증 환경 복구 후 복원할 값 (기준값 보존)

| schedule | 복원할 값 |
|---|---|
| NAVER `ORDER_SUMMARY` | **60분, enabled** |
| NAVER `PRODUCT` | **1440분, enabled** |
| NAVER `INQUIRY` | **사람의 결정** — PART 2 recurrence가 증명되기 전에는 자동으로 켜지지 않는다 |

### 13.4 다음 진단 (네이버 API 센터 접근이 가능할 때만)

비교할 네 가지: 실제 outbound IPv4 · 등록된 API 호출 IPv4 · `GNCP-GW-Trace-ID` · 네이버 원본 오류 코드(민감 payload 제외).
현재 outbound IP가 이전과 달라졌지만 **IP 원인으로 단정하지 않는다** — 네이버의 IP mismatch 대표 응답은 `GW.IP_NOT_ALLOWED`이고, 관측된 것은 그것이 아니다.
그때까지 **자격 증명 재입력 반복 금지 · 추측성 커넥터 수정 금지.**

## 14. NAVER INQUIRY 상태 — 한 줄로 쓰지 않는다

| 축 | 상태 | 근거 |
|---|---|---|
| **`NAVER_PRODUCT_QNA` source** | **`CONFIRMED`** | §8 — 13/13, `productId` 100% 일치 |
| **`NAVER_CUSTOMER_INQUIRY` source** | **`CONFIRMED`** | §9 — 5/5, `productNo` 100% 일치, 재독 멱등 |
| **TalkTalk** | **`UNSUPPORTED`** | 커머스 API에 endpoint 자체가 없음 |
| **INQUIRY routine recurrence** | **`BLOCKED_EXTERNAL`** | §12 — 토큰/자격/IP 환경 문제. **라이브 recurrence 미증명** |
| **미답변 경로** | **`DATA_UNPROVEN`** | 관측된 18건이 전부 답변 완료. 미답변 행을 만들거나 마켓플레이스에 write해서 만들지 않는다 |
| **관측 커버리지** | **2026-06-02 ~ 2026-08-19** (상품 문의) · **2026-06-09 ~ 2026-08-12** (고객 문의) | 실제로 읽은 범위. 그 밖은 주장하지 않는다 |

**두 문장을 절대 섞지 않는다.** "네이버 문의를 가져올 수 있다"는 증명됐다. "지금 네이버 문의가 최신이다"는 증명되지 않았다.

**금지된 표현**: "NAVER INQUIRY 미지원" · "현재 NAVER 문의 0건".
**가능한 표현** (evidence가 실제로 그럴 때만): "NAVER 문의 데이터는 수집된 이력이 있지만, 현재 자동 수집은 인증 환경 문제로 최신 상태를 확인하지 못했습니다."

### 14.1 여기서 드러난 화면 결함 (다음 package에서 다룬다)

플래그를 내리자 커넥터 capability가 `INQUIRY supported=false`가 됐다. 배포 배선 사실로는 참이지만, 화면은 그것을 **"네이버 문의 미지원"**으로 읽는다 — 방금 라이브로 반증된 문장이다. **"채널이 제공하지 않는다"와 "이 배포가 지금 연결하지 않았다"가 한 단어를 공유하고 있다.** 커넥터를 지금 고치지 않고, coverage 어휘를 만드는 Cross-Channel Operational Reasoning v1에서 다룬다.
