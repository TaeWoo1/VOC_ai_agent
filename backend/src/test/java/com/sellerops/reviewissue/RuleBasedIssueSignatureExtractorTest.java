package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.reviewissue.IssueSignatureExtractor.ExtractedUnit;
import java.util.List;
import org.junit.jupiter.api.Test;

class RuleBasedIssueSignatureExtractorTest {

    private final RuleBasedIssueSignatureExtractor extractor =
            new RuleBasedIssueSignatureExtractor(false);

    @Test
    void provenanceIsStatedSoALaterExtractorIsTellableApart() {
        assertThat(extractor.kind()).isEqualTo("RULE_BASED");
        assertThat(extractor.version()).isEqualTo("issue-rules-v1");
    }

    /**
     * The case the whole package exists for. The shipped analyzer derives sentiment from
     * {@code rating}, so this review at 5★ is invisible to the queue; here the complaining clause
     * produces a signature on its own, with no reference to the rating at all.
     */
    @Test
    void aComplainingClauseInsideAPositiveReviewProducesASignature() {
        List<ExtractedUnit> units = extractor.extract("예쁜데 배송이 너무 늦었어요");

        assertThat(units).hasSize(2);
        assertThat(units.get(0).isMatched()).isFalse();
        assertThat(units.get(1).isMatched()).isTrue();
        assertThat(units.get(1).signature().signatureKey()).isEqualTo("배송:지연");
        assertThat(units.get(1).ordinal()).isEqualTo(1);
    }

    @Test
    void oneReviewCanBeEvidenceForTwoDifferentIssues() {
        List<ExtractedUnit> matched = extractor.extract("포장이 찌그러져 왔어요. 설치도 너무 어려웠습니다")
                .stream().filter(ExtractedUnit::isMatched).toList();

        assertThat(matched).hasSize(2);
        assertThat(matched.stream().map(u -> u.signature().signatureKey()))
                .containsExactly("포장:파손", "설치:난이도");
    }

    @Test
    void aProblemWithNoAspectIsUnattributedRatherThanGuessedAt() {
        List<ExtractedUnit> units = extractor.extract("불량이에요");

        assertThat(units).hasSize(1);
        assertThat(units.get(0).isMatched()).isFalse();
        assertThat(units.get(0).unknownReason()).isEqualTo(UnknownReason.NO_ASPECT);
    }

    /** Praise about a known aspect is NO_PROBLEM, not an issue. 반복 칭찬 is not in this package. */
    @Test
    void praiseAboutAKnownAspectIsNotAnIssue() {
        List<ExtractedUnit> units = extractor.extract("설치가 정말 간편했어요");

        assertThat(units).hasSize(1);
        assertThat(units.get(0).isMatched()).isFalse();
        assertThat(units.get(0).unknownReason()).isEqualTo(UnknownReason.NO_PROBLEM);
    }

    @Test
    void textWithNeitherAnAspectNorAProblemIsNoSignature() {
        List<ExtractedUnit> units = extractor.extract("잘 쓰겠습니다");

        assertThat(units).hasSize(1);
        assertThat(units.get(0).unknownReason()).isEqualTo(UnknownReason.NO_SIGNATURE);
    }

    @Test
    void aBlankBodyYieldsNoUnitsRatherThanOneEmptyOne() {
        assertThat(extractor.extract(null)).isEmpty();
        assertThat(extractor.extract("   ")).isEmpty();
    }

    @Test
    void ordinalsAreDenseAndInReadingOrder() {
        List<ExtractedUnit> units = extractor.extract("배송이 늦었어요. 색상도 달라요. 그래도 쓸만해요");

        for (int i = 0; i < units.size(); i++) {
            assertThat(units.get(i).ordinal()).isEqualTo(i);
        }
    }

    @Test
    void extractionIsDeterministicSoStoredOrdinalsKeepMeaning() {
        String body = "포장이 깨져서 왔는데 설치는 쉬웠어요";
        assertThat(extractor.extract(body)).isEqualTo(extractor.extract(body));
    }

    /**
     * Aspect inheritance is off by default because it fabricates attributions:
     * "설치는 쉬웠는데 불량이에요" would blame 설치 for a defect the customer never tied to it.
     */
    @Test
    void aspectInheritanceIsOffByDefaultAndDoesNotInventAttributions() {
        List<ExtractedUnit> off = new RuleBasedIssueSignatureExtractor(false)
                .extract("설치는 쉬웠는데 불량이에요");
        assertThat(off.get(1).isMatched()).isFalse();
        assertThat(off.get(1).unknownReason()).isEqualTo(UnknownReason.NO_ASPECT);

        List<ExtractedUnit> on = new RuleBasedIssueSignatureExtractor(true)
                .extract("설치는 쉬웠는데 불량이에요");
        assertThat(on.get(1).isMatched()).isTrue();
        assertThat(on.get(1).signature().signatureKey()).isEqualTo("설치:결함");
    }

    /** A unit cannot be both attached to an issue and sitting in the UNKNOWN pen. */
    @Test
    void aUnitIsEitherMatchedOrUnknownNeverBoth() {
        assertThatThrownBy(() ->
                new ExtractedUnit(0, IssueSignature.of("배송", "지연"), UnknownReason.NO_ASPECT))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ExtractedUnit(0, null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
