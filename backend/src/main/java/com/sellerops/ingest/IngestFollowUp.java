package com.sellerops.ingest;

import com.sellerops.customermemory.CustomerMemoryIndexer;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * The ONE place a successful ingest hands off to the analysis that must follow it.
 *
 * <p><b>Why this exists.</b> Three code paths ingest rows — the upload connector, the API-sync
 * executor, and the Coupang review handoff — and until now each carried a DIFFERENT, partial set of
 * follow-ups. The upload path triggered item-analysis and published no issue-memory event; the API
 * sync published the event for Cafe24 board-4 only and never triggered item-analysis; the Coupang
 * handoff did neither. The consequences were real and were audited
 * ({@code docs/demo_baseline_recovery_audit_2026-08-21.md} defects B and C): FAQ/상세페이지 후보 were
 * structurally always 0 for any org that collects over an API, and the repeated-issue memory could
 * never see reviews acquired through Coupang or uploaded from a file.
 *
 * <p><b>What it is not.</b> It is not a new pipeline and it re-implements nothing. Every step below
 * already existed and is already idempotent; this class only makes the three ingest paths agree on
 * calling all of them:
 *
 * <ol>
 *   <li>{@link ItemAnalysisService#analyzeForSources} — the existing skip-if-exists analysis over
 *       exactly the ids one ingest inserted (the upload path's own call, moved here unchanged);</li>
 *   <li>{@link ReviewSegmentIngestedEvent} — the existing event whose existing listener
 *       ({@code ReviewIssueImportRefreshListener}, AFTER_COMMIT · REQUIRES_NEW · best-effort)
 *       refreshes the repeated-issue memory;</li>
 *   <li>{@link CustomerMemoryIndexer} — the retrieval index behind customer memory and repeated-inquiry
 *       detection, populated from the same inserted ids.</li>
 * </ol>
 *
 * <p><b>Two collaborators are nullable, and only two.</b> {@code itemAnalysis} is required — it is the
 * follow-up that already existed and the one whose absence was the audited defect. The issue-memory
 * event publisher and the customer-memory indexer may be null so that a test exercising only the
 * collection path does not have to stand up the analysis stack, the same allowance
 * {@code SyncRunExecutor} already makes for {@code reviewIssueBridge}. Production wires all three.
 *
 * <p><b>Best-effort, always.</b> Every step is wrapped: the rows are already persisted and committed
 * by the time we get here, so a follow-up failure must never fail (or roll back) the collection that
 * produced them. This is the posture {@code FileUploadConnector.triggerAnalysis} and
 * {@code ReviewIssueImportRefreshListener} already took, kept verbatim. The logs carry counts and
 * enums only — never a row id, never content.
 */
@Component
public class IngestFollowUp {

    private static final Logger log = LoggerFactory.getLogger(IngestFollowUp.class);

    /** {@code sourceType} values {@link ItemAnalysisService#analyzeForSources} understands. */
    public static final String REVIEW = "REVIEW";
    public static final String INQUIRY = "INQUIRY";

    private final ItemAnalysisService itemAnalysis;
    private final CustomerMemoryIndexer customerMemory;
    private final ApplicationEventPublisher events;

    public IngestFollowUp(ItemAnalysisService itemAnalysis, CustomerMemoryIndexer customerMemory,
                          ApplicationEventPublisher events) {
        this.itemAnalysis = itemAnalysis;
        this.customerMemory = customerMemory;
        this.events = events;
    }

    /**
     * Follow up a REVIEW ingest: analyse the new rows, refresh the issue memory, index them for
     * customer-memory retrieval.
     *
     * <p>{@code channelId} is carried only so the published event names the channel the reviews came
     * from, exactly as the NAVER import and the Cafe24 bridge already do.
     */
    public void afterReviewIngest(UUID orgId, UUID channelId, List<UUID> insertedIds) {
        if (insertedIds == null || insertedIds.isEmpty()) {
            return;
        }
        analyze(orgId, REVIEW, insertedIds);
        indexReviews(orgId, insertedIds);
        publishReviewSegment(orgId, channelId, insertedIds.size());
        // NOTE the order: analysis first, then indexing. The customer-memory index copies the topic
        // off the analysis row, so indexing before analysing would store a null topic for every row
        // and only the NEXT ingest would look classified. The dependency is real, not incidental.
    }

    /**
     * Follow up an INQUIRY ingest: analyse the new rows and index them. No
     * {@link ReviewSegmentIngestedEvent} — that event means "reviews landed" and its listener refreshes
     * the REVIEW issue memory; firing it for inquiries would make the memory re-scan reviews for no
     * reason and would quietly redefine what the event means.
     */
    public void afterInquiryIngest(UUID orgId, List<UUID> insertedIds) {
        if (insertedIds == null || insertedIds.isEmpty()) {
            return;
        }
        analyze(orgId, INQUIRY, insertedIds);
        indexInquiries(orgId, insertedIds);
    }

    private void analyze(UUID orgId, String sourceType, List<UUID> insertedIds) {
        try {
            itemAnalysis.analyzeForSources(orgId, sourceType, insertedIds);
        } catch (Exception e) {
            log.warn("ingest follow-up: item-analysis failed org={} type={} count={}: {}",
                    orgId, sourceType, insertedIds.size(), e.toString());
        }
    }

    private void indexReviews(UUID orgId, List<UUID> insertedIds) {
        if (customerMemory == null) {
            return;
        }
        try {
            customerMemory.indexReviews(orgId, insertedIds);
        } catch (Exception e) {
            log.warn("ingest follow-up: customer-memory review index failed org={} count={}: {}",
                    orgId, insertedIds.size(), e.toString());
        }
    }

    private void indexInquiries(UUID orgId, List<UUID> insertedIds) {
        if (customerMemory == null) {
            return;
        }
        try {
            customerMemory.indexInquiries(orgId, insertedIds);
        } catch (Exception e) {
            log.warn("ingest follow-up: customer-memory inquiry index failed org={} count={}: {}",
                    orgId, insertedIds.size(), e.toString());
        }
    }

    /**
     * Publish the existing segment event so the existing AFTER_COMMIT listener refreshes the issue
     * memory. The reference date is UTC today, matching {@code ReviewImportRunService} and
     * {@code Cafe24ReviewIssueBridge} — the two publishers that already existed.
     */
    private void publishReviewSegment(UUID orgId, UUID channelId, int count) {
        if (events == null) {
            return;
        }
        try {
            events.publishEvent(new ReviewSegmentIngestedEvent(orgId, channelId, LocalDate.now(ZoneOffset.UTC)));
            log.info("ingest follow-up: 이슈메모리 갱신 트리거 org={} 신규리뷰={}", orgId, count);
        } catch (RuntimeException e) {
            log.warn("ingest follow-up: issue-memory event publish failed org={} count={}: {}",
                    orgId, count, e.toString());
        }
    }
}
