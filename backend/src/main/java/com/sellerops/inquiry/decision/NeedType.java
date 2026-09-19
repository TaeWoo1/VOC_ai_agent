package com.sellerops.inquiry.decision;

/**
 * What one customer need is ABOUT (Inquiry Decision v2). The same eight words the Inquiry Need Eval v1 labels use
 * ({@code tools/inquiry-need-eval/vocabulary.mjs}), so a production verdict and a gold label can be compared word for
 * word. The planner chooses; nothing here reads a sentence.
 */
public enum NeedType {
    PRODUCT_SPEC, PRODUCT_USAGE, PRODUCT_COMPATIBILITY, CATALOGUE_AVAILABILITY,
    POLICY, ORDER_STATE, ORDER_ACTION, SELLER_DECISION;

    /** Needs about the listing itself — the ones a 상세페이지 could answer, so the ones a detail gap can leave open. */
    public boolean aboutTheListing() {
        return this == PRODUCT_SPEC || this == PRODUCT_USAGE || this == PRODUCT_COMPATIBILITY
                || this == CATALOGUE_AVAILABILITY;
    }

    /**
     * The entity INSTANCE this need is about, when it is about one (Inquiry Decision v2.2): a listing's own facts, or one
     * customer's order. Availability is about the catalogue, policy about the company, a seller decision about no
     * evidence at all — none of them names an instance.
     */
    public EvidenceScope.Kind instanceScope() {
        return switch (this) {
            case PRODUCT_SPEC, PRODUCT_USAGE, PRODUCT_COMPATIBILITY -> EvidenceScope.Kind.PRODUCT;
            case ORDER_STATE, ORDER_ACTION -> EvidenceScope.Kind.ORDER;
            default -> null;
        };
    }

    /**
     * Whether a FULL for this need requires at least one candidate attributed to the SAME instance. For an order: yes —
     * no company rule and no listing fact can say what happened to THIS order. For a listing: no — a company-wide
     * statement ("every product ships with …") may answer a listing question, so a listing need only refuses ANOTHER
     * listing's evidence.
     */
    public boolean fullRequiresAttributedEvidence() {
        return instanceScope() == EvidenceScope.Kind.ORDER;
    }

    public static NeedType parse(String s) {
        if (s == null) {
            return null;
        }
        for (NeedType t : values()) {
            if (t.name().equals(s.trim())) {
                return t;
            }
        }
        return null;
    }
}
