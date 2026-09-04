package com.sellerops.opportunity;

/**
 * The four things a seller can DO about a repeated problem in v1 — the closed vocabulary of
 * {@code improvement_opportunity.kind}.
 *
 * <p>Each kind names a place the seller controls (their FAQ, their detail page, their operating
 * rules, their product) rather than a cause. "접착 불만이 반복됩니다" is an issue; "접착 안내를 FAQ에
 * 보완하는 것을 검토하세요" is an opportunity — the second is a suggestion about where to act, and it
 * carries no claim about WHY the customers complained.
 *
 * <p>The prepared action stops at a draft, and the draft's destination is a seam that already exists
 * and already belongs to the seller: FAQ / 운영 기준 drafts go into the knowledge library through the
 * quick-add the inquiry and review screens use, and the other two are text the seller copies. Nothing
 * here can reach a marketplace ({@code OpportunitySafetyFenceTest}).
 */
public enum OpportunityKind {
    /** Add a customer-facing answer to the product's FAQ — chosen when the library says nothing about the aspect. */
    FAQ_SUPPLEMENT("FAQ 보완", "FAQ 초안 준비"),
    /** Make what the seller already knows visible BEFORE purchase — the detail page / 안내. */
    PRODUCT_GUIDE_SUPPLEMENT("상품 상세·안내 보완", "상세페이지 안내문 초안 준비"),
    /** The company's own rule about a topic that is not one product's (배송) — register or sharpen it. */
    OPERATING_POLICY_SUPPLEMENT("운영 기준 보완", "운영 기준 초안 준비"),
    /** The product or its packaging itself keeps failing — a review memo, not a verdict. */
    PRODUCT_IMPROVEMENT_REVIEW("제품 개선 검토", "제품 개선 검토 메모 준비");

    private final String labelKo;
    private final String actionLabelKo;

    OpportunityKind(String labelKo, String actionLabelKo) {
        this.labelKo = labelKo;
        this.actionLabelKo = actionLabelKo;
    }

    public String labelKo() {
        return labelKo;
    }

    /** The one prepared action this kind offers — a draft, never a send. */
    public String actionLabelKo() {
        return actionLabelKo;
    }
}
