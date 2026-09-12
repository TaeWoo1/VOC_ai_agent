package com.sellerops.review.channel.dto;

import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageBehaviorKind;
import com.sellerops.review.triage.feedback.TriageEventKind;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * What a seller can say about a review's triage, in three shapes of increasing weakness.
 *
 * <p>All three are closed vocabularies and none carries free text — the reasoning is
 * {@code TriageCorrection}'s: a note here would be customer-adjacent prose in a table the evaluation
 * harness reads.
 *
 * <p>Nothing here asserts what the seller was SHOWN. The service computes that from the store
 * (feedback draft §7.3, {@code TriageFeedbackService.shown}); a client that could assert "I was
 * shown AI" could write feedback against a mechanism that never spoke.
 */
public final class TriageFeedbackRequests {

    /**
     * The seller's answer to the product question — one of the three tiers they are shown.
     *
     * <p><b>Three, since 2026-09-11.</b> This was a boolean, and 필요 없음 was stored as whatever the
     * RULE would have said for that row, so a seller who meant 참고 had 지켜보기 recorded under their
     * name. The note this replaces read "there is no WATCH/FYI choice here on purpose: that split is
     * the rule's and the pilot does not own it" — sound about the PILOT, whose mark is additive and
     * binary by construction, and wrong about the SELLER, who owns the whole vocabulary they are
     * shown. Product-owner decision; the reversal is recorded in {@code V99__seller_triage_correction.sql}.
     *
     * @param tier       {@code NEEDS_ATTENTION} | {@code WATCH} | {@code FYI}. Parsed, not bound, so an
     *                   unknown value gets a sentence rather than a deserialization error.
     * @param reasonCode an optional §3.1 code saying why, from the closed list, or null.
     */
    public record Correction(String tier, String reasonCode) {
    }

    /** One explicit act — started, completed, or declared not needed. */
    public record Action(TriageActionKind kind) {
    }

    /**
     * Silver, batched: several rows' worth of behaviour in one request, because {@code AI_ATTENTION_SHOWN}
     * fires once per rendered row. Capped by the controller so a client cannot write a table.
     */
    public record Behavior(List<Event> events) {
        public record Event(UUID reviewId, TriageBehaviorKind kind) {
        }
    }

    /** What one behaviour batch did — a count and nothing else. */
    public record BehaviorResult(int recorded) {
    }

    /**
     * One recorded event, in the contract's vocabulary. {@code shownSource} says which mechanism was
     * on screen when it happened; {@code at} is when. No content, no actor, no weight.
     */
    public record EventView(TriageEventKind kind, String shownSource, String shownTier, Instant at) {
    }

    /**
     * The seller's standing correction for one review — echoed back on write AND carried on every
     * read of the review, which is the whole point: before this, a correction lived in one React
     * state variable and a refresh erased it from the screen while leaving it in the database.
     *
     * <p><b>Both judgments, side by side, and neither replaces the other.</b> {@code correctedTier}
     * is what the seller said; {@code systemTier}/{@code systemSource} are what the system was saying
     * when they said it, frozen on the row. The CURRENT system judgment is on the review itself
     * ({@code triage.tier} plus {@code aiMark}) and is recomputed at read time as it always was —
     * nothing here overwrites it, and no queue is re-ranked by it.
     *
     * @param changeCount how many times the seller has set or withdrawn this correction — the trail's
     *                    length, so the surface can say "수정됨" without a second request.
     */
    public record CorrectionView(UUID reviewId, String correctedTier, String reasonCode,
                                 String systemTier, String systemSource, Instant correctedAt,
                                 int changeCount) {
    }

    /** One entry in a review's correction trail. Closed vocabulary; no actor name, no prose. */
    public record CorrectionHistoryView(String kind, String tierFrom, String tierTo,
                                        String systemTier, String systemSource, Instant at) {
    }

    private TriageFeedbackRequests() {
    }
}
