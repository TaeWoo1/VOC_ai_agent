package com.sellerops.review.triage;

import java.util.Map;

/**
 * The three-channel capability table of {@code contracts/review-triage-events/v1/CONTRACT.md} §1 —
 * as one value per channel, read by the boundary, the endpoints and (on the wire) the UI.
 *
 * <p><b>This is the only place the table is stated.</b> {@code ReviewTriageChannelGate} asks it
 * whether a review may be classified; {@code ChannelReviewFeedbackService} asks it whether an event
 * kind is one this channel can produce; {@code ChannelReviewService} puts it on the page so the UI
 * renders no control the server would refuse. A channel that is not in the table gets
 * {@link #OUTSIDE}: nothing is permitted, and the answer is the same from every reader.
 *
 * <p>The values are facts about the product as built, not about the marketplaces in the abstract:
 * NAVER "reply" is the attention surface's guided copy-and-paste flow (never a verified post); Cafe24
 * has no reply flow built; Coupang has no reply feature at all (policy gate D8) and no reply event may
 * ever be written for it. "See the original" is a Coupang locate run and nothing else — no channel has
 * a per-review URL SellerOps could honestly link.
 */
public record ReviewTriageChannelCapability(String channelCode, boolean aiTriage, OriginalLocate originalLocate,
                                            boolean replySupported) {

    /** How a seller can be shown the original: not at all, or by an Action Window locate run. */
    public enum OriginalLocate {
        NONE,
        LOCATE_RUN
    }

    public static final ReviewTriageChannelCapability NAVER =
            new ReviewTriageChannelCapability("NAVER", true, OriginalLocate.NONE, true);
    public static final ReviewTriageChannelCapability CAFE24 =
            new ReviewTriageChannelCapability("CAFE24", true, OriginalLocate.NONE, false);
    public static final ReviewTriageChannelCapability COUPANG =
            new ReviewTriageChannelCapability("COUPANG", true, OriginalLocate.LOCATE_RUN, false);

    /** Every channel not in the table. Nothing is permitted; the code is carried so refusals can name it. */
    public static ReviewTriageChannelCapability outside(String channelCode) {
        return new ReviewTriageChannelCapability(channelCode == null ? "UNKNOWN" : channelCode, false,
                OriginalLocate.NONE, false);
    }

    private static final Map<String, ReviewTriageChannelCapability> TABLE = Map.of(
            NAVER.channelCode(), NAVER,
            CAFE24.channelCode(), CAFE24,
            COUPANG.channelCode(), COUPANG);

    /** Compared exactly; there is no normalisation to be lenient with. */
    public static ReviewTriageChannelCapability of(String channelCode) {
        ReviewTriageChannelCapability c = channelCode == null ? null : TABLE.get(channelCode);
        return c == null ? outside(channelCode) : c;
    }

    /** True for the three channels the contract names, whatever their individual columns say. */
    public boolean inContract() {
        return TABLE.containsKey(channelCode);
    }

    /** Whether this channel can produce the given behaviour event at all (contract §2.1). */
    public boolean permits(com.sellerops.review.triage.feedback.TriageBehaviorKind kind) {
        if (!aiTriage) {
            return false;
        }
        return switch (kind) {
            case AI_ATTENTION_SHOWN, REVIEW_OPENED -> true;
            case ORIGINAL_OPENED, MARKETPLACE_LOCATED -> originalLocate != OriginalLocate.NONE;
        };
    }

    /** Whether this channel can produce the given explicit act at all (contract §2.1–§2.2). */
    public boolean permits(com.sellerops.review.triage.feedback.TriageActionKind kind) {
        if (!aiTriage) {
            return false;
        }
        return switch (kind) {
            case ACTION_STARTED, ACTION_COMPLETED, ACTION_NOT_NEEDED -> true;
            case REPLY_DRAFTED, REPLY_SUBMITTED -> replySupported;
        };
    }
}
