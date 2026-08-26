# Operational Knowledge Direction v1 — 방향만, 구현 없음

> **이 문서는 아무것도 구현하지 않는다.** 장기 방향을 기록해서, 오늘의 좁은 선택이 내일의 넓은
> 구조를 **막지 않게** 하는 것이 전부다. 현재 phase의 실제 범위는 **상품 상세페이지 grounding까지**다.
> 작성 2026-08-26 (product-owner decision).

## 1. 왜 이걸 적어 두는가

지금 reviewnary가 답변의 근거로 검색하는 것은 사실상 **상품 지식**과 **org 운영 정책**, 그리고
판매자의 **과거 답변**이다. 그것으로 답할 수 있는 질문은 실제 백로그의 일부일 뿐이다. 판매자에게
오는 질문은 이런 것들이다 — 「이거 오늘 보내주시나요」 「재고 있나요」 「사은품 아직 주나요」
「이 옵션은 언제 들어와요」 「반품비 얼마예요」.

이 답들은 상품 상세페이지에 없다. **여러 시스템과 문서와 판매자의 머릿속에 흩어져 있다.**

위험한 것은 그 사실 자체가 아니라, 그 사실을 모른 채 오늘의 구조를 굳히는 것이다. 「knowledge란
곧 Product FAQ다」라고 가정한 스키마·검색·프롬프트를 만들면, 나중에 배송 일정을 넣으려 할 때
그것을 **가짜 상품 FAQ로 위장**해서 넣게 된다. 그러면 근거의 출처가 무의미해지고, 틀렸을 때 어디를
고쳐야 하는지 아무도 모르게 된다.

## 2. 언젠가 근거가 될 수 있는 것들

Product / Variant · Shipping schedule / shipping rule · Inventory / availability · Promotion ·
Gift(사은품) · Return / exchange policy · Channel-specific rule · Order context ·
Organization CS policy · Seller-authored operational note · 그 밖의 운영 사실.

## 3. 장기적으로 지향하는 모양

```
Entity  ─ 무엇에 대한 사실인가        (상품 · 옵션 · 주문 · 채널 · 조직)
Fact    ─ 그 사실 자체
Relation─ 무엇이 무엇에 매이는가
Provenance ─ 누가 언제 어디서 말했나  (판매자 입력 · 판매자 상세페이지 · 채널 API · AI 추출)
Applicability ─ 이 질문·이 고객·지금에 적용되는가
```

이 다섯은 **새 개념이 아니라 이미 저장소에 흩어져 있는 것들의 이름**이다:

| 장기 개념 | 오늘 이미 있는 것 |
|---|---|
| Provenance | `KnowledgeAuthorship`(V77) · `DataOrigin` · `AnswerMemoryStrength` · `FactConfidence` |
| Applicability | `SpecApplicability` · `OrderFact` freshness · `ChannelDataState` |
| Entity/Fact 분리 | `KnowledgeScope`(5종) · `product_facts` vs `product_knowledge_sources` |
| Relation | `InquiryOrderBinding` · `product_binding` · `thread_parent_external_id` |

즉 **ontology를 새로 만들어야 하는 상태가 아니라, 이미 그 방향으로 갈라져 있다.**

## 4. 이번 phase에서 **금지**

- ontology / knowledge graph 구현
- generic operational fact engine
- 배송 · 사은품 · 프로모션 · 재고의 **신규 ingestion**
- 새 connector 확장

## 5. 대신 지키는 것 — 「knowledge는 항상 Product FAQ다」가 되지 않게

이미 지켜지고 있고, 계속 지켜야 하는 성질들:

1. **`KnowledgeScope`는 상품에 매이지 않는다.** `ORG_OPERATIONS`·`ORDER_STATE`·`CHANNEL_FACT`가
   이미 상품 없이 존재하고, 상품이 없는 문의도 정책만으로 `GROUNDED`가 된다.
2. **검색 코퍼스를 갖지 않는 scope가 이미 둘 있다.** `ORDER_STATE`와 `CHANNEL_FACT`는 결정론적
   출처에서 그때 읽는다 — 「모든 지식은 문서로 색인된다」는 가정이 이미 깨져 있다. 재고·배송 일정처럼
   **변하는** 사실이 들어올 자리는 문서가 아니라 이 자리다.
3. **작성자 축과 문서 종류 축은 직교한다.** `KnowledgeAuthorship` × `KnowledgeSourceType`.
   새 출처가 생겨도 「누가 썼나」를 다시 설계하지 않는다.
4. **현재 사실과 과거 발언은 구조적으로 갈라져 있다**(`KnowledgeScope.current()`).
   새 운영 사실은 전부 CURRENT 쪽에 들어오면 되고, 우선순위 규칙을 다시 쓸 필요가 없다.
5. **적용 가능성은 근거와 별개의 주장이다**(`SpecApplicability`). 「근거가 검색됐다」와 「이 고객의
   이 질문에 그대로 쓸 수 있다」는 다르고, 그 구분은 배송·재고·프로모션에서 **더** 필요해진다
   (오늘의 배송 일정은 내일 틀리다).

**한 문장으로:** 새 종류의 운영 사실을 추가할 때 손대야 할 것은 **출처와 적용 가능성**이지,
검색·프롬프트·근거 표시의 **구조**가 아니어야 한다. 그렇지 않게 되는 변경이 나오면 그때 멈추고
이 문서를 다시 연다.
