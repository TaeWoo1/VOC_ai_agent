package com.sellerops.knowledge.bootstrap;

/**
 * The three kinds of operating history a new seller already has on their channels, and that Reviewnary can learn from
 * without the seller writing anything.
 *
 * <p>Seller material (manuals, typed notes) and seller decisions are not here: they are knowledge the seller gives
 * Reviewnary directly, not history read back from a channel.
 */
public enum HistorySource {

    /** A past customer inquiry and the answer the seller actually published on the channel. */
    PAST_INQUIRY_ANSWER("과거 문의 답변"),

    /** A past review and the reply the seller actually posted on the channel. */
    PAST_REVIEW_REPLY("과거 리뷰 답글"),

    /** What the listing itself states — the 상세페이지 text, the options, the stated attributes. */
    PRODUCT_DETAIL("상품 상세 정보");

    private final String labelKo;

    HistorySource(String labelKo) {
        this.labelKo = labelKo;
    }

    public String labelKo() {
        return labelKo;
    }
}
