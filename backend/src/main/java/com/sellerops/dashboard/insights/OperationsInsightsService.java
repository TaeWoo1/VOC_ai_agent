package com.sellerops.dashboard.insights;

import com.sellerops.common.Korean;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.dashboard.dto.TopProductIssue;
import com.sellerops.dashboard.insights.dto.OperationsInsight;
import com.sellerops.dashboard.metrics.dto.ChannelMetricRow;
import com.sellerops.dashboard.metrics.dto.OperationsMetricsResponse;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Overview's "지금 눈여겨볼 것" — at most five, each with a destination.
 *
 * <p><b>Every producer is allowed to return nothing.</b> The list is short because the conditions are
 * real, not because it was truncated: a demo org with no backlog and no negative concentration gets
 * fewer cards, and that is the correct output.
 *
 * <p><b>Coverage outranks arithmetic here too.</b> A channel that cannot report is a finding of its
 * own ({@link #freshness}) rather than a silent gap under some other card's number.
 */
@Service
public class OperationsInsightsService {

    /** The screen's budget. Five cards is a glance; ten is a second inbox. */
    static final int MAX_INSIGHTS = 5;

    /** One channel holding this much of a total is a concentration worth naming, not a coincidence. */
    static final double CONCENTRATION_THRESHOLD = 0.6;

    private final ReviewIssueRepository issues;

    public OperationsInsightsService(ReviewIssueRepository issues) {
        this.issues = issues;
    }

    @Transactional(readOnly = true)
    public List<OperationsInsight> insights(UUID orgId, OperationsMetricsResponse metrics,
                                            List<TopProductIssue> topProductIssues) {
        List<OperationsInsight> found = new ArrayList<>();
        backlog(metrics).ifPresent(found::add);
        negativeProduct(topProductIssues).ifPresent(found::add);
        repeatedIssue(orgId).ifPresent(found::add);
        concentration(metrics).ifPresent(found::add);
        freshness(metrics).ifPresent(found::add);

        found.sort(Comparator.comparing(OperationsInsight::severity));
        return found.size() > MAX_INSIGHTS ? found.subList(0, MAX_INSIGHTS) : found;
    }

    /** 미답변 문의가 있는가. The backlog is a current state, so it needs no window. */
    private java.util.Optional<OperationsInsight> backlog(OperationsMetricsResponse metrics) {
        long unanswered = metrics.channels().stream()
                .filter(ChannelMetricRow::countedInInquiries)
                .mapToLong(ChannelMetricRow::unansweredInquiries)
                .sum();
        if (unanswered <= 0) {
            return java.util.Optional.empty();
        }
        ChannelMetricRow worst = metrics.channels().stream()
                .filter(ChannelMetricRow::countedInInquiries)
                .max(Comparator.comparingLong(ChannelMetricRow::unansweredInquiries))
                .orElse(null);
        String detail = worst == null || worst.unansweredInquiries() <= 0 ? null
                : worst.channelNameKo() + " " + worst.unansweredInquiries() + "건이 가장 많습니다.";
        return java.util.Optional.of(new OperationsInsight("INQUIRY_BACKLOG",
                OperationsInsight.Severity.ATTENTION,
                "답변이 필요한 문의 " + unanswered + "건", detail, "/inquiries", "문의 열기",
                "답변이 필요한 문의를 채널별로 정리해 줘"));
    }

    /** 부정 리뷰가 한 상품에 몰려 있는가. */
    private java.util.Optional<OperationsInsight> negativeProduct(List<TopProductIssue> top) {
        TopProductIssue worst = top.stream()
                .filter(t -> t.count() > 1)
                .max(Comparator.comparingLong(TopProductIssue::count))
                .orElse(null);
        if (worst == null) {
            return java.util.Optional.empty();
        }
        // The name may be null — a review can point at a product the catalogue read does not return.
        // "-" would be a label nobody can act on, so the id-bearing route carries the meaning instead.
        String name = worst.productName() == null ? "이름을 확인하지 못한 상품" : worst.productName();
        return java.util.Optional.of(new OperationsInsight("NEGATIVE_REVIEW_PRODUCT",
                OperationsInsight.Severity.ATTENTION,
                name + " 부정 리뷰 " + worst.count() + "건",
                worst.firstNegativeOn() + " ~ " + worst.lastNegativeOn(),
                "/products/" + worst.productId(), "상품 열기",
                name + " 리뷰에서 반복되는 문제를 알려 줘"));
    }

    /** 같은 문제가 반복되는가 — the extractor's own verdict, never a count of raw reviews. */
    private java.util.Optional<OperationsInsight> repeatedIssue(UUID orgId) {
        List<ReviewIssue> open = issues.findByOrgIdAndDismissedFalse(orgId);
        if (open.isEmpty()) {
            return java.util.Optional.empty();
        }
        ReviewIssue newest = open.stream()
                .filter(i -> i.getLastEvidenceOn() != null)
                .max(Comparator.comparing(ReviewIssue::getLastEvidenceOn))
                .orElse(open.get(0));
        return java.util.Optional.of(new OperationsInsight("REPEATED_REVIEW_ISSUE",
                OperationsInsight.Severity.WATCH,
                "반복되는 리뷰 문제 " + open.size() + "건",
                newest.getTitle(), "/memory", "반복 문제 보기",
                "반복되는 리뷰 문제를 상품별로 정리해 줘"));
    }

    /** 한 채널에 매출이 몰려 있는가. Only over channels actually counted in the total. */
    private java.util.Optional<OperationsInsight> concentration(OperationsMetricsResponse metrics) {
        List<ChannelMetricRow> counted = metrics.channels().stream()
                .filter(ChannelMetricRow::countedInOrders)
                .filter(row -> row.revenue() > 0)
                .toList();
        // With one channel there is nothing to concentrate INTO; the word would be meaningless.
        if (counted.size() < 2) {
            return java.util.Optional.empty();
        }
        long total = counted.stream().mapToLong(ChannelMetricRow::revenue).sum();
        ChannelMetricRow top = counted.stream()
                .max(Comparator.comparingLong(ChannelMetricRow::revenue))
                .orElseThrow();
        double share = total == 0 ? 0 : (double) top.revenue() / total;
        if (share < CONCENTRATION_THRESHOLD) {
            return java.util.Optional.empty();
        }
        return java.util.Optional.of(new OperationsInsight("CHANNEL_CONCENTRATION",
                OperationsInsight.Severity.INFO,
                Korean.withSubject(top.channelNameKo()) + " 매출의 " + Math.round(share * 100) + "%",
                "최근 " + metrics.period().days() + "일 기준입니다.", "/orders", "주문 보기",
                "채널별 매출 비중을 알려 줘"));
    }

    /**
     * 어떤 채널이 지금 말을 못 하는가.
     *
     * <p>Reported as one card, not one per excluded row: a disconnected channel excludes itself from
     * three totals at once, and three identical cards would push everything else off the screen.
     */
    private java.util.Optional<OperationsInsight> freshness(OperationsMetricsResponse metrics) {
        List<ChannelMetricRow> broken = metrics.channels().stream()
                .filter(row -> row.orderState() == ChannelDataState.BLOCKED
                        || row.inquiryState() == ChannelDataState.BLOCKED
                        || row.reviewState() == ChannelDataState.BLOCKED)
                .toList();
        if (broken.isEmpty()) {
            return java.util.Optional.empty();
        }
        String names = broken.stream().map(ChannelMetricRow::channelNameKo).distinct()
                .reduce((a, b) -> a + " · " + b).orElse("");
        return java.util.Optional.of(new OperationsInsight("CHANNEL_NOT_REPORTING",
                OperationsInsight.Severity.ATTENTION,
                names + " 연결이 끊겼습니다",
                // <b>What is missing is what came AFTER the last successful read — not what we hold.</b>
                // The first version of this line said the channel's data was excluded from the numbers
                // above, and on the very first live read that was false: NAVER contributed 48 orders,
                // 45 reviews and 1 inquiry to those totals from rows collected before the credential
                // broke. A caveat that overstates its own reach teaches a seller to ignore caveats.
                "마지막 수집 이후에 생긴 것은 아직 반영되지 않았습니다.", "/connect", "채널 연결 열기",
                null));
    }
}
