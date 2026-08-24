package com.sellerops.knowledge;

/**
 * What KIND of thing an answer is grounded in — the closed set that keeps two questions apart:
 * "who said this" and "may it be retrieved at all".
 *
 * <p><b>Why scope is not a source_type.</b> {@code KnowledgeSourceType} already says what a seller
 * wrote (FAQ, USAGE, POLICY). This says something the reader of a draft needs first: whether the
 * sentence in front of them came from this product, from the company's standing operating policy,
 * from what the seller has actually answered before, from the platform, or from live operational
 * state. Those five fail in five different ways, and an answer that mixes them cannot be corrected —
 * a wrong shipping promise is fixed by editing a policy, a wrong order status is fixed by looking at
 * the order, and neither fix reaches the other.
 *
 * <p><b>Two of the five are deliberately not retrievable.</b> {@link #CHANNEL_FACT} and
 * {@link #ORDER_STATE} have {@link #retrievable()} false, and no ingestion path writes them into a
 * knowledge store. They are read from the deterministic source that owns them — the capability
 * registry and the collected order rows — at the moment they are needed. Copying either into a
 * retrievable corpus would create a second, stale copy of a fact that changes without anyone
 * editing it: an order that shipped this morning would still be "결제완료" in the passage, and the
 * draft would cite it. {@code KnowledgeScopeTest} asserts that absence structurally rather than
 * trusting this paragraph.
 *
 * <p><b>And platform knowledge is never seller policy.</b> {@link #CHANNEL_FACT} is what NAVER,
 * Coupang or Cafe24 do; {@link #ORG_OPERATIONS} is what this seller does. "이 채널은 판매자 답변
 * API가 없다" and "저희는 교환을 7일 안에 받습니다" are both true and neither substitutes for the
 * other, which is exactly the confusion a single "정책" bucket would create
 * ({@code docs/demo_org_and_channel_knowledge_v1.md}).
 */
public enum KnowledgeScope {

    /** 이 상품에 대해 판매자가 쓴 지식 — 스펙, 사용법, 상품 FAQ, 상품별 주의사항. */
    PRODUCT(true),

    /** 판매자가 쓴 org 단위 운영 지식 — 배송, 취소, 교환/환불, 결제, 증빙, 공통 CS. */
    ORG_OPERATIONS(true),

    /** 판매자가 실제로 작성했거나 승인한 과거 답변. */
    PAST_ANSWER(true),

    /** 플랫폼이 무엇을 지원하는가. 판매자 정책이 아니고, RAG에 들어가지 않는다. */
    CHANNEL_FACT(false),

    /** 지금 이 주문의 상태. 결정론적 출처에서 그때 읽는다. 복사하지 않는다. */
    ORDER_STATE(false);

    private final boolean retrievable;

    KnowledgeScope(boolean retrievable) {
        this.retrievable = retrievable;
    }

    /**
     * Whether this scope is answered by searching a stored corpus.
     *
     * <p>False means there is no corpus and there must not be one: the answer comes from the system
     * that owns the fact, at read time.
     */
    public boolean retrievable() {
        return retrievable;
    }

    /** The seller-facing name of this evidence group. Not the enum name — a screen shows this. */
    public String labelKo() {
        return switch (this) {
            case PRODUCT -> "상품 정보";
            case ORG_OPERATIONS -> "운영 정책";
            case PAST_ANSWER -> "과거 답변";
            case CHANNEL_FACT -> "채널 지원 범위";
            case ORDER_STATE -> "주문 상태";
        };
    }
}
