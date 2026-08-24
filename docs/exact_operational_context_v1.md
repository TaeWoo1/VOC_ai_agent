# Exact Operational Context v1 — 문의가 지목한 주문 하나를, 그때 읽는다

> **상태:** 구현 완료 · **마켓플레이스 요청 0 · WRITE 0** · live exact lookup **미실행**
> (`LIVE_ORDER_LOOKUP_NOT_RUN`, §10).
> **날짜:** 2026-08-25 · **브랜치:** `feat/agent-evidence-scope-integrity`
> **선행:** `docs/operational_fact_binding_v1.md`(CLOSED) · `docs/seller_operations_knowledge_and_answer_memory_v1.md`
> **capability 정본은 여전히 `docs/multi-channel-connector-roadmap.md` §4.1.** 이 문서는 그 표의 한 행을
> 새로 만들 뿐 기존 칸을 옮기지 않는다.

---

## 0. 먼저, 어제의 선언을 정정한다

`ExactOrderLookupCapability`는 2026-08-25 오전에 **어느 채널에도 exact single-order lookup 계약이
없다**고 선언하고, 그것을 *external research required*로 분류했다.

그 선언은 `docs/vendor/`에 대해서는 정확했고 **세상에 대해서는 틀렸다.** Cafe24는
`GET /api/v2/admin/orders/{order_id}`를 `mall.read_order` 아래 공개하고 있으며, v2 Admin API가 있는
내내 그랬다.

정정의 방향이 중요하다. **capability가 움직인 이유는 누가 URL을 기억해냈기 때문이 아니라 문서가
생겼기 때문이다.** 공식 reference를 사본으로 고정했고
(`docs/vendor/cafe24-admin-api/get-orders-order-id.md`, 2026-08-25 취득), 선언은 그 파일을 **이름으로
가리킨다**. 회귀 테스트가 그 파일이 디스크에 실제로 있는지 확인한다 — endpoint 문자열은 근거보다
오래 살아남기 때문이다.

| Property | Value |
|---|---|
| Method / path | `GET /api/v2/admin/orders/{order_id}` |
| SCOPE | `mall.read_order` — **이미 부여된 grant** (Cafe24 연결의 `mall.read_community,mall.read_order,mall.read_product`) |
| Request Limit | 40 |
| embed | `items` `receivers` `buyer` `benefits` `coupons` `return` `cancellation` `exchange` `refunds` — **전부 opt-in, 하나도 요청하지 않는다** |

LIST(`GET /api/v2/admin/orders`)도 `order_id` 필터를 공식 지원하지만, 이 제품 흐름의 primary path는
**단건 조회**다. LIST는 같은 계약에서 `buyer_name`·`receiver_name`·`receiver_address`·
`buyer_cellphone`·`buyer_phone`·`buyer_email`·`member_id`도 검색 조건으로 받는다 — 고객을 이름과
전화번호로 찾는, 문서화되고 완전히 동작하는 방법이다. **계약이 제공한다는 것은 쓸 이유가 아니고**,
쓰지 않는 유일한 지속 가능한 방법은 그 이름이 소스에 나타나면 빌드를 깨는 것이다
(`ExactOrderPrivacyFenceTest`).

여전히 없는 것: **NAVER**(vendored 계약 전부 시간 범위) · **Coupang**(주문 상세 계약 미보유).

---

## 1. Standing routine 관측 — 새 호출 없이

새 marketplace call을 만들기 전에, 기존 `INQUIRY` routine이 새 mapper로 실행되었는지 먼저 확인했다.

백엔드 재시작 **01:27:23 KST**, 그 이후 routine 실행:

| data_type | channel | started_at | total_rows | success_rows |
|---|---|---|---|---|
| INQUIRY | CAFE24 | 2026-08-25 01:50:33 | 0 | 0 |
| INQUIRY | NAVER | 2026-08-25 01:56:36 | 0 | 0 |

**routine은 실행됐고, 아무것도 관측하지 못했다.** 커서가 창의 끝에 있어 어떤 글도 다시 읽히지
않았고, 따라서 어떤 참조도 저장되지 않았다.

DB 현황 (PII 0, 정수만):

| channel | subtype | inquiries | `source_order_ref` non-null | 최근 7일 |
|---|---|---|---|---|
| CAFE24 | (없음) | 3,312 | **0** | 0 |
| COUPANG | (없음) | 13 | **0** | 0 |
| NAVER | `NAVER_CUSTOMER_INQUIRY` | 5 | **0** | 0 |
| NAVER | `NAVER_PRODUCT_QNA` | 13 | **0** | 1 |
| NAVER | (legacy) | 8 | **0** | 0 |

따라서 「board 6 글이 `order_id`에 값을 싣는가」는 **`DATA_UNPROVEN`**이다. 임의의 marketplace
inquiry READ를 실행하지 않았다.

**그리고 이것은 그 자체로 발견이다.** routine은 앞으로만 읽는다 — 새 글만 가져온다. 그러므로
**기존 3,312건에는 참조가 영원히 생기지 않는다.** 참조는 앞으로 들어올 문의에만 붙는다. 이는
`docs/operational_fact_binding_v1.md` §2가 관측한 「backlog는 2014~2025이고 최근 1년 0건」과 같은
결론을 다른 방향에서 확인해 준다: **이 package의 가치는 backlog가 아니라 다음 문의에 있다.**

---

## 2. Cafe24 ExactOrderReader

`ExactOrderReader`의 시그니처가 fence다.

```java
ExactOrderObservation read(UUID orgId, UUID sellerAccountId, String reference);
```

날짜 범위도, 페이지도, 커서도, 이름도, 전화번호도, limit도 없다. **history를 걷고 싶은 구현은 이
인터페이스를 바꿔야 하고, 그것은 오후 작업이 아니라 리뷰다.**

- 기존 auth/connector 인프라 재사용 — `Cafe24Authorizer`(같은 vault, 같은 회전 write-back),
  `Cafe24HttpClient`(연결의 단일 네트워크 경계), `Cafe24RateLimitedException`.
- URI에 **query string이 아예 없다**: `https://{mall}.cafe24api.com/api/v2/admin/orders/{order_id}`.
  query가 없다는 것은 테스트로 강제된다 — **query string이야말로 lookup이 자라는 자리**다.
- `order_id`는 URL path segment가 되기 전에 `[A-Za-z0-9_-]{1,32}`로 **fail-closed** 검증된다. 계약이
  형식을 규정하지 않으므로(길이만 Max 32), 규정되지 않은 문자열로 만든 path segment는 lookup을 다른
  요청으로 바꾸는 방법이다. 거부된 대상은 요청이 되지 않는다.
- 응답의 `order_id`가 요청한 것과 다르면 **우리 주문에 대한 사실이 아니다** → `TRANSPORT_ERROR`.
- 커넥터 플래그(`sellerops.connector.cafe24.enabled`) 뒤의 `@Bean`이다. 플래그가 꺼져 있으면 reader가
  없고, 주문을 지목한 문의는 「찾지 못했습니다」로 끝난다 — 커넥터가 없으면 물어볼 곳이 없으니 참이다.

### 세 상태는 세 개의 표로 읽는다

| Cafe24 field | 값 | 우리 vocabulary |
|---|---|---|
| `paid` | `T` / `F` / `M` | `PAID` / `UNPAID` / `PARTIALLY_PAID` |
| `canceled` | `T` / `F` / `M` | `CANCELLED` / `NOT_CANCELLED` / `PARTIALLY_CANCELLED` |
| `shipping_status` | `F` / `M` / `T` / `W` / `X` | `AWAITING_SHIPMENT` / `IN_TRANSIT` / `DELIVERED` / `ON_HOLD` / `AWAITING_CONFIRMATION` |

**같은 글자가 세 가지를 뜻한다.** `T`는 앞의 둘에서 "결제됨"/"취소됨"이고 세 번째에서 **"배송
완료"**다. `F`는 앞의 둘에서 "미결제"/"취소 안 됨"이고 세 번째에서 **"발송 대기"**다. 공용 매퍼
하나로 읽으면 **취소되지 않았다는 이유로 고객에게 배송 완료를 통보하는** 그럴듯한 경로가 생긴다.
그래서 필드마다 자기 switch를 갖고 default를 공유하지 않는다. 인식하지 못한 토큰은 전부 `UNKNOWN`.

---

## 3. Privacy-safe OrderFact projection

**투영하는 것** (계약이 증명하는 값만): `paid` · `canceled` · `shipping_status` · `order_date` ·
`payment_date` · `cancel_date` · 그리고 identity echo용 `order_id`(커넥터 층을 벗어나지 않는다).

**버리는 것**: `member_id` · `member_email` · `billing_name` · `bank_account_owner_name` ·
`transaction_ids` · `payment_amount` · `initial_order_amount` · `actual_order_amount` ·
`wished_delivery_*` · `additional_order_info_list` · 그리고 base 응답의 나머지 ~60개 필드 전부.

**버리는 지점이 parse boundary다.** `Cafe24OrderDetailRow`는
`@JsonIgnoreProperties(ignoreUnknown = true)`이고 7개 필드만 선언한다 — 나머지는 **Java 객체가 되지
않는다**. 실수로 로그에 남을 것도, 프롬프트에 들어갈 것도, 미래의 `toString()`이 찾아낼 것도 없다.
**parse 경계에서의 폐기만이 다른 곳의 나중 수정으로 되돌릴 수 없는 폐기다.**

사람을 담는 두 sub-resource(`buyer` 주문자, `receivers` 수령인)는 이 endpoint에서 **opt-in embed**이고
요청하지 않는다. 즉 record에 없는 정도가 아니라 **wire에 없다**.

`OrderFact` 자체에 customer PII field는 **만들지 않았다.** 주문번호·금액·구매자 필드도 자리가 없다.

### 3a. v1 규칙 하나가 바뀌었다 — `cancelled`의 `FALSE`

`docs/operational_fact_binding_v1.md`는 **`cancelled`에 `FALSE`가 없다**고 선언했다. 그 선언은
**저장 경로에 대해서는 지금도 옳다**: `channel_orders`의 어떤 상태 코드도 부정을 증명하지 않고,
마지막 read 이후 취소된 주문은 한 번도 취소되지 않은 주문과 **똑같이 생겼다**.

exact live READ는 다른 행위다. Cafe24는 `canceled`를 `F` = **"Not Canceled"**로 공표한다 — 우리가
물어본 그 순간, 그 주문에 대해, 몰이 한 **적극적 진술**이다. 「취소됐나요?」라고 묻는 고객에게
필요한 것이 정확히 그 문장이고, 표현할 수 없게 두면 플랫폼 자신의 답을 쓸 수 없게 된다.

**그래서 fence는 vocabulary에서 SOURCE로 옮겼다.** `OrderFactProvenance`가 record 위에 있고,
`OrderFact`의 compact constructor가 **`STORED_CANONICAL`에서 온 `NOT_CANCELLED`와 `UNPAID`를
`UNKNOWN`으로 지운다.** 격하가 각 caller가 아니라 **타입 안에** 있다: 미래에 누군가
`channel_orders`의 새 코드를 `NOT_CANCELLED`로 매핑해도, 저장 경로가 지탱할 수 없는 주장은 record를
빠져나가지 못한다.

---

## 4. Exact binding path

```
Inquiry.source_order_ref  (채널이 쓴 값, SOURCE_EXACT)
   → 저장된 canonical order (fresh일 때만)
   → 없거나 stale이면: Cafe24 ExactOrderReader — 주문 하나, 요청 하나
   → OrderFact
```

| 상황 | 결과 |
|---|---|
| `source_order_ref` 없음 / binding ≠ `SOURCE_EXACT` | `NO_ORDER_REFERENCE` |
| exact GET 404 | `ORDER_NOT_FOUND` |
| 저장 miss + capability 없음 | `ORDER_NOT_FOUND` |
| auth 실패 / grant 밖 | `SOURCE_UNAVAILABLE` (+ `BLOCKED`) |
| 429 · 5xx · 파싱 실패 · 형식 거부 | `SOURCE_UNAVAILABLE` |

**추가하지 않은 것**: manual order selection · LLM guess · text parsing · first candidate. 상품에는
사람이 고르는 `USER_CONFIRMED` lane이 있지만 **주문에는 없다** — 「3월에 주문했는데 아직 안 왔어요」를
보고 사람도 모델도 *어느* 주문인지 알 수 없고, 틀리면 남의 택배 상태를 들은 고객이 남는다.

`ORDER_NOT_FOUND`의 문구를 **「아직 가져오지 않았습니다」에서 「찾지 못했습니다」로** 바꿨다. 이제 이
상태는 두 가지를 덮는다 — 우리가 안 가져온 것, 그리고 몰이 그런 주문이 없다고 답한 것. 중립적인
쪽이 둘 다에 대해 정직하다.

---

## 5. Read timing — 참조가 있다는 것은 호출할 이유가 아니다

모든 문의를 수집할 때 주문 GET을 하나씩 붙이면 **문의 수집이 N+1 order collector가 된다.** 그래서
네트워크는 reader의 성질이 아니라 **caller가 말하는 결정**이다.

```java
enum OrderFactLookup { STORED_ONLY, EXACT_ALLOWED }
```

| caller | mode | 이유 |
|---|---|---|
| 문의 상세 (`InquiryProposalService`) | `EXACT_ALLOWED` | 사람이 지금 이 화면을 보고 있다 |
| 초안 근거 수집 (`InquiryEvidenceRetriever.retrieve(org, inquiry)`) | `EXACT_ALLOWED` | 문장 하나가 이 사실 위에 놓인다 |
| coverage 감사 (`retrieve(org, inquiry, query)`) | `STORED_ONLY` | 수천 행을 한 번에 분류하고, 그중 누구도 답을 기다리지 않는다 |
| ingestion · 배치 · 백그라운드 전부 | `STORED_ONLY` | 기본값 |

**Cache — `OrderFactCache`, TTL 5분, 메모리에만.**

표에 쓰지 않았다. 표에 쓴 주문 상태는 저장된 사실이 되고, 저장된 사실은 나중에 읽힌다 — 이 영역
전체가 막으려는 바로 그 실패(쓸 때 참이었고 참이 아니게 된 뒤에 인용되는 행)다. 재시작을 넘기지
않고, 조회되지 않고, join할 수 없다. **clock을 가진 request-coalescing 장치이지 store가 아니다.**

5분은 실제 중복에서 골랐다: 셀러가 문의를 열고(상세가 운영 카드를 그린다) 몇 초 뒤 초안 생성을
누른다(drafter가 같은 주문에 근거를 둔다). 같은 주문, 같은 자리. 5분은 그 자리를 덮고, 점심 뒤에
돌아온 셀러에게는 만료된다 — 그때 「현재 확인된 상태입니다」는 거짓이 되고, 몰에 다시 묻는다.

**실패는 캐시하지 않는다.** rate limit 한 번이 5분짜리 「확인할 수 없습니다」가 되면, 그 사이에
복구된 연결을 가진 셀러가 손해를 본다.

**fresh canonical fact는 호출을 억제한다.** stale canonical fact는 억제하지 **않는다** — 다시 묻고,
못 물으면 그때 stale row를 자기 날짜와 함께 인용한다(「8월 21일 기준」이 「확인할 수 없습니다」보다
많이 답한다).

---

## 6. Deterministic vs Agentic

| 질문 | 경로 | 모델 호출 |
|---|---|---|
| 문의 상세의 주문 상태 표시 | `orderContext` — 결정론적 exact read | **0** (planner 0) |
| "이 주문 취소됐나요?" | OrderFact | **0** |
| "취소 요청 고객에게 뭐라고 답할까?" | OrderFact + ORG policy + Answer Memory → Agent | 초안 1 |

기존 제품 원칙 불변: Agent reasoning graph는 여전히 **WRITE 0**.

---

## 7. Grounded semantics

| | 근거 | 쓸 수 있는 것 | 쓰면 안 되는 것 |
|---|---|---|---|
| **A** | OrderFact `CANCELLED` (fresh) | "취소되었습니다" | — |
| **B** | 정책만 "취소 가능" | 취소 정책 일반 안내 | **이 주문이 취소되었다** |
| **C** | OrderFact `AWAITING_SHIPMENT` + 정책 "1~2영업일" | 현재 준비 상태 + 일반 정책 | **특정 출고일 약속** |
| **D** | freshness unproven | 확인 시점을 밝힌 인용 | **현재 사실 단정** |

prompt는 **v5**로 올렸다. v4의 규칙에 더해:

- 「주문 상태」의 결제·취소·발송은 **서로 다른 세 가지 사실**이다. 하나가 확인되었다고 나머지를
  추론하지 마세요. **「발송 상태는 확인되지 않았습니다」는 발송되지 않았다는 뜻이 아니라 모른다는
  뜻입니다.**
- **「취소되지 않은 것으로 확인됩니다」라고 적혀 있을 때만** 취소되지 않았다고 쓸 수 있습니다.
- 「발송은 아직 시작되지 않았습니다」는 **상태이지 일정이 아닙니다.**

그리고 `OrderFact.messageKo()`는 **발송 절을 항상 포함한다** — 결제를 말하고 멈춘 문장은 「그래서 아직
안 갔구나」로 읽힌다. 그것이 고객이 시키지 않아도 하는 유일한 추론이라, 침묵을 소리 내어 말한다.

셋 다 증명되지 않았을 때(Coupang `DELIVERING`처럼 저장은 됐고 의미는 라이브 확인된 적 없는 코드)는
「상태 코드를 확인했지만, 그 의미를 확정하지 못했습니다」다.

---

## 8. 호출 비용 · privacy · audit

`ExactOrderReadAudit` — 한 줄, 사람도 주문도 없는 줄.

**남기는 것**: org · inquiry id(우리 UUID, action context) · channel · outcome 범주 · 시각.
**남기지 않는 것**: order identifier · mall id · access token · request URI · 응답 본문/필드 ·
구매자 속성 어느 것도.

식별자는 `inquiries.source_order_ref`에 저장되어 있음에도 **의도적으로 로그에서 빠진다** —
**DB 컬럼에는 소유자·보존기간·독자가 있고 로그 줄에는 셋 다 없다.**

outcome 어휘는 닫혀 있다: `OK` · `NOT_FOUND` · `NOT_CAPABLE` · `UNAUTHORIZED` · `RATE_LIMITED` ·
`TRANSPORT_ERROR`. **`NOT_FOUND`는 좁다** — 몰이 답했고 그런 주문이 없다는 뜻이다. 도달 실패는 전부
`TRANSPORT_ERROR`이며, 「도달 못 했다」와 「존재하지 않는다」는 고객을 반대 방향으로 데려간다.

억제된 호출도 기록된다(`recordSuppressed`, debug) — 「왜 어제 Cafe24를 400번 불렀나」와 「왜 안
불렀나」는 같은 질문의 양면이다.

---

## 9. Offline regression (마켓 접촉 0)

| 증명 | 어디 |
|---|---|
| exact ref → **정확히 한 번의 lookup** | `ExactOrderCallTimingTest.oneReferenceIsOneRequest` |
| no ref → **call 0** | `noReferenceMeansNoCall` |
| `STORED_ONLY` → **call 0** (참조·capability 있어도) | `storedOnlyNeverCalls` |
| 같은 자리에서 반복 → **call 1** | `aRepeatWithinTheWindowIsSuppressed` |
| TTL 이후 → **다시 묻는다** | `aRepeatAfterTheWindowAsksAgain` |
| 실패는 캐시되지 않는다 | `aFailureIsNotCached` |
| fresh 저장 fact → call 0 | `aFreshStoredFactSuppressesTheCall` |
| stale fact는 **current claim이 되지 않는다** | `aStaleStoredFactIsRefreshedAndNeverStatedAsNow` |
| 다른 account의 주문은 우리 것이 아니다 | `anotherAccountsOrderIsNotOurs` |
| 계약 없는 채널은 call 0 | `anUncontractedChannelMakesNoCall` |
| 요청에 query·embed·buyer·receivers 없음 | `Cafe24ExactOrderReaderTest.theRequestIsOneOrderAndNothingElse` |
| 세 필드는 세 표로 — 같은 글자, 다른 뜻 | `theSameLetterIsNotTheSameMeaning` |
| 404/403/429/5xx 범주 분리 | `failuresAreCategorized` |
| 다른 주문에 대한 응답은 거부 | `anEchoMismatchIsRefused` |
| 형식 벗어난 order id는 HTTP 이전에 거부 | `anUnexpectedOrderIdShapeFailsClosed` |
| **PII projection 0** (파싱 후 문자열에 이름·이메일·금액·거래ID 없음) | `theProjectionHasNoRoomForAPerson` |
| 고객 검색 파라미터 소스에 **부재** | `ExactOrderPrivacyFenceTest.nothingSearchesForACustomer` |
| audit 줄에 식별자·토큰·본문 없음 | `noIdentifierTravelsDownstream` |
| exact 경로는 **READ 전용** | `theExactPathWritesNothing` |
| OrderFact는 Answer Memory에 들어가지 않는다 | `anOrderFactIsNotAnAnswer` |
| ambiguous/fuzzy 경로 0 · 본문 추출 0 | `OrderBindingFenceTest` (기존, 유지) |
| 선언된 capability는 **디스크의 vendored 문서를 가리킨다** | `aDeclaredLookupIsBackedByADocument` |
| Agent WRITE 0 | `operatorToolRegistry.test.ts` (agent-runtime, 무변경) |

회귀: backend **3,030 / 0 failures / 22 skipped** · frontend **167 files / 2,288 tests** · `tsc` clean ·
agent-runtime **488 passed / 23 skipped, 무변경**.

---

## 10. Live proof — `LIVE_ORDER_LOOKUP_NOT_RUN`

REAL Demo Org의 `source_order_ref` non-null = **0** (§1). 그러므로:

**`LIVE_ORDER_LOOKUP_NOT_RUN` — manifest를 준비하지 않았고, 마켓플레이스 요청 0.**

과거 주문번호를 임의로 가져와 문의와 무관한 주문을 조회하는 proof는 만들지 않았다. 그런 실행은
**이 기능이 하는 일을 증명하지 못한다** — 증명해야 하는 것은 "우리가 Cafe24 주문을 읽을 수 있다"가
아니라 "**문의가 지목한** 주문을 읽는다"이고, 지목한 문의가 없으면 그 문장은 아직 시험할 수 없다.

REAL 문의에서 `source_order_ref`가 **자연스럽게 발견되면** 그때 manifest를 준비하고 승인 앞에서
멈춘다. 그 manifest가 담을 것: inquiry identity(PII 제외) · Cafe24 account ·
`GET /api/v2/admin/orders/{order_id}` · expected marketplace request **= 1** · `mall.read_order` ·
저장/투영 필드(§3) · 명시적으로 버리는 PII(§3) · **WRITE 0**.

---

## 11. Order Observation Window는 만들지 않았다

retention 확대 0 · historical backfill 0 · 날짜 range sweeping 0 · 옛 Cafe24 backlog 복구 0.

이전 package가 다음 후보로 제안했던 **Order Observation Window v1은 진행하지 않았다**(product-owner
결정). 실제 workflow에서 exact lookup이 부족하다는 **라이브 증거가 생길 때만** 별도로 결정한다.

---

## 12. Cafe24 reply 관련 발견 — 기록만

공식 board article resource에 `reply`(`T`/`F`) · `reply_user_id` · `reply_status`(`N` 답변 전 / `P`
처리 중 / `C` 답변 완료) · `order_id`가 존재한다. 사본:
`docs/vendor/cafe24-admin-api/get-boards-articles.md`.

**그리고 기존 blocker보다 날카로운 사실 하나:**

| 필드 | `POST` (글 생성) | `PUT` (글 수정) |
|---|:--:|:--:|
| `reply` · `reply_user_id` · `reply_status` · `order_id` | 받는다 | **받지 않는다** |

즉 **`reply_status`는 글을 만들 때만 설정할 수 있다.** 이미 있는 문의사항 글을 수정해서 답변 완료로
표시하는 계약상의 방법은 **없다.** 따라서 유일한 후보 write path는 여전히 댓글 POST이고, reference는
여전히 **댓글이 `reply_status`를 바꾼다고 말하지 않는다**. `writer`/`password` 필수 문제도 그대로다.

**이번 package에서 comment WRITE adapter로 확장하지 않았다.** 이 세 blocker는 다음 Action package
소관이다. `docs/inquiry_action_flow_v1.md` §2의 Cafe24 행에 이 발견을 기록했다.

---

## 13. 남은 blocker

1. **Cafe24 board 6의 `order_id` 값 미관측** (`DATA_UNPROVEN`) — routine이 앞으로만 읽으므로 기존
   3,312건에는 영원히 붙지 않는다. 다음 새 문의가 답한다.
2. **exact lookup 계약: NAVER · Coupang 미보유** — external research required. NAVER의 vendored
   주문 계약은 전부 시간 범위다.
3. **NAVER 주문 저장 창(08-21~24)과 고객 문의 창(06-09~08-12)이 겹치지 않는다** — 참조를 잡아도
   오늘은 `ORDER_NOT_FOUND`. NAVER에는 exact reader도 없다.
4. **정책 문서 52건** (판매자 입력, 이월) — 주문 축과 독립이며 이 package로 줄지 않았다.
5. **Cafe24 답변 write**: 댓글 semantics · `writer`/`password` · write grant (§12, 이월).
