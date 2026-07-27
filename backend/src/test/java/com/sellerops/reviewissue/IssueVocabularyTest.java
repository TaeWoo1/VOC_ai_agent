package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class IssueVocabularyTest {

    /**
     * Every problem must have a severity. Without this, adding a problem keyword would produce issues
     * whose severity lookup throws at extraction time — on real data, in a transaction.
     */
    @Test
    void everyProblemHasASeverity() {
        for (String problem : IssueVocabulary.problems()) {
            assertThat(IssueVocabulary.severityOf(problem)).isNotNull();
        }
    }

    /**
     * Severity fails closed rather than defaulting. A silent NORMAL default would let a vocabulary
     * edit downgrade 파손 with nothing failing, and severity is what an operator triages on.
     */
    @Test
    void anUnknownProblemHasNoSeverityRatherThanADefault() {
        assertThatThrownBy(() -> IssueVocabulary.severityOf("존재하지않는문제"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /** HIGH means the customer did not receive a usable product — not "the customer was annoyed". */
    @Test
    void highSeverityIsReservedForAnUnusableOrAbsentProduct() {
        assertThat(IssueVocabulary.severityOf("파손")).isEqualTo(IssueSeverity.HIGH);
        assertThat(IssueVocabulary.severityOf("결함")).isEqualTo(IssueSeverity.HIGH);
        assertThat(IssueVocabulary.severityOf("누락")).isEqualTo(IssueSeverity.HIGH);
        assertThat(IssueVocabulary.severityOf("지연")).isEqualTo(IssueSeverity.NORMAL);
        assertThat(IssueVocabulary.severityOf("난이도")).isEqualTo(IssueSeverity.LOW);
    }

    @Test
    void blankInputMatchesNothing() {
        assertThat(IssueVocabulary.aspectOf(null)).isEmpty();
        assertThat(IssueVocabulary.aspectOf("  ")).isEmpty();
        assertThat(IssueVocabulary.problemOf(null)).isEmpty();
        assertThat(IssueVocabulary.problemOf("")).isEmpty();
    }

    @Test
    void aSignatureKeyIsReadableAndFitsItsColumn() {
        IssueSignature signature = IssueSignature.of("배송", "지연");
        assertThat(signature.signatureKey()).isEqualTo("배송:지연");
        assertThat(signature.titleKo()).isEqualTo("배송 지연");
        for (String aspect : IssueVocabulary.aspects()) {
            for (String problem : IssueVocabulary.problems()) {
                assertThat(IssueSignature.of(aspect, problem).signatureKey().length())
                        .isLessThanOrEqualTo(64);
                assertThat(IssueSignature.of(aspect, problem).titleKo().length())
                        .isLessThanOrEqualTo(120);
            }
        }
    }

    /** Severity can never disagree with the problem, because the factory derives it. */
    @Test
    void severityIsDerivedFromTheProblemNotSuppliedByTheCaller() {
        assertThat(IssueSignature.of("포장", "파손").severity()).isEqualTo(IssueSeverity.HIGH);
        assertThat(IssueSignature.of("설치", "난이도").severity()).isEqualTo(IssueSeverity.LOW);
    }
}
