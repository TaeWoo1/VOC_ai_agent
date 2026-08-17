package com.sellerops.review.triage.llm;

import com.sellerops.review.triage.llm.ReviewTriageClassifier.Input;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Result;

/**
 * The channel boundary, as a thing a caller cannot go around.
 *
 * <p>RUBRIC v2 §8.3 permits production LLM transmission for <b>NAVER review triage and nothing
 * else</b>, and forbids any Coupang review under any circumstances —
 * {@code docs/coupang_review_policy_gate_v1.md}'s D-limits are untouched by that section and are
 * not this unit's to move.
 *
 * <p>§8.4 requires the check sit at the boundary rather than in a caller's memory. So this is the
 * only way to reach a {@link ReviewTriageClassifier} from anything holding a review: the classifier
 * itself takes no channel and therefore cannot check one, and every path that has a channel comes
 * through here.
 *
 * <p><b>A refused channel is {@code UNCLASSIFIED}, not an exception and not a tier.</b> A thrown
 * exception would tempt a caller into a catch block with a default in it, and the default that
 * suggests itself is {@code FYI} — which §8.5 forbids for exactly this reason. Refusal is a state
 * the evaluation counts, so a run that quietly stopped classifying a channel says so.
 */
public final class NaverOnlyClassifierGate {

    /** The only channel §8.3 opens. Compared exactly; there is no normalisation to be lenient with. */
    public static final String PERMITTED_CHANNEL = "NAVER";

    private final ReviewTriageClassifier classifier;

    public NaverOnlyClassifierGate(ReviewTriageClassifier classifier) {
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
    public static NaverOnlyClassifierGate forApi(ApiTriageClassifier.Vendor vendor, String modelId,
                                                 String apiKey, ApiTriageClassifier.Tuning tuning) {
        return new NaverOnlyClassifierGate(
                new ApiTriageClassifier(new JdkLlmHttpClient(), vendor, modelId, apiKey, tuning));
    }

    public Result classify(String channelCode, Integer rating, String body) {
        if (!PERMITTED_CHANNEL.equals(channelCode)) {
            // The refusal names the channel, which is SellerOps' own vocabulary and carries nothing
            // about the review or the seller.
            return Result.unclassified(classifier.version(),
                    "channel not permitted by RUBRIC v2 §8.3: " + channelCode);
        }
        return classifier.classify(new Input(rating, body));
    }

    public String version() {
        return classifier.version();
    }
}
