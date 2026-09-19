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
