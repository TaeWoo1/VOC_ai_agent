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
    static final String VERSION = "issue-rules-v1";

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
            Optional<String> aspect = IssueVocabulary.aspectOf(unit);
            Optional<String> problem = IssueVocabulary.problemOf(unit);

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
            } else if (aspect.isPresent()) {
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
}
