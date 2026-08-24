# Operational Fact Binding v1 — 주문을 문의에 붙인다

**날짜:** 2026-08-25 · **브랜치:** `feat/agent-evidence-scope-integrity` ·
**선행:** `docs/seller_operations_knowledge_and_answer_memory_v1.md` (CLOSED)

문의 답변의 마지막 빈칸을 채운다. 상품 지식·운영 정책·과거 답변은 전부 **누군가 써 둔 것**이고,
주문 상태는 **아무도 쓰지 않았는데 변하는 것**이다. 이 문서는 그 하나가 어떻게 문의에 붙고, 붙지
않을 때 무엇이라고 말하는지를 소유한다.

**이 package가 하지 않은 것:** 새 connector · Cafe24 주문 historical importer · proactive agent ·
고객 identity linking · marketplace WRITE. Agent graph WRITE tool은 여전히 **0**이다.

---

## 1. PART A — ORDER_CONTEXT_NEEDED 감사 (PII 없음)

### 1.1 먼저, 31은 29였다

이전 보고의 **31**은 측정 도구의 산물이었다. `InquiryKnowledgeNeed`는 축이 둘 이상이면
`MULTI_SOURCE` **하나의 라벨**로 접었고, coverage는 그 라벨을 "세 축 모두 필요"로 읽었다. 실제로는
25건의 MULTI 중 **2건은 상품+정책**이며 주문과 무관하다.

| | before(2026-08-25 오전) | after(실측) |
|---|---:|---:|
| 주문 축이 실제로 필요한 문의 | 31 | **29** |
| 상품 축이 실제로 필요한 문의 | 27 | **4** |
| 정책 축 | 52 | 52 |

`InquiryKnowledgeNeed.axesOf()`가 축 집합을 그대로 돌려주고, coverage는 라벨이 아니라 축을 센다.
접힌 라벨은 막대 그래프에는 충분하고 **분모로는 쓸 수 없다**.

### 1.2 29건은 무엇인가

| 확인 항목 | 결과 |
|---|---|
| channel / source subtype | **29/29 Cafe24 board 6** (`cafe24:b6:a…`). NAVER·Coupang 0건 |
| source가 order reference를 제공하는가 | **응답 키로는 존재**하나 **값은 미관측** — §1.3 |
| 어떤 identifier인가 | Cafe24 결제 단위 `order_id` (상품주문 단위 없음) |
| 현재 projection이 버리고 있었는가 | **그렇다** — `Cafe24BoardArticleRow`가 9필드만 읽었다 |
| existing order store와 exact join 가능한가 | **불가** — `channel_orders`에 Cafe24 행 **0** |
| 현재 주문 데이터가 존재하는가 | **집계만** — `order_daily_summaries` 7일 · 총 11건, 식별자 없음 |
| live exact lookup capability | **없음** — §2 |

**그리고 이 backlog는 살아 있는 큐가 아니다.** 29건의 접수 시점:

| 연도 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2021 | 2023 | 2025 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 주문 문의 | 2 | 5 | 8 | 4 | 5 | 1 | 1 | 1 | 2 |

**최근 1년 0건, 3년 초과 26건.** 이것은 이 package의 가치가 이 backlog에 있지 않다는 뜻이다 —
2016년에 "언제 발송되나요"라고 물은 주문은 어느 API의 조회 범위에도 없고, 있다 해도 답이 의미를
갖지 않는다. 가치는 **앞으로 들어올 주문 문의**에 있고, backlog에 대한 증명은 **구조적 증명**까지다.

### 1.3 Cafe24 `order_id`는 "저장하면 해결"이 아니다

라이브에서 관측된 것은 **응답에 그 키가 있다**는 사실뿐이다
(`docs/sellerops_cafe24_review_inquiry_capture.md` §PII-bearing keys — `writer, writer_email,
member_id, client_ip, order_id`). **board 6 글에 값이 채워져 있는지는 관측되지 않았다.** 게시판 6은
문의사항 일반 게시판이고, 주문 없이 쓰는 글을 받는다 — 상당수가 비어 있다는 쪽이 정직한 기대다.

그래서 projection은 열되(§3), **비어 있으면 `absent()`가 정답**이고 실패가 아니다. 값이 실제로
채워지는지는 §8의 manifest 한 건이 답한다 — **실행하지 않았다.**

---

## 2. PART B — Operational Fact Source

우선순위 셋, 그리고 **가운데 하나는 지금 비어 있다.**

| # | source | 상태 |
|---|---|---|
| 1 | 저장된 canonical order fact — `channel_orders` 정확 일치 | **구현** |
| 2 | exact referenced order의 기존 READ capability | **없음 — 계약 미보유** |
| 3 | 위 둘 다 없으면 이유를 말한다 (`OrderFactState`) | **구현** |

**(2)를 없다고 선언한 근거** (`ExactOrderLookupCapability`, offline audit, vendored 계약만):

- **NAVER** — `get-v1-pay-order-seller-product-orders.md`는 **시간 범위** 조회이고 문서 첫 줄이
  스스로 그렇게 말한다("식별자를 모른 채 특정 기간의 … 작업 큐를 만들고 싶을 때").
  `last-changed-statuses`도 시간 범위다. **식별자로 한 건을 가져오는 vendored 계약은 없다.**
- **Cafe24** — 구현된 주문 계약은 Admin orders **LIST** 하나이며 `start_date`/`end_date` 범위다.
  `docs/vendor/cafe24-admin-api/`에는 게시판 댓글 POST 한 건만 있다.
- **Coupang** — 주문 상세 계약이 vendor되어 있지 않다.

플랫폼에 exact endpoint가 **실재할 수는 있다.** 그래서 "없다"가 아니라 **external research
required**로 기록한다 — 기억으로 만든 URL은 판매자의 실제 주문 위에서, 라이브에서 실패한다.
그리고 이 선언은 코드 상수가 아니라 **테스트되는 사실**이다(`OrderBindingFenceTest`).

**"주문을 포함할 만큼 넓은 날짜 스윕"은 exact lookup이 아니다.** 그것은 history walk이고,
`ExactOrderLookupCapability`가 존재하는 이유는 (2)가 조용히 crawler의 (1)단계가 되는 것을 막는 데 있다.

`mall.read_order`는 이미 Demo Org Cafe24 연결에 부여되어 있다(`granted_scopes`). **스코프는
병목이 아니다 — 계약이 병목이다.**

---

## 3. PART C — Privacy-safe Order Reference

### 3.1 무엇이 필요한가

고객의 identity가 아니라 **"이 문의가 어느 주문을 가리키는가"**. 두 개는 같은 응답에 나란히 있고,
NAVER 고객 문의는 둘 다 **필수 필드**로 돌려준다. 경계는 **하나에 대해서만** 움직였다.

| 값 | 저장 | 근거 |
|---|---|---|
| `customerId` · `customerName` | **안 함** (projection 없음) | 사람의 손잡이 |
| `writer` · `writer_email` · `member_id` · `client_ip` | **안 함** | 사람의 손잡이 |
| `orderId` · `productOrderIdList` (NAVER) · `order_id` (Cafe24) | **저장** | 거래의 손잡이 |

### 3.2 왜 평문인가 (새 평문 persistence의 정당화)

| 항목 | 답 |
|---|---|
| **왜 필요한가** | 정확 join의 양쪽이 필요하다. 그리고 digest는 보호하는 것이 없다 — **같은 식별자 공간이 이미 평문으로 옆 표에 있다**: `channel_orders.external_order_id`(NAVER productOrderId), `parent_order_id`(NAVER orderId). 문의 쪽만 HMAC으로 덮으면 원본은 그대로 있고 (2)로 가는 길만 영구히 닫힌다 |
| **어느 table** | `inquiries.source_order_ref` (varchar 120) + `inquiries.order_binding` (varchar 16). V73 |
| **누가 읽는가** | `InquiryOrderFactReader` **하나**. 다른 경로 없음 |
| **retention** | 문의 행의 수명과 동일. 별도 수명을 갖는 기록이 아니다 |
| **provenance** | 채널이 그 문의 행에 명시한 값, verbatim. 본문 추출 없음 |
| **최소 범위** | 초안 프롬프트 ✗(payload floor 테스트) · Answer Memory ✗(구조 fence) · 로그 ✗ · coverage 보고서 ✗ · 화면 ✗ |

### 3.3 Answer Memory와의 분리 (PART K)

Answer Memory는 **판매자가 어떻게 답했는지**를, OrderFact는 **그 주문이 그때 무슨 상태였는지**를
기록한다. 합치지 않는 방법은 규약이 아니라 **자리를 주지 않는 것**이다 —
`AnswerMemoryWriteFenceTest`가 memory entity·service·hook·importer 어디에도 `sourceOrderRef` /
`OrderFact` / `ChannelOrder`가 나타나지 않음을 소스에서 강제한다.

프롬프트도 같은 말을 한다: *"[과거 답변]에 있는 '오늘 출고', '내일 도착' 같은 문장은 그때 그 주문의
사정이지 이 주문의 사정도, 회사의 기준도 아닙니다."* 일반화 가능한 운영 기준이 필요하면 판매자가
별도 ORG policy로 승인해야 한다.

---

## 4. PART D — OrderFact projection

`OrderFact`는 **payload가 아니라 projection**이다. 마켓플레이스 주문 객체는 이름·전화·주소·수령인·
메모·결제수단을 싣고 오고, 그중 어느 것도 "취소됐나요?"에 답하지 않으며, 전부 프롬프트와 로그와
초안에 남는다. **자리가 없는 것은 새지 않는다.**

| 필드 | 있음 |
|---|---|
| `state` · `channelState` · `channelCode` | 말해도 되는가, 왜 안 되는가, 누구의 주문인가 |
| `normalized` · `rawStatusCode` | 정규화 상태 + 채널 원본 코드 |
| `cancelled` | `TRUE` 또는 **null(미증명)** — `FALSE`는 나오지 않는다 |
| `paidAt` · `statusChangedAt` · `orderedAt` · `asOf` | 시각, 그리고 **언제 본 것인지** |

**없는 것:** 주문 식별자 · 금액 · 구매자 이름/전화/주소/수령인 · raw payload.
식별자는 join이 필요한 문의 행에 남고, 이 record를 소비하는 셋(초안·화면·감사)은 전부 **상태**를
묻지 **손잡이**를 묻지 않는다.

**상태 셋을 나눈 이유.** 결제·취소·발송은 서로 다른 사실이고 고객은 하나씩 묻는다. 하나의
"status"로 접으면 "결제완료"가 "발송 안 됨"으로 읽히는데, 그것은 함의되지 않고 때로 거짓이다.

**`UNKNOWN`도 문장이다.** 지금 `channel_orders`에는 Coupang의 `DELIVERING` 42/9건과
`FINAL_DELIVERY`가 들어 있고, 이 저장소는 그 토큰의 의미를 **라이브 확인한 적이 없다**
(`NormalizedOrderStatus`는 `PAYED` 하나만 관측했다). 정직한 렌더링은
*"상태 코드를 확인했지만, 그 의미를 확정하지 못했습니다"*이지 한국어 라벨을 붙인 추측이 아니다.

---

## 5. PART E — Inquiry ↔ Order Binding

`InquiryOrderBinding`의 값은 **`SOURCE_EXACT` 하나**이고, **두 번째 값이 없다는 것이 fence다.**

상품 결합에는 `USER_CONFIRMED`가 있다 — 사람이 사진을 보고 어느 리스팅인지 말할 수 있기 때문이다.
주문에는 그 lane이 없다. 사람도, 모델도, 휴리스틱도 *"3월에 주문했는데 아직 안 왔어요"*를 보고
**어느** 주문인지 알 수 없고, 여기서 틀리면 잘못 라벨된 큐 행이 아니라 **남의 택배 상태를 들은 고객**이
남는다.

금지되어 있고 테스트가 강제하는 것:

- 본문에서 주문번호 추출 후 자동 bind — `OrderBindingFenceTest`가 소스 전체를 검사
- LLM guess · 고객 이름 matching · 날짜+금액 heuristic
- **first candidate auto-select** — 결제 단위 참조가 여러 상품주문에 걸리면 **결합하지 않는다**.
  3줄 주문 중 1줄만 취소된 건에 대해 "이 주문 취소됐나요?"의 참인 단일 답은 없고, 첫 행은 그 답이 아니다
- `InquiryOrderFactReader`가 `getBody()`/`getTitle()`/`MarkupText`를 참조하는 것

source가 참조를 주지 않으면 **UNBOUND**로 남고, 그것이 Cafe24 board 6의 통상적인 답이다.

**두 종류의 부재를 구별한다.** `orderRef == null`은 "이 source에는 주문 lane이 없다"(파일 업로드,
ESM, NAVER 상품 문의)이고 기존 결합을 **지우지 않는다**. `ChannelOrderRef.absent()`는 "lane이 있는데
이 행에는 값이 없다"는 **적극적 진술**이고, 낡은 결합을 지운다.

---

## 6. PART F — Freshness

새 축을 만들지 않았다. `ChannelDataState`(Cross-Channel Operational Reasoning v1)를 그대로 쓴다 —
그 enum은 이미 **능력의 한계와 깨진 자격 증명이 같은 단어를 쓰지 못하게** 만들어져 있다.

`OrderFactState`가 더하는 것은 그 축이 알 수 없는 **문의 단위**의 두 가지뿐이다.

| 값 | 뜻 | 말해도 되는 것 |
|---|---|---|
| `OBSERVED_FRESH` | 정확 일치 + 채널 수집이 최신 | **현재 상태로** 말해도 된다 |
| `OBSERVED_FRESHNESS_UNPROVEN` | 정확 일치 + 최신 증명 불가 | **자기 날짜와 함께** 인용만 |
| `NO_ORDER_REFERENCE` | source가 주문을 지목하지 않음 | 조회 대상 없음(실패 아님) |
| `ORDER_NOT_FOUND` | 지목했고 일치 행 없음 | **"그 주문은 없습니다"가 아니다** |
| `SOURCE_UNAVAILABLE` | 미연결·재인증·미지원 | 초안에겐 같고, 화면에겐 다르다 |

**`ORDER_SUMMARY` coverage 행을 그대로 쓰지 않는다.** 둘은 다른 질문이고 지금 서로 다른 답을 낸다:
Cafe24의 `ORDER_SUMMARY` routine은 일정대로 SUCCESS하며 일일 건수·금액을 쓰고 있고, 같은 시각
`channel_orders`의 Cafe24 행은 **0**이다. 집계가 번 freshness로 개별 주문을 말하면, **어느 주문도
지목하지 못하는 숫자**가 인용의 근거가 된다. `perOrderState`가 같은 순서(support → connection →
freshness)를 per-order 행 수 위에서 다시 돈다.

과거에 PAID였던 행을 현재 PAID라고 말하지 않는다 — `OBSERVED_FRESHNESS_UNPROVEN`의 문장은
*"… (8월 21일 확인 시점 기준이며, 이후 변경되었을 수 있습니다.)"*이다.

---

## 7. PART G — Draft Grounding

네 번째 evidence kind가 생겼고, **검색 fence는 움직이지 않았다.**

`KIND_ORDER_FACT`는 문서를 가리키지 않는다(`source_id`/`chunk_id` null). 다른 셋은 같은 chunk를
다시 열면 초안이 본 문장이 그대로 있지만, 주문 상태는 다음 주에 다른 값이고 그것이 정상이다.
그래서 locator가 **언제 확인한 무엇이었는지**를 적는다 — `order-fact/NAVER:OBSERVED_FRESH@2026-08-25`,
주문 번호 없이.

`InquiryDraftEvidence.kindOf(scope)`는 여전히 `ORDER_STATE`/`CHANNEL_FACT`에서 **throw한다**.
막아야 했던 것은 "ORDER_STATE를 인용하는 것"이 아니라 **"ORDER_STATE를 검색하는 것"** — 낡은 사본의
코퍼스 — 이었고, 검색 결과에서 이 kind로 가는 경로는 없다(`KnowledgeScopeTest`).

프롬프트 `agent-draft-prompt/v4`가 더한 규칙:

1. 「주문 상태」는 정책과 **다른 종류의 근거**다.
2. **결제 완료는 결제까지만이다** — 발송·도착·배송 중 무엇도 따라 나오지 않는다. [운영 정책]의 평균
   발송 기준은 **일반 안내로** 쓸 수 있고, **이 주문이 언제 출발/도착한다고는 쓸 수 없다**.
3. 확인 시점 기준이면 **시점을 함께 밝히고** 지금 상태로 단정하지 않는다.
4. **발급 가능 여부(정책)와 이 주문에서 실제로 그렇게 되었는지(주문 상태)는 다른 사실이다.**

canonical 예시 4개가 각각 위 규칙에 대응한다: 취소 확인 → 단정 가능 / 배송 문의 → 정책만 / 현금영수증
→ 가능 여부만 / fact unavailable → limitation, 추측 0.

`AgentDraftPayloadFloorTest`가 직렬화된 요청 바이트 위에서 주문 식별자 부재를 검증한다.

---

## 8. PART H — REAL Coverage Benchmark (2026-08-25 실측, marketplace 접촉 0)

`GET /api/inquiries/knowledge-coverage?channelCode=CAFE24` · REAL · ACTIVE · UNANSWERED **69건**

| | before | after |
|---|---:|---:|
| 주문 축 필요 (`byAxis.ORDER_CONTEXT_NEEDED`) | 31(오측) | **29** |
| exact order reference 보유 | 0 | **0** |
| exact order bound | 0 | **0** |
| fresh OrderFact | 0 | **0** |
| stale / unavailable | — | `NO_ORDER_REFERENCE` **69** |
| grounded draft 가능 | 0 | **0** |
| 정책도 필요 (`missingPolicy`) | 52 | **52** |
| 여전히 unanswerable | 69 | **69** |
| 저장된 Cafe24 per-order 행 | 0 | **0** |
| exact lookup capability | — | `NO_VENDORED_EXACT_LOOKUP` |

**29 → 29 grounded를 목표로 하지 않았고, 도달하지도 않았다.** source가 증명하는 만큼만이며 오늘
Cafe24가 증명한 것은 0이다. 움직인 것은 셋이다.

1. **측정이 정확해졌다** — 31→29, 그리고 상품 축 27→4.
2. **참조가 저장될 자리가 생겼다** — 다음 수집부터 채널이 주문을 지목하면 그것이 남는다.
3. **막힌 이유가 이름을 얻었다** — `NO_ORDER_REFERENCE` 69는 "우리가 못 읽는다"가 아니라
   "이 문의들이 주문을 지목하지 않는다"이고, 둘은 다른 작업으로 이어진다.

**정책이 없는 건은 order fact가 생겨도 정책 부분이 missing으로 남는다** — `missingPolicy`는 order
축과 독립적으로 세어지고, 52는 이 package로 줄지 않았다.

---

## 9. PART I — deterministic fast path

단순 factual query는 Agent Planner를 타지 않는다. `GET /api/inquiries/{workItemId}`의
`orderContext`가 **join 한 번**이다 — 모델 호출 0, planner 0, marketplace 0. 화면의 주문 상태 표시
때문에 LLM을 부르지 않는다.

복합 질문("취소 요청한 고객에게 뭐라고 답하는 게 좋을까?")만 Agent를 타고, 거기서 order fact는
policy·answer memory와 나란히 **각자 다른 evidence kind**로 들어간다.

---

## 10. PART J — UI

**운영 정보** 카드, 문의 상세 안, 고객 질문 바로 아래.

- **주문 참조가 없으면 아무것도 그리지 않는다.** "확인되지 않음" 세 줄짜리 빈 카드는
  *"주문을 찾아봤고 상태가 없다"*로 읽히고, 그러면 판매자는 다른 곳에서도 이 카드를 믿지 않게 된다.
- **참조가 있는데 못 읽었으면 그린다** — 판매자가 주문을 물었으니 못 읽었다는 사실이 정보다.
- **결제 / 배송 / 취소 세 줄**, 각자 독립적으로 "확인되지 않음". 윗줄에서 확신을 빌려오지 않는다.
- **개발 enum 0** — `state`는 테스트·진단용으로만 실리고 화면에 나오지 않는다.
- freshness는 *"마지막 확인 8월 21일 기준입니다."* / *"현재 상태를 다시 확인할 수 없습니다."*
- **PII 0 · 주문번호 0 · 금액 0.**

---

## 11. PART L — live READ manifest

**이 package의 증명에는 marketplace 접촉이 필요하지 않았다.** 이유는 §2다: exact lookup 계약이
없으므로 (2)단계 자체가 없고, (1)단계는 이미 저장된 `channel_orders` 위에서 오프라인으로 증명된다
(`InquiryOrderFactReaderTest` 11건). **실행한 라이브 호출: 0.**

남은 열린 질문은 하나뿐이고, 그것을 답하는 manifest를 **준비만** 한다. **승인 없이 실행하지 않는다.**

### Manifest — `CAFE24-BOARD6-ORDERREF-PROBE`

| 항목 | 값 |
|---|---|
| **목적** | board 6 문의 글이 `order_id`에 **값을 실제로 싣는가** (§1.3의 미관측) |
| **endpoint** | `GET /api/v2/admin/boards/6/articles` — **기존 INQUIRY 수집이 이미 쓰는 그 호출** |
| **new API surface** | **없음.** 새 endpoint를 열지 않는다 |
| **scope** | `mall.read_community` (이미 부여됨). `mall.read_order` **사용하지 않음** |
| **target scope** | Demo Org Cafe24 연결 1개, 최근 창 1개, `limit ≤ 100` |
| **expected request count** | **≤ 3** |
| **stored fields** | `inquiries.source_order_ref`, `inquiries.order_binding` (값이 있는 행만) |
| **explicitly discarded PII** | `writer` · `writer_email` · `member_id` · `client_ip` — projection 없음 |
| **보고 값** | 읽은 행 수, `order_id` 비어있지 않은 행 수. **값 자체는 출력하지 않는다** |
| **WRITE** | **0** |

**주의 — standing routine grant에 대한 사실 공개.** Cafe24·NAVER의 `INQUIRY` routine은 Self-Pilot
standing read grant 아래 60분 주기로 **이미 켜져 있고**, 재시작된 백엔드는 새 mapper를 쓴다. 따라서
**내가 아무 호출도 하지 않아도** 다음 routine tick이 같은 endpoint를 같은 scope로 읽고 참조가 있으면
저장한다. 이것은 새 surface가 아니라 **기존 수집이 응답의 어느 필드를 버리지 않게 된 것**이다.
그 tick 전에 멈추기를 원하면 해당 schedule을 끄면 된다.

---

## 12. 남은 한계 (열림, blocker 아님)

- **Cafe24 `order_id` 값 존재 여부 미관측** — §11의 manifest 한 건.
- **exact single-order lookup 계약 미보유(3채널 전부)** — external research required. 억지 수집
  전략을 만들지 않았다.
- **NAVER 주문 저장 창과 문의 창이 겹치지 않는다** — `channel_orders` NAVER는 2026-08-21~24(68행),
  고객 문의 5건은 2026-06-09~08-12. 참조를 잡아도 오늘은 `ORDER_NOT_FOUND`로 떨어진다.
  이것은 결함이 아니라 수집 범위이고, `ORDER_NOT_FOUND`가 "없다"고 말하지 않는 이유다.
- **상태 어휘가 `PAYED` 하나만 관측되었다** — Coupang `DELIVERING`/`FINAL_DELIVERY`는 저장되어
  있으나 `UNKNOWN`으로 정규화된다. 넓히려면 라이브 관측이 필요하고 추측하지 않는다.
- **Cafe24 backlog는 2014~2025 아카이브다** — 이 package의 가치는 앞으로 들어올 문의에 있다.

## 13. 관련 문서

- `docs/seller_operations_knowledge_and_answer_memory_v1.md` — 세 검색 lane, scope 모델
- `docs/inquiry_workflow_completion_v2.md` — RAG correctness, `USER_CONFIRMED` 상품 결합
- `docs/cross_channel_operational_reasoning_v1.md` — `ChannelDataState`(freshness 축)
- `docs/multi-channel-connector-roadmap.md` §4.1 — capability 선언(이 package는 어떤 상태도 옮기지 않는다)
