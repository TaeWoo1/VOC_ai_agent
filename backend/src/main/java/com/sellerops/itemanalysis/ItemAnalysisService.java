package com.sellerops.itemanalysis;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.InboxItemAnalyzer.Result;
import com.sellerops.itemanalysis.InboxItemAnalyzer.SourceItem;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.RunResult;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Manual, idempotent, org-scoped analysis of recent inbox items. Deterministic and
 * local — no external call. Re-running is safe: an item that already has an
 * analysis row is skipped (skip-if-exists). The raw body is read in-memory only and
 * is never logged.
 */
@Service
public class ItemAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(ItemAnalysisService.class);

    static final String INQUIRY = "INQUIRY";
    static final String REVIEW = "REVIEW";

    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ItemAnalysisRepository analyses;
    private final InboxItemAnalyzer analyzer;

    public ItemAnalysisService(InquiryRepository inquiries, ReviewRepository reviews,
                               ItemAnalysisRepository analyses, InboxItemAnalyzer analyzer) {
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.analyses = analyses;
        this.analyzer = analyzer;
    }

    @Transactional
    public RunResult run(UUID orgId) {
        int analyzed = 0;
        int skipped = 0;

        for (Inquiry q : inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(orgId)) {
            if (analyzeInquiry(orgId, q)) {
                analyzed++;
            } else {
                skipped++;
            }
        }

        for (Review r : reviews.findTop50ByOrgIdOrderByReceivedAtDesc(orgId)) {
            if (analyzeReview(orgId, r)) {
                analyzed++;
            } else {
                skipped++;
            }
        }

        // Counts only — never the body.
        log.info("item-analysis run org={} analyzed={} skipped={}", orgId, analyzed, skipped);
        return new RunResult(analyzed, skipped);
    }

    /**
     * Analyze exactly the given source ids (the rows a single upload just inserted),
     * skipping any that already have an analysis. Org-scoped: ids not belonging to
     * {@code orgId} are ignored. Same deterministic, local, idempotent path as
     * {@link #run(UUID)} — no rescan of the org, no top-50 dependency.
     */
    @Transactional
    public RunResult analyzeForSources(UUID orgId, String sourceType, List<UUID> ids) {
        int analyzed = 0;
        int skipped = 0;
        if (ids != null && !ids.isEmpty()) {
            if (REVIEW.equals(sourceType)) {
                for (Review r : reviews.findAllById(ids)) {
                    if (!orgId.equals(r.getOrgId())) {
                        continue;
                    }
                    if (analyzeReview(orgId, r)) {
                        analyzed++;
                    } else {
                        skipped++;
                    }
                }
            } else if (INQUIRY.equals(sourceType)) {
                for (Inquiry q : inquiries.findAllById(ids)) {
                    if (!orgId.equals(q.getOrgId())) {
                        continue;
                    }
                    if (analyzeInquiry(orgId, q)) {
                        analyzed++;
                    } else {
                        skipped++;
                    }
                }
            }
        }
        log.info("item-analysis upload-trigger org={} type={} analyzed={} skipped={}",
                orgId, sourceType, analyzed, skipped);
        return new RunResult(analyzed, skipped);
    }

    /** @return true if a new analysis was written, false if skipped (already exists). */
    private boolean analyzeInquiry(UUID orgId, Inquiry q) {
        if (analyses.existsByOrgIdAndSourceTypeAndSourceId(orgId, INQUIRY, q.getId())) {
            return false;
        }
        SourceItem item = new SourceItem(INQUIRY, q.getId(), q.getBody(),
                null, q.getStatus(), false);
        persist(orgId, item, q.getContentHash());
        return true;
    }

    /** @return true if a new analysis was written, false if skipped (already exists). */
    private boolean analyzeReview(UUID orgId, Review r) {
        if (analyses.existsByOrgIdAndSourceTypeAndSourceId(orgId, REVIEW, r.getId())) {
            return false;
        }
        SourceItem item = new SourceItem(REVIEW, r.getId(), r.getBody(),
                r.getRating(), null, r.isNegative());
        persist(orgId, item, r.getContentHash());
        return true;
    }

    @Transactional(readOnly = true)
    public List<ItemAnalysisView> list(UUID orgId) {
        return analyses.findAllByOrgIdOrderByCreatedAtDesc(orgId).stream()
                .map(ItemAnalysisView::of)
                .toList();
    }

    private void persist(UUID orgId, SourceItem item, String sourceContentHash) {
        Result result = analyzer.analyze(item);
        ItemAnalysis row = new ItemAnalysis();
        row.setOrgId(orgId);
        row.setSourceType(item.sourceType());
        row.setSourceId(item.sourceId());
        row.setSummary(result.summary());
        row.setCategory(result.category());
        row.setSentiment(result.sentiment());
        row.setUrgency(result.urgency());
        row.setRecommendedAction(result.recommendedAction());
        row.setAnalyzerKind(result.analyzerKind());
        row.setAnalyzerName(result.analyzerName());
        row.setAnalyzerVersion(result.analyzerVersion());
        // modelName / promptVersion stay null for rule-based analysis.
        row.setSourceContentHash(sourceContentHash);
        analyses.save(row);
    }
}
