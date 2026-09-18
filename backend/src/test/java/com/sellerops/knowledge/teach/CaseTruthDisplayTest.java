package com.sellerops.knowledge.teach;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.knowledge.teach.dto.CaseDetailView;
import com.sellerops.operationscase.CaseDecider;
import com.sellerops.operationscase.CaseReason;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.review.media.ReviewMedia;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two M3 case-screen defects (Customer Ops Demo Closure v1): the photos a vision model looked at belong in
 * 「Reviewnary가 확인한 것」, and a rule's conclusion sentence must not outlive a later decision.
 */
class CaseTruthDisplayTest {

    @Test
    @DisplayName("once the agent decides, the rule's «지켜봅니다» gives way to the fact behind the case")
    void theLatestDecisionOwnsTheSentence() {
        OperationsCase c = new OperationsCase();
        c.setReason(CaseReason.REVIEW_HIGH_RATING_WITH_TEXT);
        c.setReasonNote(CaseReason.REVIEW_HIGH_RATING_WITH_TEXT.noteKo());
        c.setDecidedBy(CaseDecider.RULE);
        assertThat(CaseReason.noteFor(c)).contains("지켜봅니다");

        c.setDecidedBy(CaseDecider.AGENT);
        assertThat(CaseReason.noteFor(c)).isEqualTo("별점이 높고 글이 있는 새 리뷰입니다.").doesNotContain("지켜봅니다");
        for (CaseReason reason : CaseReason.values()) {
            assertThat(reason.factKo()).as("%s", reason)
                    .doesNotContain("지켜봅니다").doesNotContain("따로 할 일이 없습니다").isNotBlank();
        }
    }

    @Test
    @DisplayName("looked-at photos are listed; photos nobody looked at are listed as such, never as looked at")
    void photosLookedAt() {
        ReviewMedia seen = new ReviewMedia();
        seen.setInspectionStatus(ReviewMedia.InspectionStatus.INSPECTED);
        ReviewMedia notSeen = new ReviewMedia();
        notSeen.setInspectionStatus(ReviewMedia.InspectionStatus.NOT_INSPECTED);

        assertThat(CaseKnowledgeService.photoLines(List.of(seen, seen)))
                .containsExactly(new CaseDetailView.Investigated("고객이 올린 사진", 2));
        assertThat(CaseKnowledgeService.photoLines(List.of(seen, notSeen))).containsExactly(
                new CaseDetailView.Investigated("고객이 올린 사진", 1),
                new CaseDetailView.Investigated("보지 못한 사진", 1));
        assertThat(CaseKnowledgeService.photoLines(List.of())).isEmpty();
    }
}
