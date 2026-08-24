# Seller Operations Knowledge & Answer Memory v1

**날짜** 2026-08-25 · **브랜치** `feat/agent-evidence-scope-integrity` · **org** `7146c50f`
**판정** 구조 완료 · **마켓플레이스 접촉 0 · WRITE 0 · Agent tool catalogue 무변경**

이 문서는 Daily Loop의 **"정책 / 과거 답변 / Memory" 축**을 소유한다. 상품 지식(`docs/inquiry_workflow_completion_v2.md`)
과 문의 귀속(`docs/inquiry_product_attribution_action_coverage_v1.md`)이 닫힌 뒤 남아 있던 자리다.
새 connector는 없고, §4.1 capability 표는 한 행도 움직이지 않는다.

---

## 1. 왜 이것이 다음 순서였나 — 숫자 하나

Demo Org의 **REAL Cafe24 미답변 backlog 69건**을 주제로 세면:

| 주제 | 건수 |
|---|---|
| 세금계산서 | 25 |
| 배송 | 21 |
| 현금영수증 | 17 |
| 주문번호를 언급 | 13 |
| 주문 취소 | 3 |
| 교환·반품 | 2 |
| **규격·사양** | **1** |

상품 지식을 320개 상품 전부에 채워도 이 backlog는 열리지 않는다. **없던 것은 상품 지식이 아니라
회사의 운영 정책이었고, 그것을 담을 자리가 아예 없었다.** 지식이 전부 `product_id`에 묶여 있었기
때문에, 상품으로 해석되지 않는 질문 — backlog의 대부분 — 은 **어떤 근거도 도달할 수 없는 구조**에
있었다.

---

## 2. Knowledge Scope — 다섯 개, 그리고 그중 둘은 저장소를 갖지 않는다

`com.sellerops.knowledge.KnowledgeScope`.

| scope | 무엇인가 | 검색되는가 | 어디서 오는가 |
|---|---|:---:|---|
| `PRODUCT` | 이 상품에 대해 판매자가 쓴 것 | ✅ | `product_knowledge_*` |
| `ORG_OPERATIONS` | 회사 단위 운영 정책 | ✅ | `org_knowledge_*` (신규) |
| `PAST_ANSWER` | 판매자가 실제로 한 답변 | ✅ | `answer_memory` (신규) |
| `CHANNEL_FACT` | 플랫폼이 무엇을 지원하는가 | ❌ | capability registry |
| `ORDER_STATE` | 이 주문이 지금 어떤 상태인가 | ❌ | `channel_orders` |

**뒤의 둘에 표를 만들지 않은 것이 이 모델의 핵심이다.** 둘 다 *아무도 편집하지 않았는데 틀려지는*
사실이다. 오늘 아침 발송된 주문은 어제 만들어 둔 passage 안에서 여전히 「결제완료」이고, 초안은 그
passage를 근거로 인용한다. 그래서 둘은 사실을 소유한 결정론적 출처에서 **필요한 순간에** 읽는다.
`KnowledgeScopeTest`가 이를 구조로 강제한다 — 검색 불가 scope는 인용 kind 자체를 만들 수 없다.

그리고 **플랫폼 지식은 판매자 정책이 아니다.** 「이 채널은 판매자 답변 API가 없다」와 「저희는 교환을
7일 안에 받습니다」는 둘 다 참이고 서로를 대신하지 못한다.

---

## 3. Seller Operations Knowledge (PART A·B)

`org_knowledge_sources` / `org_knowledge_chunks` (V72), 8개 닫힌 type:
`SHIPPING_POLICY` `CANCELLATION_POLICY` `EXCHANGE_REFUND_POLICY` `PAYMENT_POLICY`
`TAX_INVOICE` `CASH_RECEIPT` `GENERAL_CS_FAQ` `OTHER`.

**type 목록은 분류학이 아니라 위 §1의 backlog에서 골랐다.** 먼저 만들었다면 「브랜드 스토리」가 있고
`TAX_INVOICE`가 없었을 것이고, backlog의 4분의 1을 닫을 수 있는 문서가 들어갈 칸이 없었을 것이다.

**RAG stack을 두 번 만들지 않았다.** chunking·정규화·채점·부재 판정·임계값이 전부
`KnowledgeText` + **`KnowledgeRetriever`**(신규, 두 store가 공유)에 있다. 상품 라이브러리도 같은
코드를 호출하도록 옮겼다 — 2026-08-24의 retrieval 역전은 채점기 **하나**의 결함이었고, 사본이
있었다면 두 번 찾아 두 번 고쳐야 했다. vector DB 0, synonym ontology 0.

한 가지 실제 차이: 상품 라이브러리는 **상품 이름**을 질문에서 뺀다(그 라이브러리 안에서 어떤 문서도
구별하지 못하므로). org 코퍼스에는 그런 낱말이 없어 뺄 것이 없다 — 누락이 아니라 두 코퍼스의 차이다.

`version`은 **본문이 바뀔 때만** 오른다. 제목을 고치거나 분류를 옮기는 것은 지난주의 인용을
낡게 만들지 않는다.

---

## 4. Answer Memory (PART D·E)

`answer_memory` (V72). 들어올 수 있는 것은 **판매자의 완료된 행위 네 가지**뿐이고, 강도는 셋이다:

| strength | 무엇이 일어났나 |
|---|---|
| `IMPORTED_SELLER_ANSWER` | 채널이 「판매자가 이 답변을 등록했다」고 말한다 |
| `USER_APPROVED` | 판매자가 SellerOps에서 그 초안 판을 확정했다 |
| `EXECUTOR_SENT_VERIFIED` | 전송 후 채널을 다시 읽어 확인됐다 |

**AI 초안을 위한 값은 없고, 앞으로도 만들 수 없다.** 자기 출력을 다시 읽어 선례로 쓰는 모델은 매주
자기 자신에게 더 동의하게 되고, 인용은 끝까지 「판매자의 과거 답변」이라고 적힌다 — 그래서 이것은
코드 리뷰 노트가 아니라 **fence**다(`AnswerMemoryWriteFenceTest`: 작성자는 importer와 publish hook
둘뿐, 초안 composer는 `AnswerMemoryService`를 **참조조차 하지 않는다**).

**같은 문의의 답변은 자기 자신의 근거가 되지 않는다.** 승인된 답변이 memory가 된 뒤 같은 work item의
초안을 다시 만들면 그 답변이 「과거 답변」으로 돌아온다 — 출처 문의로 제외한다. 같은 문장이라도
**다른 문의**에서 승인된 것은 진짜 선례이므로 남는다.

### 개인정보는 key가 되지 않는다

`TopicSignature`: 질문의 낱말 중 **판매자 자신이 쓴 코퍼스에도 나타나는 낱말**만 남기고, 숫자를 포함한
토큰은 그 검사 이전에 버린다. 고객 이름은 배송 정책에 없고, 주소는 반품 정책에 없고, 주문번호는
어디에도 없다. **판매자가 아무것도 쓰지 않았으면 서명은 비고, 그것이 정답이다** — 이 함수의 가장
느슨한 형태는 「질문을 저장한다」이고 그것이 피하려던 바로 그것이다.

라이브 실측(18행, Demo Org): 서명은 `배송 배송을`·`케이블 mm`·`전선` 같은 판매자 어휘뿐.

### conflict (PART E)

같은 `topic_category` × 같은 상품 범위의 두 기억은 **하나의 규칙에 대한 두 진술**이다
(「교환 가능합니다」 vs 「제품 확인 후 안내드립니다」). 더 강하고 더 최근인 것이 지금 회사가 하는 일이고,
약한 쪽은 **삭제되지 않고 사용되지 않으며** `supersededByConflict`로 보고된다.
**org policy를 자동으로 덮어쓰지 않는다** — 선례가 규칙이 되는 것은 사람이 하는 결정이다
(`AnswerMemoryService`는 org knowledge repository를 아예 주입받지 않는다. 구조 테스트가 검사한다).

---

## 5. Retrieval Hierarchy (PART C)

`InquiryEvidenceRetriever`. 세 lane이 **모두** 돌고, **같은 채점기**로 채점되고, **점수로** 병합된다.

> source가 다르다는 이유로 한쪽을 무조건 우선하지 않는다. 「폭이 몇 mm인가요?」를 증명하는 것은 상품
> 노트뿐이고, 「현금영수증 발급 가능한가요?」를 증명하는 것은 운영 정책뿐이다. 미리 순위를 정하면
> 상품 라이브러리가 얇을 때마다 사양 질문이 배송 정책으로 답해진다 — 2026-08-24 역전이 모자만 바꿔 쓴 것.

**단 하나의 구조적 예외: 무언가를 찾아낸 lane은 자기 최고 passage 한 자리를 지킨다.** 혼합 질문
(「이 상품 반품하려면?」)은 상품 **과** 정책이 필요한데, 순수 top-N은 더 수다스러운 lane으로 답한다.
이것은 우선순위 주장이 아니라 「질문에 말할 수 있는 lane은 다른 lane이 두 번 말하기 전에 한 번은
들려야 한다」는 진술이다.

**상품이 없다고 초안을 포기하지 않는다.** backlog의 대부분은 상품으로 해석되지 않고, 그 질문들은
org 단위다. 상품 lane이 없을 뿐 초안은 여전히 근거를 갖는다.

`ORDER_STATE`는 `InquiryOrderContextReader`가 읽는다 — 그리고 **오늘은 읽을 수 없는 이유를 돌려준다**:
문의에 주문 참조가 없다(`inquiries`에 주문 컬럼이 없고 어떤 채널도 주지 않는다). 고객 문장에서
숫자를 뽑는 것은 이름으로 상품을 추측하는 것과 같은 종류의 추측이고 같은 방식으로 틀린다 —
「1234번 주문 문의드립니다」의 숫자는 전화번호일 수도, 상품 코드일 수도, 작년 주문일 수도 있다.

---

## 6. Draft Grounding (PART F)

- 근거는 scope별로 분리되어 기록된다: `PRODUCT_KNOWLEDGE` · `ORG_POLICY` · `ANSWER_MEMORY`
  (`inquiry_draft_evidence.kind`. 이 컬럼은 처음부터 문자열이었고 — 이 확장을 예상하고 있었다).
- 프롬프트(`agent-draft-prompt/v3`)는 근거를 `[상품 정보] [운영 정책] [과거 답변]`로 **표시해서** 준다.
  사양은 상품 정보에서만, 회사 규정은 운영 정책에서만. **과거 답변은 표현을 맞추는 데 쓰고 사실의
  출처로 쓰지 않는다.**
- 근거에 그렇게 적혀 있지 않는 한 금지: **환불 가능 단정 · 취소 완료 단정 · 배송/도착일 약속 ·
  재고 단정 · 출시 예정 약속.**
- **「주문 상태」 줄은 항상 존재하고 기본값이 「확인된 값 없음」이다.** 주문에 대해 아무 말도 듣지 못한
  모델은 고객의 문장에서 주문 상태를 추론해도 된다고 여긴다 — 주문 데이터가 하나도 없는 상태에서
  「곧 발송됩니다」가 나오는 경로가 그것이다.
- payload floor는 그대로: 나가는 것은 문의 제목·본문·검색된 판매자 문장, 그리고 닫힌 집합의 scope
  라벨뿐. id·점수·작성자·타임스탬프 0(`AgentDraftPayloadFloorTest`가 직렬화된 바이트에 대해 검사).

---

## 7. REAL Backlog Coverage Benchmark (PART G)

`GET /api/inquiries/knowledge-coverage?channelCode=` — DB만 읽고, 모델을 쓰지 않고, 초안을 만들지
않는다. **출력은 정수뿐이다**(코퍼스가 실제 고객 메일이므로 행 단위 보고는 backlog를 출력하는 것과
같은 유출이다).

### 2026-08-25 라이브 측정 — Cafe24, REAL, ACTIVE, 미답변 69건

| 무엇이 필요한가 | 건수 |
|---|---|
| `ORG_POLICY_NEEDED` | 27 |
| `MULTI_SOURCE` | 25 |
| `CURRENTLY_UNANSWERABLE` | 9 |
| `ORDER_CONTEXT_NEEDED` | 6 |
| `PRODUCT_KNOWLEDGE_NEEDED` | 2 |

| 무엇을 찾았나 | 건수 |
|---|---|
| `GROUNDED` | **0** |
| `PARTIALLY_GROUNDED` | 0 |
| `UNSUPPORTED` | **69** |

무엇이 없어서: **운영 정책 52** · 상품 지식 27 · 주문 맥락 31.
그때 라이브러리가 갖고 있던 것: org 정책 문서 **0** · 과거 답변 **18**.

### before / after — 숫자가 아니라 **막힌 이유**가 움직였다

| | before (이 package 전) | after (2026-08-25) |
|---|---|---|
| grounded | 0 / 69 | 0 / 69 |
| 52건이 막힌 이유 | **구조** — org 단위 근거가 도달 불가능 | **입력** — lane은 있고 문서가 없다 |
| 측정 가능한가 | 아니오 | 예 (`missingPolicy = 52`) |

**정직하게 적는다: 오늘 grounded 건수는 늘지 않았다.** 늘리려면 없는 정책을 지어내야 했고
(§8), 그것은 이 package가 명시적으로 금지한 일이다. 대신 **문서 한 건이 숫자를 움직인다**는 것이
회귀로 고정되어 있다(`InquiryKnowledgeCoverageServiceTest.writingThePolicyMovesTheNumber`:
현금영수증 문서 1건 작성 → `GROUNDED 0 → 1`, 세금계산서 질문은 그대로 열려 있음).

### REAL 5종 증명 (`GET /api/inquiries/{workItemId}/knowledge-evidence`, 읽기 전용)

| # | 종류 | need | state | 근거 | 지어낸 사실 |
|---|---|---|---|---|---|
| 1 | 상품 질문 (라이브러리 있음) | `PRODUCT_KNOWLEDGE_NEEDED` | `NO_MATCH` | 0 | 0 |
| 2 | 세금계산서 | `ORG_POLICY_NEEDED` | `NO_PRODUCT` | 0 | 0 |
| 3 | 현금영수증 | `ORG_POLICY_NEEDED` | `NO_PRODUCT` | 0 | 0 |
| 4 | 주문 상태 | `ORDER_CONTEXT_NEEDED` | `NO_LIBRARY` | 0 · `CHANNEL_ORDERS_NOT_COLLECTED` | 0 |
| 5 | 지식 없음 | `PRODUCT_KNOWLEDGE_NEEDED` | `NO_LIBRARY` | 0 | 0 |

**unsupported claim 0.** 다섯 건 모두 초안을 만들지 않고 측정했다 — 모델 호출 0, work item 이동 0,
초안 판 생성 0.

상품 lane 자체는 같은 REAL 코퍼스에서 라이브로 재확인했다(`/knowledge/search`, 5회):
「부착 방법」 → 2건 · 「재부착」 → 1건 · 「반품 배송비」 → 1건 · **「방수 되나요」 → 0건** ·
**「내부 폭이 몇 mm」 → 0건**(그 치수는 *다른* 상품에 적혀 있다). 역전은 재발하지 않았다.

---

## 8. Demo Knowledge Seed (PART H) — `NEEDS_SELLER_INPUT`

**정책을 창작하지 않았다.** 저장소를 감사한 결과 판매자가 쓴 org 단위 문서는 존재하지 않는다:

- Cafe24 board 6 게시글 **905건 전부 `PENDING`**, 댓글 미수집 ⇒ 판매자 답변 텍스트 0
- `product_facts`는 **채널이 말한 사실**(spec/taxonomy/desc)이지 판매자 운영 정책이 아니다 —
  같은 source로 섞지 않는다
- 몰의 공개 정책 페이지는 **라이브 접촉**이 필요하고 승인받지 않았다

**실재해서 실제로 쓴 것 하나**: NAVER의 REAL 답변 완료 문의 **18건**(상품 문의 13 · 고객 문의 5)에는
판매자가 스마트스토어에 직접 쓴 답변 본문이 있다. 이것이 Answer Memory의 정직한 seed이고,
`IMPORTED_SELLER_ANSWER`로 **18/18 적재**되었다(마켓플레이스 접촉 0 — DB만 읽는 boot backfill).

### 필요한 판매자 입력 — backlog 크기 순

| 문서 | 이것이 닫는 backlog |
|---|---|
| **세금계산서 발행 안내** | 25 |
| **배송 안내**(출고 기간·배송비·도서산간) | 21 |
| **현금영수증 발급 안내** | 17 |
| 주문 취소 안내 | 3 |
| 교환·반품·환불 안내 | 2 |

### 그리고 product-owner 결정 하나

Demo Org에는 이미 판매자가 쓴 **「교환 및 반품 안내」**가 있다 — 다만 **한 리스팅에 묶인 상품 지식**
으로. 본문 대부분(「단순 변심 반품은 수령일로부터 7일 이내, 왕복 배송비 5,000원 고객 부담」,
「불량·파손은 배송비 없이 교환」)은 명백히 회사 단위 문장이지만, 일부는 몰딩 고유다
(「이미 잘라서 사용하신 제품」). **이것을 org 범위로 올리면 다른 모든 상품에 같은 반품 규정을
적용하게 되므로 옮기지 않았다.** 결정은 판매자의 것이고, 결정만 나면 문서 하나로 끝난다.

---

## 9. Memory Update Hook (PART J)

`InquiryAnswerMemoryHook` — publish 생명주기의 두 지점에만 붙는다:

- **승인**(`binding.bind` 직후, 거절된 승인은 기억을 남기지 않는다) → `USER_APPROVED`,
  key `approved:<workItem>:<version>` (판이 바뀌면 다른 행위)
- **검증된 전송**(`runVerify`에서 `verified == true`일 때만) → `EXECUTOR_SENT_VERIFIED`,
  key `verified:<workItem>`

`DELIVERY_UNKNOWN`은 기억하지 않는다 — 고객이 받았는지 모르는 문장을 다음 초안의 선례로 쓰게 된다.

**계약만 먼저 연결했고 행을 위조하지 않았다.** 이 배포는 `executionEnabled=false`이므로 검증 경로는
실제 전송이 생기기 전까지 발화하지 않는다. 나중에 marketplace READ-back verification이 생기면
**같은 hook**을 쓴다.

---

## 10. UX (PART I)

- **설정 → 운영 정책 / 답변 기준** (`/settings/policies`). 주 메뉴는 건드리지 않았다
  (IA는 A7에서 고정). 개발자 enum은 화면에 나오지 않는다 — 「배송」·「세금계산서」·「교환·반품·환불」.
  「인용 단위 0개 (답변에 인용할 수 없습니다)」를 여기서 말한다, 조용히 인용되지 않는 대신.
- **문의 상세의 근거는 출처별로 묶인다**: 상품 정보 / 운영 정책 / 과거 답변. 답이 틀렸을 때 판매자가
  **어디를 고쳐야 하는지**가 목록의 목적이다 — 잘못된 사양은 상품 지식에서, 잘못된 배송 약속은
  운영 정책에서 고쳐지고, 한쪽 수정이 다른 쪽에 닿지 않는다.
- transport 이름(`DIRECT_API` 등)은 여전히 기본 화면에 없다.

---

## 11. 유지된 계약

Agent graph **WRITE 0**(agent-runtime 무변경) · explicit approval · draft hash binding ·
REAL provenance · target snapshot · subtype binding · pre-send revalidation(`OVERWRITE_WITHOUT_PROOF`
포함) · idempotency · ambiguous WRITE 재시도 없음 · synthetic action fence · cross-org 금지 ·
공식 API 우선 · **§4.1 무변경**.

새 connector 0 · proactive/scheduler agent 0(PART K) · vector DB 0 · synonym ontology 0 ·
bulk reply 0 · review reply 0 · dashboard 재설계 0 · 20 vs 69 결정 0.

---

## 12. 남은 blocker

1. **운영 정책 문서 (판매자 입력)** — §8. 52/69가 여기서 막혀 있다.
2. **한 물건이 여러 canonical product** — 「선바로」는 `[벌크]`·`[박스발송]`·`[패키지]` 등 별개 상품으로
   존재하고, 지식 3건과 기억 7건은 `[박스발송]`에, backlog의 유일한 라이브러리 보유 문의는
   `[벌크]`에 붙어 있다. **자동 merge는 금지되어 있으므로**(이전 package) 이것은 product-owner 결정이다.
3. **주문 ↔ 문의 연결 없음** — `ORDER_CONTEXT_NEEDED` 31건이 여기서 막힌다. 연결이 생기면 변경은
   `InquiryOrderContextReader` 안의 조회 하나뿐이다(초안은 이미 부재를 말할 줄 안다).
4. **Cafe24 댓글 semantics** · **`writer`/`password` 조달** — 이전 package에서 이월, 변동 없음.

---

## 13. 다음 highest-leverage package (하나)

**Operational Fact Binding v1 — 주문을 문의에 붙인다.**

이유: 남은 세 blocker 중 둘(§12.3, 그리고 §12.1의 절반)이 「이 문의가 무엇에 대한 것인지」를
결정론적으로 아는 문제이고, `ORDER_CONTEXT_NEEDED` 31건은 **정책 문서를 아무리 써도 열리지 않는다**.
정책은 판매자가 하루면 쓰지만 주문 연결은 제품이 만들어야 하는 것이고, 만들어지면 배송·취소·환불
문의가 처음으로 **사실**에 근거하게 된다 — 지금은 그 세 종류 전부가 "확인 후 안내"에서 끝난다.
(자율 Agent는 여전히 그 뒤다.)
