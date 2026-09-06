package com.sellerops.report;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class ReportFixtures {

    static final UUID ISSUE = UUID.fromString("11111111-1111-4111-8111-111111111111");
    static final UUID PRODUCT = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final ReportPeriod PERIOD = ReportPeriod.startingAt(ReportKind.WEEKLY, LocalDate.of(2026, 8, 24));

    private ReportFixtures() {
    }

    static ReportFacts.Period period() {
        return new ReportFacts.Period("WEEKLY", "주간", PERIOD.start(), PERIOD.end(), PERIOD.labelKo(),
                PERIOD.previousStart(), PERIOD.previousEnd());
    }

    static ReportFacts.Counter counter(String id, String label, long now, Long prev) {
        return new ReportFacts.Counter(id, label, true, now, prev, prev == null ? null : now - prev, null);
    }

    /** A week with movement: reviews up, one issue rising, one opportunity, five unanswered. */
    static ReportFacts busy() {
        return new ReportFacts(period(),
                List.of(counter("c-reviews", "받은 리뷰", 81, 65L),
                        counter("c-negative-reviews", "부정 리뷰", 3, 1L),
                        counter("c-inquiries", "받은 문의", 5, 1L),
                        counter("c-orders", "주문", 120, 120L),
                        new ReportFacts.Counter("c-unanswered-now", "현재 답변이 필요한 문의", false, 5, null, null,
                                "/inquiries?status=UNANSWERED")),
                List.of(new ReportFacts.IssueFact("i-" + ISSUE, ISSUE, "접착 부족", "NORMAL", "보통", 4, 1, 3,
                        List.of("증가 중"), PRODUCT, "선바로 몰딩", "/memory/" + ISSUE)),
                List.of(new ReportFacts.OpportunityFact("o-" + ISSUE + "-PRODUCT_GUIDE_SUPPLEMENT", ISSUE,
                        "PRODUCT_GUIDE_SUPPLEMENT", "상품 상세·안내 보완", "OPEN", "검토 전", "접착 부족", PRODUCT,
                        "선바로 몰딩", "'접착' 안내를 상세 페이지에 보완하는 것을 검토하세요", "상세페이지 안내문 초안 준비",
                        "/memory/" + ISSUE)),
                List.of(new ReportFacts.NextStep("n-1", "답변이 필요한 문의 보기", "/inquiries?status=UNANSWERED",
                        List.of("c-unanswered-now"))),
                Instant.parse("2026-09-04T03:00:00Z"));
    }

    /** A week with nothing: every figure zero, no issues, no opportunities. */
    static ReportFacts quiet() {
        return new ReportFacts(period(),
                List.of(counter("c-reviews", "받은 리뷰", 0, 0L),
                        counter("c-negative-reviews", "부정 리뷰", 0, 0L),
                        counter("c-inquiries", "받은 문의", 0, 0L),
                        counter("c-orders", "주문", 0, 0L),
                        new ReportFacts.Counter("c-unanswered-now", "현재 답변이 필요한 문의", false, 0, null, null, null)),
                List.of(), List.of(), List.of(), Instant.parse("2026-09-04T03:00:00Z"));
    }
}
