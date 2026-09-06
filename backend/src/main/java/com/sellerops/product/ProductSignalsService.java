package com.sellerops.product;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.customermemory.CustomerMemoryKind;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.product.dto.ProductSignalsView;
import com.sellerops.product.dto.ProductSummaryView;
import com.sellerops.product.dto.ProductVolumeView;
import com.sellerops.product.dto.RecommendedActionCountView;
import com.sellerops.product.dto.SignalCoverageView;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What is happening to one product — composed from existing judgements, and honest about what it
 * could not see.
 *
 * <p><b>This service decides nothing.</b> Severity, trend, concentration and lifecycle come from
 * {@link ReviewIssueQueryService} exactly as the 고객운영 메모리 screen reads them; recommended actions
 * are tallies of stored {@code item_analyses} verdicts; volumes are repository counts. If this class
 * ever computes a verdict of its own, there are two definitions of that verdict in the product and the
 * screens will disagree — the failure mode the Operator Graph contract calls R1.
 *
 * <p><b>The coverage rows are the point.</b> Product linkage in this repository is genuinely partial:
 * {@code Cafe24ReviewPromoter} sets {@code productId = null} because Cafe24 carries only its own
 * {@code product_no}, and Coupang review rows are keyed on an option id. Without a coverage verdict, a
 * product with no linked rows and a product with nothing wrong produce the SAME empty answer, and the
 * agent reading it would say "문제 없습니다". So every list is paired with a
 * {@link SignalCoverageView} carrying {@link AttentionCoverage} — the vocabulary the review-attention
 * surface already uses for exactly this guard — plus the linked/unlinked split and the provenance of
 * whoever produced the signal.
 */
@Service
public class ProductSignalsService {

    /**
     * How many of a product's rows are tallied for analysis coverage. Bounded, and the bound is
     * reported: a truncated tally that looked complete would be the same lie in a different place.
     */
    static final int ANALYSIS_SAMPLE_CAP = 500;

    private static final String SOURCE_REVIEW = "REVIEW";
    private static final String SOURCE_INQUIRY = "INQUIRY";
    private static final String UNANSWERED = "UNANSWERED";

    private final ProductQueryService productQuery;
    private final ReviewIssueQueryService issueQuery;
    private final ReviewIssueEvidenceRepository evidence;
    private final ItemAnalysisRepository analyses;
    private final ReviewRepository reviews;
    private final InquiryRepository inquiries;
    private final CustomerMemoryEntryRepository customerMemory;
    private final ChannelRepository channels;

    public ProductSignalsService(ProductQueryService productQuery, ReviewIssueQueryService issueQuery,
                                 ReviewIssueEvidenceRepository evidence, ItemAnalysisRepository analyses,
                                 ReviewRepository reviews, InquiryRepository inquiries,
                                 CustomerMemoryEntryRepository customerMemory, ChannelRepository channels) {
        this.productQuery = productQuery;
        this.issueQuery = issueQuery;
        this.evidence = evidence;
        this.analyses = analyses;
        this.reviews = reviews;
        this.inquiries = inquiries;
        this.customerMemory = customerMemory;
        this.channels = channels;
    }

    @Transactional(readOnly = true)
    public ProductSignalsView signals(UUID orgId, UUID productId, LocalDate referenceDate) {
        ProductSummaryView product = productQuery.byId(orgId, productId)
                // Same message whether it is missing or another org's, so an id cannot be probed —
                // the rule ReviewIssueQueryService.requireIssue already sets.
                .orElseThrow(() -> new IllegalArgumentException("상품을 찾을 수 없습니다."));
        LocalDate at = referenceDate == null ? LocalDate.now(ZoneOffset.UTC) : referenceDate;

        long linkedReviews = reviews.countByOrgIdAndProductId(orgId, productId);
        long unlinkedReviews = reviews.countByOrgIdAndProductIdIsNull(orgId);
        long linkedInquiries = inquiries.countByOrgIdAndProductId(orgId, productId);
        long unlinkedInquiries = inquiries.countByOrgIdAndProductIdIsNull(orgId);
        long unansweredForProduct = inquiries.countByOrgIdAndProductIdAndStatus(orgId, productId, UNANSWERED);

        List<ReviewIssueView> issues = issuesFor(orgId, productId, at);
        long issueEvidenceForProduct = issues.stream().mapToLong(ReviewIssueView::evidenceCount).sum();
        long unlinkedEvidence = evidence.countByOrgIdAndProductIdIsNull(orgId);

        AnalysisTally tally = analysisTally(orgId, productId);

        List<SignalCoverageView> coverage = new ArrayList<>();
        coverage.add(new SignalCoverageView(SignalCoverageView.REVIEW_ISSUE,
                verdict(issueEvidenceForProduct, unlinkedEvidence),
                issueEvidenceForProduct, unlinkedEvidence, issueProvenance(issues)));
        coverage.add(new SignalCoverageView(SignalCoverageView.ITEM_ANALYSIS,
                tally.coverage(), tally.analysed(), tally.unanalysed(), tally.provenance()));
        coverage.add(new SignalCoverageView(SignalCoverageView.REVIEW,
                verdict(linkedReviews, unlinkedReviews),
                linkedReviews, unlinkedReviews, "review-store/INGEST:canonical"));
        coverage.add(new SignalCoverageView(SignalCoverageView.INQUIRY,
                verdict(linkedInquiries, unlinkedInquiries),
                linkedInquiries, unlinkedInquiries, "inquiry-store/INGEST:canonical"));
        long memoryLinked = customerMemory
                .findByOrgIdAndProductIdOrderByOccurredOnDesc(orgId, productId, PageRequest.of(0, ANALYSIS_SAMPLE_CAP))
                .size();
        long memoryUnlinked = customerMemory.countByOrgIdAndEntryKindAndProductIdIsNull(orgId, CustomerMemoryKind.INQUIRY)
                + customerMemory.countByOrgIdAndEntryKindAndProductIdIsNull(orgId, CustomerMemoryKind.REVIEW);
        coverage.add(new SignalCoverageView(SignalCoverageView.CUSTOMER_MEMORY,
                verdict(memoryLinked, memoryUnlinked),
                memoryLinked, memoryUnlinked, "customer-memory/LEXICAL:v1"));

        return new ProductSignalsView(product.id(), product.name(), product.sku(), at,
                issues, tally.counts(),
                new ProductVolumeView(linkedReviews, linkedInquiries, unansweredForProduct,
                        issueEvidenceForProduct),
                linkedChannelCodes(orgId, productId), List.copyOf(coverage));
    }

    /**
     * The coverage verdict for one source.
     *
     * <p><b>{@code unlinked} is the whole question.</b> It counts rows this org holds that could not be
     * attributed to ANY product. If it is zero, every row the source has is attributed, so a product
     * with none genuinely has none — a measured zero. If it is non-zero, an empty answer for this
     * product might be hiding in that pile, and the source must decline to answer.
     *
     * <p>An earlier version returned {@code UNCERTAIN_PRODUCT_UNLINKED} whenever the product had no rows
     * and the org had some, regardless of {@code unlinked}. On the demo org — 81 issue-evidence rows,
     * <b>zero</b> of them unlinked — that made every product without an issue report "판단할 수 없습니다"
     * when the honest answer was "이 상품에는 기록된 문제가 없습니다". Found live, 2026-08-21. Declining
     * to answer when we CAN answer is a milder failure than the reverse, but it is still a false one, and
     * a surface that cries uncertainty everywhere teaches a seller to ignore it — which is exactly how
     * the real blind spots stop being read.
     */
    private static AttentionCoverage verdict(long linkedForProduct, long unlinked) {
        if (linkedForProduct > 0) {
            return AttentionCoverage.COVERED;
        }
        // Nothing is unattributable, so nothing can be hiding: this product's zero is measured.
        return unlinked == 0 ? AttentionCoverage.COVERED : AttentionCoverage.UNCERTAIN_PRODUCT_UNLINKED;
    }

    /**
     * Issues this product has evidence for, worst-first, each rendered by the issue memory itself.
     * Public since Opportunity Engine v1: the product-scoped opportunity read starts from exactly this
     * list, so a product's opportunities can never name an issue its own signal card does not.
     */
    @Transactional(readOnly = true)
    public List<ReviewIssueView> issuesFor(UUID orgId, UUID productId, LocalDate at) {
        List<Object[]> rows = evidence.issueEvidenceCountsByProduct(orgId, productId);
        List<ReviewIssueView> views = new ArrayList<>();
        for (Object[] row : rows) {
            UUID issueId = (UUID) row[0];
            // The query already counted this product's evidence; the issue view carries the org-wide
            // total, which is the right number on the issue memory and the wrong one here. Discarding
            // the count we asked for and printing the other is how 「근거 46건」 stood over 42 rows.
            long forProduct = ((Number) row[1]).longValue();
            try {
                views.add(issueQuery.issueView(orgId, issueId, at).scopedTo(forProduct));
            } catch (IllegalArgumentException gone) {
                // The issue was removed between the evidence read and this one. Skipping is correct:
                // reporting a product signal for an issue that no longer exists would be a finding
                // with no drill-down behind it.
            }
        }
        return views.stream()
                .filter(v -> !v.dismissed())
                .sorted(Comparator.comparing((ReviewIssueView v) -> severityRank(v.severity()))
                        .thenComparing(Comparator.comparingLong(ReviewIssueView::evidenceCount).reversed())
                        .thenComparing(v -> v.id().toString()))
                .toList();
    }

    private static int severityRank(String severity) {
        return switch (severity == null ? "" : severity) {
            case "HIGH" -> 0;
            case "MEDIUM" -> 1;
            default -> 2;
        };
    }

    /** Provenance of the issue signal, read off the stored extractor rather than hardcoded. */
    private static String issueProvenance(List<ReviewIssueView> issues) {
        String kind = issues.isEmpty() ? "RULE_BASED" : issues.get(0).extractorKind();
        return "issue-memory/" + kind;
    }

    /**
     * Tally the stored {@code recommended_action} verdicts over this product's rows, and report how
     * many of those rows have no analysis at all — the second false-calm hole, because "FAQ 후보 0건"
     * and "이 상품의 어떤 행도 분석된 적이 없다" would otherwise print the same.
     */
    private AnalysisTally analysisTally(UUID orgId, UUID productId) {
        var page = PageRequest.of(0, ANALYSIS_SAMPLE_CAP);
        List<UUID> reviewIds = reviews.findIdsByProduct(orgId, productId, page);
        List<UUID> inquiryIds = inquiries.findIdsByProduct(orgId, productId, page);

        List<ItemAnalysis> rows = new ArrayList<>();
        if (!reviewIds.isEmpty()) {
            rows.addAll(analyses.findByOrgIdAndSourceTypeAndSourceIdIn(orgId, SOURCE_REVIEW, reviewIds));
        }
        if (!inquiryIds.isEmpty()) {
            rows.addAll(analyses.findByOrgIdAndSourceTypeAndSourceIdIn(orgId, SOURCE_INQUIRY, inquiryIds));
        }

        long sampled = (long) reviewIds.size() + inquiryIds.size();
        long analysed = rows.size();
        long unanalysed = Math.max(0, sampled - analysed);

        Map<String, Long> byAction = rows.stream()
                .collect(Collectors.groupingBy(ItemAnalysis::getRecommendedAction, LinkedHashMap::new,
                        Collectors.counting()));
        List<RecommendedActionCountView> counts = byAction.entrySet().stream()
                .map(e -> new RecommendedActionCountView(e.getKey(), e.getValue()))
                .sorted(Comparator.comparingLong(RecommendedActionCountView::count).reversed()
                        .thenComparing(RecommendedActionCountView::recommendedAction))
                .toList();

        String provenance = rows.isEmpty() ? "item-analysis/NONE"
                : "item-analysis/" + rows.get(0).getAnalyzerKind() + ":" + rows.get(0).getAnalyzerVersion();
        // Nothing sampled = this product has no rows at all, which is a fact the REVIEW/INQUIRY coverage
        // rows already report properly; there is no ANALYSIS gap in having nothing to analyse. Rows that
        // exist but were never analysed IS a gap, and that is the case this verdict exists to name.
        AttentionCoverage coverage = sampled == 0
                ? AttentionCoverage.COVERED
                : (analysed == 0 ? AttentionCoverage.UNCERTAIN_UNSUPPORTED_CHANNEL : AttentionCoverage.COVERED);
        return new AnalysisTally(counts, analysed, unanalysed, coverage, provenance);
    }

    /** Channel codes with product-linked rows — the positive half of coverage, seller-visible only. */
    private List<String> linkedChannelCodes(UUID orgId, UUID productId) {
        Set<UUID> ids = new java.util.LinkedHashSet<>(reviews.distinctChannelIdsByProduct(orgId, productId));
        ids.addAll(inquiries.distinctChannelIdsByProduct(orgId, productId));
        if (ids.isEmpty()) {
            return List.of();
        }
        return channels.findAllById(ids).stream()
                .map(Channel::getCode)
                .filter(com.sellerops.channel.ProductChannels::isVisible)
                .sorted(Comparator.comparingInt(com.sellerops.channel.ProductChannels.VISIBLE_CODES::indexOf))
                .toList();
    }

    private record AnalysisTally(List<RecommendedActionCountView> counts, long analysed, long unanalysed,
                                 AttentionCoverage coverage, String provenance) {
    }
}
