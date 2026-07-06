package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.esmimport.EsmInquiryStatusClassifier.Verdict;
import org.junit.jupiter.api.Test;

/** The answered/unanswered status matrix, including contradiction/ambiguity rejection. */
class EsmInquiryStatusClassifierTest {

    @Test
    void unprocessedWithNoAnswerIsUnanswered() {
        Verdict v = EsmInquiryStatusClassifier.classify("미처리", false, false);
        assertThat(v.valid()).isTrue();
        assertThat(v.canonicalStatus()).isEqualTo("UNANSWERED");
    }

    @Test
    void inProgressWithNoAnswerIsUnanswered() {
        assertThat(EsmInquiryStatusClassifier.classify("처리중", false, false).canonicalStatus())
                .isEqualTo("UNANSWERED");
    }

    @Test
    void doneIsAnswered() {
        assertThat(EsmInquiryStatusClassifier.classify("처리완료", true, true).canonicalStatus())
                .isEqualTo("ANSWERED");
        assertThat(EsmInquiryStatusClassifier.classify("답변완료", false, false).canonicalStatus())
                .isEqualTo("ANSWERED");
    }

    @Test
    void unprocessedButWithAnswerContentIsContradictory() {
        Verdict v = EsmInquiryStatusClassifier.classify("미처리", true, false);
        assertThat(v.valid()).isFalse();
        assertThat(v.reason()).isEqualTo(EsmImportReasonCode.CONTRADICTORY_STATUS);
    }

    @Test
    void inProgressButWithProcessedTimeIsContradictory() {
        Verdict v = EsmInquiryStatusClassifier.classify("처리중", false, true);
        assertThat(v.valid()).isFalse();
        assertThat(v.reason()).isEqualTo(EsmImportReasonCode.CONTRADICTORY_STATUS);
    }

    @Test
    void blankStatusWithNoAnswerIsUnanswered() {
        assertThat(EsmInquiryStatusClassifier.classify("", false, false).canonicalStatus())
                .isEqualTo("UNANSWERED");
        assertThat(EsmInquiryStatusClassifier.classify(null, false, false).canonicalStatus())
                .isEqualTo("UNANSWERED");
    }

    @Test
    void unknownStatusWithAnswerEvidenceIsAmbiguous() {
        Verdict v = EsmInquiryStatusClassifier.classify("", false, true);
        assertThat(v.valid()).isFalse();
        assertThat(v.reason()).isEqualTo(EsmImportReasonCode.AMBIGUOUS_STATUS);

        Verdict v2 = EsmInquiryStatusClassifier.classify("웬 이상한 값", true, false);
        assertThat(v2.reason()).isEqualTo(EsmImportReasonCode.AMBIGUOUS_STATUS);
    }
}
