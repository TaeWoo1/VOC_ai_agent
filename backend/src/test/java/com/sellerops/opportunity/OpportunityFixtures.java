package com.sellerops.opportunity;

import com.sellerops.reviewissue.dto.IssueChangeView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class OpportunityFixtures {

    static final UUID PRODUCT = UUID.fromString("00000000-0000-0000-0000-00000000aa01");

    private OpportunityFixtures() {
    }

    static ReviewIssueView issue(String aspect, String problem, long evidence, UUID productId) {
        return issue(UUID.randomUUID(), aspect, problem, evidence, productId, "NEEDS_REVIEW", false);
    }

    static ReviewIssueView issue(UUID id, String aspect, String problem, long evidence, UUID productId,
                                 String lifecycle, boolean dismissed) {
        return new ReviewIssueView(id, aspect + " " + problem, aspect, problem, "NORMAL", lifecycle, "확인 필요",
                evidence, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 9, 1),
                productId, productId == null ? null : "선바로 일체형 전선몰딩", dismissed, "RULE_BASED",
                new IssueChangeView(List.of("INCREASING"), List.of("증가 중"), false, 4, 1.0));
    }
}
