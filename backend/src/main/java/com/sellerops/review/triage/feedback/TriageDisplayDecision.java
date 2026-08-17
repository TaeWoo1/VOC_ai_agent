package com.sellerops.review.triage.feedback;

import com.sellerops.review.triage.ReviewTriageTier;
import java.util.UUID;

/**
 * What the seller is shown for one review — resolved in ONE place, from the same three facts,
 * whether the caller is rendering the list or stamping an event
 * ({@code contracts/review-triage-events/v1/CONTRACT.md} §3, "display decision").
 *
 * <p>The three facts: the rating rule's own tier; the pilot's current additive row, if any; and
 * whether the pilot surface is ON for the org (decided server-side from configuration, never asserted
 * by a client). {@code AI} exactly when the surface is on, the row says {@code aiAttention}, and the
 * rule did NOT already say 확인 필요 — miss any one and the seller saw the rules chip alone.
 *
 * <p><b>Why a separate class.</b> Before this the read path ({@code ChannelReviewService.marksOf})
 * and the write path ({@code TriageFeedbackService.shown}) each expressed the predicate; they agreed,
 * and an integration test said so, but two expressions that currently agree are how a display
 * decision and a stored {@code shownSource} drift apart. When a seller-policy layer arrives it adds a
 * third source HERE and nowhere else, and the model's prediction row is not consulted for it.
 *
 * <p>The prediction id is carried where one exists whatever the source, because the history is still
 * the history — an event on a {@code RULES}-shown row still says which prediction was current.
 */
public record TriageDisplayDecision(UUID predictionId, ReviewTriageTier tier, TriageShownSource source) {

    public static TriageDisplayDecision resolve(ReviewTriageTier ruleTier, AiTriageCurrent row, boolean aiSurfaceOn) {
        UUID predictionId = row == null ? null : row.getPredictionId();
        boolean aiShown = aiSurfaceOn && row != null && row.isAiAttention()
                && ruleTier != ReviewTriageTier.NEEDS_ATTENTION;
        return aiShown
                ? new TriageDisplayDecision(predictionId, ReviewTriageTier.NEEDS_ATTENTION, TriageShownSource.AI)
                : new TriageDisplayDecision(predictionId, ruleTier, TriageShownSource.RULES);
    }

    /** True when the seller sees the pilot's mark on this row — the read path's one question. */
    public boolean aiShown() {
        return source == TriageShownSource.AI;
    }
}
