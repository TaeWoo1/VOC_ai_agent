package com.sellerops.opportunity;

/**
 * Where the seller's decision stands. {@code OPEN} is the absence of a row — the derived opportunity
 * as the rules produce it, nothing decided yet. The other two are stored.
 */
public enum OpportunityStatus {
    OPEN("검토 전"),
    ACCEPTED("초안 준비됨"),
    DISMISSED("보류");

    private final String labelKo;

    OpportunityStatus(String labelKo) {
        this.labelKo = labelKo;
    }

    public String labelKo() {
        return labelKo;
    }
}
