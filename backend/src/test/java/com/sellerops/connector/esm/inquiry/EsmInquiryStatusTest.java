package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EsmInquiryStatusTest {

    @Test
    void mapsProcessedLabelsToAnswered() {
        for (String raw : new String[] {"처리완료", "답변완료", "완료", "answered", "DONE", "completed"}) {
            assertThat(EsmInquiryStatus.from(raw)).isEqualTo(EsmInquiryStatus.PROCESSED);
            assertThat(EsmInquiryStatus.from(raw).toCanonicalStatus()).isEqualTo("ANSWERED");
        }
    }

    @Test
    void mapsInProgressToUnansweredBecauseItStillNeedsAction() {
        for (String raw : new String[] {"처리중", "진행중", "in_progress", "pending"}) {
            assertThat(EsmInquiryStatus.from(raw)).isEqualTo(EsmInquiryStatus.IN_PROGRESS);
            assertThat(EsmInquiryStatus.from(raw).toCanonicalStatus()).isEqualTo("UNANSWERED");
        }
    }

    @Test
    void mapsUnprocessedLabelsToUnanswered() {
        for (String raw : new String[] {"미처리", "미답변", "unanswered", "NEW", "open"}) {
            assertThat(EsmInquiryStatus.from(raw)).isEqualTo(EsmInquiryStatus.UNPROCESSED);
            assertThat(EsmInquiryStatus.from(raw).toCanonicalStatus()).isEqualTo("UNANSWERED");
        }
    }

    @Test
    void unknownOrBlankNeverThrowsAndFailsTowardUnanswered() {
        for (String raw : new String[] {null, "", "   ", "??", "무슨상태"}) {
            assertThat(EsmInquiryStatus.from(raw)).isEqualTo(EsmInquiryStatus.UNKNOWN);
            assertThat(EsmInquiryStatus.from(raw).toCanonicalStatus()).isEqualTo("UNANSWERED");
        }
    }
}
