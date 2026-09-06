package com.sellerops.report;

import com.sellerops.dashboard.metrics.OperationsMetricsRepository;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.opportunity.OpportunityService;
import com.sellerops.opportunity.dto.OpportunityView;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the facts of one completed period. Deterministic: the same database state and the same
 * period give the same {@link ReportFacts}, so a snapshot is a function of what the seller's data
 * said at the moment it was taken and nothing else.
 *
 * <p><b>Every number comes from a read that already exists.</b> Period counts use the Overview's
 * per-day series (KST calendar, REAL rows only — a report is the seller's own figures, never the demo
 * corpus); issue tallies use the evidence table windowed by date; the issue rows themselves are the
 * issue memory's own views; the opportunities are the Opportunity Engine's own derivation at the
 * period's end. Nothing is computed here that a screen could not also show.
 *
 * <p><b>Next steps are links to objects.</b> The report does not keep a to-do list; it points at the
 * inquiry queue, an issue's evidence page, or an opportunity that already carries its prepared action.
 */
@Service
public class ReportFactsBuilder {

    static final String COUNTER_REVIEWS = "c-reviews";
    static final String COUNTER_NEGATIVE_REVIEWS = "c-negative-reviews";
    static final String COUNTER_INQUIRIES = "c-inquiries";
    static final String COUNTER_ORDERS = "c-orders";
    static final String COUNTER_UNANSWERED_NOW = "c-unanswered-now";

    /** Where the queue the unanswered figure counts is shown — the same filter the home uses. */
    static final String UNANSWERED_PATH = "/inquiries?status=UNANSWERED";

    private static final Map<String, String> SEVERITY_KO = Map.of("HIGH", "심각", "NORMAL", "보통", "LOW", "경미");

    private final OperationsMetricsRepository metrics;
    private final InquiryRepository inquiries;
    private final ReviewIssueEvidenceRepository evidence;
    private final ReviewIssueQueryService issues;
    private final OpportunityService opportunities;

    public ReportFactsBuilder(OperationsMetricsRepository metrics, InquiryRepository inquiries,
                              ReviewIssueEvidenceRepository evidence, ReviewIssueQueryService issues,
                              OpportunityService opportunities) {
        this.metrics = metrics;
        this.inquiries = inquiries;
        this.evidence = evidence;
        this.issues = issues;
        this.opportunities = opportunities;
    }

    @Transactional(readOnly = true)
    public ReportFacts build(UUID orgId, ReportPeriod period, Instant now) {
        List<ReportFacts.Counter> counters = counters(orgId, period);
        List<ReportFacts.IssueFact> issueFacts = issueFacts(orgId, period);
        List<ReportFacts.OpportunityFact> opportunityFacts = opportunityFacts(orgId, period);
        List<ReportFacts.NextStep> nextSteps = nextSteps(counters, issueFacts, opportunityFacts);
        return new ReportFacts(
                new ReportFacts.Period(period.kind().name(), period.kind().labelKo(), period.start(), period.end(),
                        period.labelKo(), period.previousStart(), period.previousEnd()),
                counters, issueFacts, opportunityFacts, nextSteps, now);
    }

    private List<ReportFacts.Counter> counters(UUID orgId, ReportPeriod p) {
        Reading reviewsNow = reviewTotals(orgId, p.start(), p.end());
        Reading reviewsPrev = reviewTotals(orgId, p.previousStart(), p.previousEnd());
        Reading inquiriesNow = inquiryTotal(orgId, p.start(), p.end());
        Reading inquiriesPrev = inquiryTotal(orgId, p.previousStart(), p.previousEnd());
        Reading ordersNow = orderTotal(orgId, p.start(), p.end());
        Reading ordersPrev = orderTotal(orgId, p.previousStart(), p.previousEnd());
        long unansweredNow = inquiries.countUnansweredOperational(orgId);
        return List.of(
                periodic(COUNTER_REVIEWS, "받은 리뷰", reviewsNow.total, reviewsPrev),
                periodic(COUNTER_NEGATIVE_REVIEWS, "부정 리뷰", reviewsNow.second, reviewsPrev.withTotal(reviewsPrev.second)),
                periodic(COUNTER_INQUIRIES, "받은 문의", inquiriesNow.total, inquiriesPrev),
                periodic(COUNTER_ORDERS, "주문", ordersNow.total, ordersPrev),
                // No previous, no delta: this is what is waiting NOW, not a figure of the period.
                new ReportFacts.Counter(COUNTER_UNANSWERED_NOW, "현재 답변이 필요한 문의", false, unansweredNow, null,
                        null, unansweredNow > 0 ? UNANSWERED_PATH : null));
    }

    /**
     * A period figure. The previous window contributes a number only when it held rows at all —
     * an absent series is not a zero, so no delta is claimed against it.
     */
    private static ReportFacts.Counter periodic(String id, String label, long now, Reading previous) {
        Long prev = previous.hasRows ? previous.total : null;
        return new ReportFacts.Counter(id, label, true, now, prev, prev == null ? null : now - prev, null);
    }

    /** One summed series window: the totals, and whether any row existed to sum. */
    private record Reading(long total, long second, boolean hasRows) {
        Reading withTotal(long value) {
            return new Reading(value, second, hasRows);
        }
    }

    /** {@code [received, negative]} over the KST-bucketed review series, REAL rows only. */
    private Reading reviewTotals(UUID orgId, LocalDate from, LocalDate to) {
        long received = 0;
        long negative = 0;
        boolean rows = false;
        for (Object[] row : metrics.reviewSeries(orgId, from, to, false)) {
            rows = true;
            received += ((Number) row[2]).longValue();
            negative += ((Number) row[3]).longValue();
        }
        return new Reading(received, negative, rows);
    }

    private Reading inquiryTotal(UUID orgId, LocalDate from, LocalDate to) {
        long received = 0;
        boolean rows = false;
        for (Object[] row : metrics.inquirySeries(orgId, from, to, false)) {
            rows = true;
            received += ((Number) row[2]).longValue();
        }
        return new Reading(received, 0, rows);
    }

    private Reading orderTotal(UUID orgId, LocalDate from, LocalDate to) {
        long orders = 0;
        boolean rows = false;
        for (Object[] row : metrics.orderSeries(orgId, from, to, false)) {
            rows = true;
            orders += ((Number) row[2]).longValue();
        }
        return new Reading(orders, 0, rows);
    }

    private List<ReportFacts.IssueFact> issueFacts(UUID orgId, ReportPeriod p) {
        Map<UUID, Long> now = countsByIssue(orgId, p.start(), p.end());
        Map<UUID, Long> previous = countsByIssue(orgId, p.previousStart(), p.previousEnd());
        List<ReportFacts.IssueFact> out = new ArrayList<>();
        for (ReviewIssueView issue : issues.list(orgId, p.end())) {
            long current = now.getOrDefault(issue.id(), 0L);
            long before = previous.getOrDefault(issue.id(), 0L);
            if (current == 0 && before == 0) {
                continue;
            }
            out.add(new ReportFacts.IssueFact("i-" + issue.id(), issue.id(), issue.title(), issue.severity(),
                    SEVERITY_KO.getOrDefault(issue.severity(), issue.severity()), current, before, current - before,
                    issue.change().labelsKo(), issue.dominantProductId(), issue.dominantProductName(),
                    "/memory/" + issue.id()));
        }
        out.sort(Comparator.comparingLong(ReportFacts.IssueFact::current).reversed()
                .thenComparing(ReportFacts.IssueFact::title));
        return List.copyOf(out);
    }

    private Map<UUID, Long> countsByIssue(UUID orgId, LocalDate from, LocalDate to) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : evidence.issueCountsInWindow(orgId, from, to)) {
            counts.put(UUID.fromString(String.valueOf(row[0])), ((Number) row[1]).longValue());
        }
        return counts;
    }

    private List<ReportFacts.OpportunityFact> opportunityFacts(UUID orgId, ReportPeriod p) {
        List<ReportFacts.OpportunityFact> out = new ArrayList<>();
        for (OpportunityView o : opportunities.list(orgId, p.end(), null, null, false)) {
            out.add(new ReportFacts.OpportunityFact("o-" + o.issueId() + "-" + o.kind(), o.issueId(), o.kind(),
                    o.kindLabelKo(), o.status(), o.statusLabelKo(), o.issueTitle(), o.productId(), o.productName(),
                    o.recommendationKo(), o.nextActionKo(), o.evidenceTo()));
        }
        return List.copyOf(out);
    }

    /**
     * Prepared next steps, each an existing object: the unanswered queue, an opportunity's own next
     * action, or an issue's evidence page when it rose and nothing is proposed for it yet.
     */
    private static List<ReportFacts.NextStep> nextSteps(List<ReportFacts.Counter> counters,
                                                        List<ReportFacts.IssueFact> issues,
                                                        List<ReportFacts.OpportunityFact> opportunities) {
        List<ReportFacts.NextStep> out = new ArrayList<>();
        int n = 1;
        for (ReportFacts.Counter c : counters) {
            if (COUNTER_UNANSWERED_NOW.equals(c.id()) && c.current() > 0) {
                // <b>The count stays on the counter; the CTA does not carry it</b> (Pilot QA, 2026-09-06).
                // A report is a frozen edition — it prints its own as-of — but this step's destination
                // is the LIVE inquiry screen. Baking the snapshot number into the label made the two
                // disagree in front of the seller: 「답변이 필요한 문의 22건 처리하기」 opened a screen
                // reading 24, two days after the edition was cut. The number is preserved where it is
                // true (the counter fact, cited by this step's trace); the label names the destination.
                out.add(new ReportFacts.NextStep("n-" + n++,
                        "답변이 필요한 문의 보기", UNANSWERED_PATH, List.of(c.id())));
            }
        }
        Set<UUID> proposed = new LinkedHashSet<>();
        for (ReportFacts.OpportunityFact o : opportunities) {
            proposed.add(o.issueId());
            String label = "ACCEPTED".equals(o.status())
                    ? o.issueTitle() + " — 준비된 " + o.kindLabelKo() + " 초안 마무리하기"
                    : o.issueTitle() + " — " + o.nextActionKo();
            out.add(new ReportFacts.NextStep("n-" + n++, label, o.to(), List.of(o.id())));
        }
        for (ReportFacts.IssueFact i : issues) {
            if (i.delta() > 0 && !proposed.contains(i.issueId())) {
                out.add(new ReportFacts.NextStep("n-" + n++,
                        "「" + i.title() + "」 근거 리뷰 확인하기 (이번 기간 " + i.current() + "건)", i.to(), List.of(i.id())));
            }
        }
        return List.copyOf(out);
    }
}
