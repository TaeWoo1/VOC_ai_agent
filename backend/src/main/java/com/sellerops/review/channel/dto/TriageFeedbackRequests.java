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
     * The seller's binary answer to the product question — 확인 필요, or not.
     *
     * @param needsAttention true = 확인 필요; false = 필요 없음. There is no WATCH/FYI choice here on
     *                       purpose: that split is the rule's and the pilot does not own it.
     * @param reasonCode     an optional §3.1 code saying why, from the closed list, or null.
     */
    public record Correction(Boolean needsAttention, String reasonCode) {
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

    /** What the seller's correction now says for this review, echoed back so the UI can render it. */
    public record CorrectionView(UUID reviewId, boolean needsAttention, String reasonCode, String shownSource) {
    }

    private TriageFeedbackRequests() {
    }
}
