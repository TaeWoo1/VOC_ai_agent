package com.sellerops.review.triage.llm;

import com.sellerops.review.triage.ReviewTriageTier;
import java.util.List;

/**
 * Port for classifying one review's triage tier with a model.
 *
 * <p>The same shape as {@code InboxItemAnalyzer}, and for the reason that port already states: the
 * vendor behind it is an adapter change, not a rewrite. Here that is load-bearing rather than
 * tidy — which vendor SellerOps sends review text to is an open product-owner decision
 * ({@code docs/slices/llm-triage-classifier-v1.md} §7), and the port is what keeps the decision from
 * being made implicitly by whichever client got written first.
 *
 * <p><b>This produces a stored prediction, not a tier the product shows.</b>
 * {@code contracts/review-eval/naver/v1/RUBRIC.md} §5 is a pre-committed go/no-go: a text-derived
 * detector may be built but may not reach an operator until it clears precision (Wilson 95% lower
 * bound) ≥ 0.80, recall ≥ 0.30 and ≤ 0.05 false positives on 4–5★ rows. Nothing has cleared it and
 * the holdout is unread, so {@code ReviewTriageRules} still owns every tier a seller sees.
 */
public interface ReviewTriageClassifier {

    Result classify(Input input);

    /**
     * The version stamped onto every {@link Result}, askable WITHOUT classifying anything — same
     * contract as {@code InboxItemAnalyzer.version()}, so "is this stored prediction stale?" can be
     * answered without spending a model call on every row to find out.
     *
     * <p>It names <b>all four</b> of model id, system prompt, rubric text and output schema
     * together (RUBRIC v2 §8.6). Changing any one of them is a new version, because a result whose
     * prompt was edited underneath it is not reproducible.
     */
    String version();

    /**
     * Everything that may be sent, and there is nowhere to put anything else.
     *
     * <p>RUBRIC v2 §8.3 floors the payload at the star rating and the review body; §8.4 requires
     * that be a mechanism rather than an instruction. This record is the first of the three: a
     * caller cannot pass a product, a date, a seller or a review id by mistake or by conviction,
     * because the type has no room for one.
     *
     * <p>Do not add a field here to improve a number. That is the exact move §8.3 forbids —
     * "whether or not a model would classify better with it".
     */
    record Input(Integer rating, String body) {
    }

    /**
     * What came back, or why nothing did.
     *
     * <p>{@code tier} and the rest are null on any status other than {@link Status#OK}. There is
     * deliberately no {@code FYI} default: RUBRIC v2 §8.5 forbids it, because {@code FYI} means
     * "nothing here for the seller" and a timeout that produced it would be a silent dismissal of a
     * real review, indistinguishable from a considered judgment.
     */
    record Result(
            Status status,
            ReviewTriageTier tier,
            String reasonCode,
            List<String> tags,
            TriageSuggestedAction suggestedNextAction,
            String classifierVersion,
            /** Why it failed, in words that name no review content. Null when {@code OK}. */
            String failureReason) {

        public static Result ok(ReviewTriageTier tier, String reasonCode, List<String> tags,
                                TriageSuggestedAction action, String version) {
            return new Result(Status.OK, tier, reasonCode, List.copyOf(tags), action, version, null);
        }

        public static Result failed(String version, String reason) {
            return new Result(Status.CLASSIFICATION_FAILED, null, null, List.of(), null, version, reason);
        }

        public static Result unclassified(String version, String reason) {
            return new Result(Status.UNCLASSIFIED, null, null, List.of(), null, version, reason);
        }
    }

    /** RUBRIC v2 §8.5's states. Both failures are visible; neither is a tier. */
    enum Status {
        OK,
        /** Transport error, non-2xx, timeout, or the retry budget is spent. */
        CLASSIFICATION_FAILED,
        /** Never called, or the model returned something the output schema rejects. */
        UNCLASSIFIED
    }
}
