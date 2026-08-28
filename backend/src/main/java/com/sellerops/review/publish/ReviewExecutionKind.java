package com.sellerops.review.publish;

/**
 * How reviewnary can carry an approved review reply to its channel — the per-channel execution
 * capability the Agent reasons with ({@code ReviewChannelCapabilityView.executionKind}).
 *
 * <p>Closed vocabulary shared with the runtime contract. It says what the PRODUCT can do as built and
 * configured, never what a marketplace could do in the abstract: Cafe24 is {@code API_EXECUTION} only
 * while the execution flag, the connector and the seller's write grant are all on; NAVER's reply is a
 * guided browser flow where the seller presses submit; Coupang gives sellers no reply feature at all.
 */
public enum ReviewExecutionKind {
    API_EXECUTION,
    GUIDED_BROWSER_EXECUTION,
    NOT_SUPPORTED
}
