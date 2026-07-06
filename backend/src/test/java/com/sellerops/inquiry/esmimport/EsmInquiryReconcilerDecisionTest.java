package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import org.junit.jupiter.api.Test;

/** The pure overlap-reconciliation decision matrix (no DB). */
class EsmInquiryReconcilerDecisionTest {

    @Test
    void unansweredImportNeverChangesAnything() {
        assertThat(EsmInquiryReconciler.decide("UNANSWERED", InquiryWorkItemPhase.OPEN, "UNANSWERED"))
                .isEqualTo(EsmRowDisposition.UNCHANGED_DUPLICATE);
        assertThat(EsmInquiryReconciler.decide("ANSWERED", null, "UNANSWERED"))
                .isEqualTo(EsmRowDisposition.UNCHANGED_DUPLICATE);
    }

    @Test
    void answeredImportOnAlreadyAnsweredIsUnchanged() {
        assertThat(EsmInquiryReconciler.decide("ANSWERED", InquiryWorkItemPhase.COMPLETED, "ANSWERED"))
                .isEqualTo(EsmRowDisposition.UNCHANGED_DUPLICATE);
    }

    @Test
    void answeredImportOnOpenOrAbsentWorkItemReconciles() {
        assertThat(EsmInquiryReconciler.decide("UNANSWERED", InquiryWorkItemPhase.OPEN, "ANSWERED"))
                .isEqualTo(EsmRowDisposition.STATUS_UPDATE);
        assertThat(EsmInquiryReconciler.decide("UNANSWERED", null, "ANSWERED"))
                .isEqualTo(EsmRowDisposition.STATUS_UPDATE);
    }

    @Test
    void answeredImportNeverTouchesTerminalOrMidWorkflowWorkItems() {
        for (InquiryWorkItemPhase phase : new InquiryWorkItemPhase[]{
                InquiryWorkItemPhase.DISMISSED, InquiryWorkItemPhase.COMPLETED,
                InquiryWorkItemPhase.PROPOSED, InquiryWorkItemPhase.ACTION_PENDING,
                InquiryWorkItemPhase.EXECUTED}) {
            assertThat(EsmInquiryReconciler.decide("UNANSWERED", phase, "ANSWERED"))
                    .as("phase %s", phase)
                    .isEqualTo(EsmRowDisposition.UNCHANGED_DUPLICATE);
        }
    }
}
