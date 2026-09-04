package com.sellerops.reviewissue;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Deterministic first implementation of {@link IssueSignatureExtractor}: split into opinion units,
 * then match each unit against the closed {@link IssueVocabulary}. No external call, no clock, no
 * randomness — the same body always yields the same units and the same signatures, which is what
 * makes re-extraction idempotent and 대표 고객 표현 re-derivable at read time.
 *
 * <p><b>What this is honestly not.</b> It is not a complaint detector, and nothing in the product
 * may describe it as one. {@code contracts/review-eval/naver/v1/RUBRIC.md} sets the bar a detector
 * must clear before it may put anything in front of an operator (precision ≥ 0.80 on a Wilson lower
 * bound, recall ≥ 0.30, high-rating false positives ≤ 0.05, no regression in the existing queue) and
 * the label seed is still empty, so this extractor's accuracy is <b>unmeasured</b>. It feeds issue
 * aggregation and nothing else; {@code ReviewIssueQueueIsolationTest} pins that it cannot change who
 * is in the needs-a-look queue.
 *
 * <p>Gated on {@code sellerops.reviewissue.extractor.provider}, following the precedent of
 * {@code RuleBasedReviewReplyProvider}: selecting a provider that does not exist stops the boot
 * loudly instead of being quietly reinterpreted as this one.
 */
@Component
@ConditionalOnProperty(name = "sellerops.reviewissue.extractor.provider", havingValue = "rule_based",
        matchIfMissing = true)
public class RuleBasedIssueSignatureExtractor implements IssueSignatureExtractor {

    static final String KIND = "RULE_BASED";
    /**
     * v2 (Issue Evidence Trust Closure v1, 2026-09-04): a keyword inside its own negation is no longer a
     * hit — see {@link NegationScope}. The signature keys are unchanged, so v1 issues keep their
     * identity; what changes is which units are evidence, and a full re-extraction re-derives that.
     */
    static final String VERSION = "issue-rules-v2";

    /**
     * Whether a problem found without any aspect may borrow the aspect of an earlier unit in the
     * same review. Off by default: "택배가 왔는데 불량이에요" would resolve correctly, but
     * "설치는 쉬웠는데 불량이에요" would attribute the defect to 설치, which is a fabricated
     * attribution. Left as a flag rather than deleted so the choice is visible and testable.
     */
    private final boolean inheritAspectAcrossUnits;

    public RuleBasedIssueSignatureExtractor(
            @Value("${sellerops.reviewissue.extractor.inherit-aspect:false}")
            boolean inheritAspectAcrossUnits) {
        this.inheritAspectAcrossUnits = inheritAspectAcrossUnits;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public String version() {
        return VERSION;
    }

    @Override
    public List<ExtractedUnit> extract(String body) {
        List<String> units = OpinionUnitSplitter.split(body);
        List<ExtractedUnit> out = new ArrayList<>(units.size());
        String carriedAspect = null;

        for (int ordinal = 0; ordinal < units.size(); ordinal++) {
            String unit = units.get(ordinal);
            List<IssueVocabulary.Hit> problemHits = IssueVocabulary.problemHits(unit);
            List<IssueVocabulary.Hit> aspectHits = IssueVocabulary.aspectHits(unit);
            if (!problemHits.isEmpty() && NegationScope.aboutAnotherProduct(unit)) {
                // 「타사 제품은 금방 떨어졌는데」 — a complaint, and not about this product.
                out.add(ExtractedUnit.unknown(ordinal, UnknownReason.OTHER_PRODUCT));
                continue;
            }
            Optional<String> problem = affirmedProblem(unit, problemHits);
            Optional<String> aspect = affirmedAspect(unit, aspectHits, problemHits);

            if (aspect.isPresent()) {
                carriedAspect = aspect.get();
            }

            if (aspect.isPresent() && problem.isPresent()) {
                out.add(ExtractedUnit.matched(ordinal, IssueSignature.of(aspect.get(), problem.get())));
            } else if (problem.isPresent() && inheritAspectAcrossUnits && carriedAspect != null) {
                out.add(ExtractedUnit.matched(ordinal, IssueSignature.of(carriedAspect, problem.get())));
            } else if (problem.isPresent()) {
                // A real complaint we cannot attribute. Recorded as such rather than guessed at.
                out.add(ExtractedUnit.unknown(ordinal, UnknownReason.NO_ASPECT));
            } else if (!problemHits.isEmpty()) {
                // A problem word was there and every occurrence was negated: 「파손없이 잘 도착했네요」.
                // Its own reason, so the pen can show what the negation rule decided.
                out.add(ExtractedUnit.unknown(ordinal, UnknownReason.NEGATED_PROBLEM));
            } else if (!aspectHits.isEmpty()) {
                // Includes all praise about a known aspect ("설치가 간편해요"). 반복 칭찬 is a separate
                // axis and is NOT in this package — a praise vocabulary would carry the same
                // measurement problem and needs its own bar.
                out.add(ExtractedUnit.unknown(ordinal, UnknownReason.NO_PROBLEM));
            } else {
                out.add(ExtractedUnit.unknown(ordinal, UnknownReason.NO_SIGNATURE));
            }
        }
        return List.copyOf(out);
    }

    /**
     * The first problem hit the customer actually asserts. A hit spelled as a denial (「안 왔」, 「없어서」)
     * is always asserted; any other hit is dropped when {@link NegationScope} finds a marker attached
     * to it. Detection order is the vocabulary's, so the first surviving hit is the one v1 would have
     * chosen whenever v1's choice was not negated.
     */
    private static Optional<String> affirmedProblem(String unit, List<IssueVocabulary.Hit> hits) {
        for (IssueVocabulary.Hit hit : hits) {
            String keyword = unit.substring(hit.start(), hit.end());
            if (NegationScope.isNegativeForm(keyword)
                    || !NegationScope.negated(unit, hit.start(), hit.end(), false)) {
                return Optional.of(hit.key());
            }
        }
        return Optional.empty();
    }

    /**
     * The first aspect hit the unit is actually about. 「미설치라」 and 「설치를 안 해봐서」 are not about
     * installing — the customer has not installed. But 「배송이 안 왔어요」 IS about delivery: the 안 there
     * belongs to the problem keyword 「안 왔」, so a marker that sits inside a problem hit does not
     * negate the aspect.
     */
    private static Optional<String> affirmedAspect(String unit, List<IssueVocabulary.Hit> aspects,
                                                   List<IssueVocabulary.Hit> problems) {
        for (IssueVocabulary.Hit hit : aspects) {
            if (NegationScope.negatedBefore(unit, hit.start(), true)) {
                continue;
            }
            int marker = NegationScope.negatedAfter(unit, hit.end());
            if (marker >= 0 && !insideAnyHit(marker, problems)) {
                continue;
            }
            return Optional.of(hit.key());
        }
        return Optional.empty();
    }

    private static boolean insideAnyHit(int position, List<IssueVocabulary.Hit> hits) {
        for (IssueVocabulary.Hit hit : hits) {
            if (position >= hit.start() && position < hit.end()) {
                return true;
            }
        }
        return false;
    }
}
