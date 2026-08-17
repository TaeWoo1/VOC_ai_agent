package com.sellerops.review.triage.feedback;

import com.sellerops.review.triage.ReviewTriageTier;

/**
 * The closed event vocabulary of {@code contracts/review-triage-events/v1/CONTRACT.md} §2 — the
 * names a READER sees, over the three tables that store them.
 *
 * <p>The explicit binary answer is stored once (a correction row with what was shown) and read as
 * four names, because "the seller agreed with the AI" and "the seller agreed with the rating rule"
 * are evidence about two different mechanisms and must not be summed. Everything else maps 1:1 to a
 * stored kind. There is, by construction, no {@code IGNORED} here either.
 */
public enum TriageEventKind {
    AI_ATTENTION_SHOWN,
    REVIEW_OPENED,
    ORIGINAL_OPENED,
    MARKETPLACE_LOCATED,
    AI_AGREE,
    AI_DISAGREE,
    RULE_AGREE,
    RULE_DISAGREE,
    ACTION_STARTED,
    ACTION_COMPLETED,
    ACTION_NOT_NEEDED,
    REPLY_DRAFTED,
    REPLY_SUBMITTED;

    public static TriageEventKind of(TriageBehaviorKind kind) {
        return valueOf(kind.name());
    }

    public static TriageEventKind of(TriageActionKind kind) {
        return valueOf(kind.name());
    }

    /**
     * A correction read as an event: agree/disagree with whichever mechanism was on screen, on the
     * binary question — did the seller's 확인 필요 / 필요 없음 match what was SHOWN? An AI-shown row is
     * always shown as 확인 필요, so there "agree" is 확인 필요; a rules row may have been shown as
     * FYI, and 확인 필요 on it is a disagreement with the rule.
     */
    public static TriageEventKind of(TriageCorrection correction) {
        boolean shownAttention = correction.getShownTier() == ReviewTriageTier.NEEDS_ATTENTION;
        boolean saidAttention = correction.getCorrectedTier() == ReviewTriageTier.NEEDS_ATTENTION;
        boolean agree = shownAttention == saidAttention;
        boolean ai = correction.getShownSource() == TriageShownSource.AI;
        if (ai) {
            return agree ? AI_AGREE : AI_DISAGREE;
        }
        return agree ? RULE_AGREE : RULE_DISAGREE;
    }
}
