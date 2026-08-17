package com.sellerops.review.triage.feedback;

/**
 * What the seller did on the way — weighted silver, never a label
 * ({@code contracts/review-triage-events/v1/CONTRACT.md} §2.1, feedback draft §7).
 *
 * <p>Four kinds and, deliberately, <b>no {@code IGNORED}</b>. Absence of rows is the record of a
 * review being ignored, and absence is confounded by queue position, staffing, notification timing
 * and lunch. Writing it as an event would give it the shape of a signal it does not have, and
 * §7.2's asymmetry — ignore may lower a silver weight, never a tier — depends on nobody being able to
 * query it as one.
 *
 * <p>Two of these are channel-gated by {@code ReviewTriageChannelCapability}: a channel with no way
 * to show the original cannot produce {@link #ORIGINAL_OPENED} or {@link #MARKETPLACE_LOCATED}, and a
 * client claiming one is dropped rather than stored.
 */
public enum TriageBehaviorKind {
    /**
     * A row carrying the pilot's {@code AI 확인 필요} mark was rendered. Written only when the SERVER
     * resolves the display to {@code shownSource=AI}; a client's claim on a row the server would
     * render as {@code RULES} is dropped. The weakest signal there is.
     */
    AI_ATTENTION_SHOWN,
    /** The operator opened the review's detail. */
    REVIEW_OPENED,
    /** The operator asked to see the original — pressed the channel's control. Requires the capability. */
    ORIGINAL_OPENED,
    /** The locate run reported the review found on the seller's own marketplace screen. Coupang only, today. */
    MARKETPLACE_LOCATED
}
