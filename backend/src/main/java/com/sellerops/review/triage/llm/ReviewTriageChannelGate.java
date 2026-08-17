package com.sellerops.review.triage.llm;

import com.sellerops.review.triage.ReviewTriageChannelCapability;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Input;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Result;

/**
 * The channel boundary, as a thing a caller cannot go around.
 *
 * <p>RUBRIC v2 §8.3 opened production LLM transmission for NAVER review triage; §8.3.1 (product-owner
 * decision, 2026-08-17) widened it to the three channels of
 * {@code contracts/review-triage-events/v1/CONTRACT.md} §1 — NAVER, Cafe24, Coupang — for the §13.7
 * pilot's additive suggestion and nothing else. The Coupang half of that decision is
 * {@code docs/coupang_review_policy_gate_v1.md} §6.1.2 (D6 amended); every other D-limit stands.
 * <i>This class was {@code NaverOnlyClassifierGate} until that amendment; the rename is the point —
 * a class named for one channel that admitted three would be a comment that lies.</i>
 *
 * <p>§8.4 requires the check sit at the boundary rather than in a caller's memory. So this is the
 * only way to reach a {@link ReviewTriageClassifier} from anything holding a review: the classifier
 * itself takes no channel and therefore cannot check one, and every path that has a channel comes
 * through here. The list of permitted channels is not this class's either — it reads
 * {@link ReviewTriageChannelCapability}, the one place the table is stated.
 *
 * <p><b>A refused channel is {@code UNCLASSIFIED}, not an exception and not a tier.</b> A thrown
 * exception would tempt a caller into a catch block with a default in it, and the default that
 * suggests itself is {@code FYI} — which §8.5 forbids for exactly this reason. Refusal is a state
 * the evaluation counts, so a run that quietly stopped classifying a channel says so.
 */
public final class ReviewTriageChannelGate {

    private final ReviewTriageClassifier classifier;

    public ReviewTriageChannelGate(ReviewTriageClassifier classifier) {
        this.classifier = classifier;
    }

    /**
     * The production constructor: a gate around an {@link ApiTriageClassifier}, built HERE.
     *
     * <p>{@code ClassifierBoundaryTest} asserts that nothing in {@code main} other than this file and
     * the classifier's own constructs an {@link ApiTriageClassifier}. That is what makes the channel
     * check unavoidable — a service holding the classifier directly would be a check nobody runs. So
     * the pilot service asks this file for a gate rather than assembling one, and the transport, the
     * vendor and the tuning are fixed at the same moment as the boundary.
     */
    public static ReviewTriageChannelGate forApi(ApiTriageClassifier.Vendor vendor, String modelId,
                                                 String apiKey, ApiTriageClassifier.Tuning tuning) {
        return new ReviewTriageChannelGate(
                new ApiTriageClassifier(new JdkLlmHttpClient(), vendor, modelId, apiKey, tuning));
    }

    /** Whether the boundary would pass a review from this channel to the transport. */
    public static boolean permits(String channelCode) {
        return ReviewTriageChannelCapability.of(channelCode).aiTriage();
    }

    public Result classify(String channelCode, Integer rating, String body) {
        if (!permits(channelCode)) {
            // The refusal names the channel, which is SellerOps' own vocabulary and carries nothing
            // about the review or the seller.
            return Result.unclassified(classifier.version(),
                    "channel not permitted by RUBRIC v2 §8.3/§8.3.1: " + channelCode);
        }
        return classifier.classify(new Input(rating, body));
    }

    public String version() {
        return classifier.version();
    }
}
