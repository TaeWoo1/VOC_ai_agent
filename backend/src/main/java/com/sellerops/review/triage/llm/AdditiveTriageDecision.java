package com.sellerops.review.triage.llm;

import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;

/**
 * The false-negative safety floor: a model may add {@code NEEDS_ATTENTION}, never take it away.
 *
 * <pre>
 *   final NEEDS_ATTENTION  =  rules-v1 NEEDS_ATTENTION  OR  candidate NEEDS_ATTENTION
 * </pre>
 *
 * <p><b>Why this is code and not a sentence in a prompt.</b> The first gpt-5 candidate demoted two
 * reviews the rating alone already caught — a 2★ and a 1★, both with text, both of which the human
 * labelers also called 확인 필요 — which fails
 * {@code contracts/review-eval/naver/v2/RUBRIC.md} §6.3 condition 4 ("a detector may only ADD",
 * carried verbatim from `v1` §5). A prompt instruction not to do that would be a request, checked by
 * nobody, re-litigated by every future prompt edit, and silently broken by the next model. An
 * invariant is checked by the type system and by an exhaustive test.
 *
 * <p><b>This is not a retreat to the rule.</b> The rule keeps only what it already had — six reviews
 * on the `DEV` half — and the model is free to promote anything else. What the floor removes is the
 * one direction that loses a review a seller was already being shown.
 *
 * <p><b>A failed classification lands on the baseline, not on {@code FYI}.</b> §8.5 forbids an
 * {@code FYI} fallback because it would silently dismiss a real review; the same reasoning says an
 * outage must degrade to {@code rules-v1}, which is what the product shows today, rather than to
 * nothing. So an API outage makes this classifier exactly as good as the rule and no worse — that is
 * the meaning of "floor".
 *
 * <p><b>What it deliberately does NOT constrain.</b> {@code WATCH} → {@code FYI}. Both are
 * {@code NO_ACTION} in the partition every gate is written against (§2), and §2 states that a
 * {@code WATCH}/{@code FYI} confusion is a product-quality finding rather than a go/no-go one.
 * Freezing that direction too would pin the model to the rule's 3★ handling, which is one of the
 * things the model is here to improve on.
 */
public final class AdditiveTriageDecision {

    /** Bumped when this function changes, because it is part of the candidate's identity (§8.6). */
    public static final String GUARD_VERSION = "additive-guard/v1";

    /**
     * @param candidate the model's tier, or {@code null} when it produced none
     */
    public static ReviewTriageTier decide(ReviewTriageTier baseline, ReviewTriageTier candidate) {
        if (baseline == ReviewTriageTier.NEEDS_ATTENTION) {
            return ReviewTriageTier.NEEDS_ATTENTION;
        }
        return candidate == null ? baseline : candidate;
    }

    /** The same decision from what the two deciders are actually given. */
    public static ReviewTriageTier decide(Integer rating, String body, ReviewTriageTier candidate) {
        return decide(ReviewTriageRules.tier(rating, body), candidate);
    }

    private AdditiveTriageDecision() {
    }
}
