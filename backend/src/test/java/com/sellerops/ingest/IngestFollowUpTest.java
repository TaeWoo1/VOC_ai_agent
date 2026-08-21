package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.customermemory.CustomerMemoryEntry;
import com.sellerops.customermemory.CustomerMemoryEntryRepository;
import com.sellerops.customermemory.CustomerMemoryIndexer;
import com.sellerops.customermemory.CustomerMemoryKind;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.context.ActiveProfiles;

/**
 * The one seam every ingest path now shares.
 *
 * <p><b>What this test is really about.</b> Before it, three ingest paths did three different subsets
 * of the same follow-up, and the differences were invisible because each path's own tests passed:
 * upload triggered item-analysis and published no issue-memory event; API sync published the event for
 * Cafe24 board-4 only and never analysed; the Coupang handoff did neither. The audit
 * ({@code docs/demo_baseline_recovery_audit_2026-08-21.md}, defects B and C) traced two shipped
 * consequences to exactly that — FAQ/상세 후보 structurally always 0 for a connector org, and the
 * repeated-issue memory permanently blind to Coupang and upload reviews.
 *
 * <p>So the assertions here are about the FOLLOW-UP being complete and being the same everywhere, not
 * about any one path. Each path's own behaviour stays covered by its own test.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class IngestFollowUpTest {

    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired CustomerMemoryEntryRepository memory;

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final List<ReviewSegmentIngestedEvent> published = new ArrayList<>();

    private IngestFollowUp followUp;

    @BeforeEach
    void setUp() {
        published.clear();
        ItemAnalysisService analysis =
                new ItemAnalysisService(inquiries, reviews, analyses, new RuleBasedInboxItemAnalyzer());
        CustomerMemoryIndexer indexer = new CustomerMemoryIndexer(memory, reviews, inquiries, analyses,
                new RuleBasedIssueSignatureExtractor(false));
        ApplicationEventPublisher events = event -> {
            if (event instanceof ReviewSegmentIngestedEvent segment) {
                published.add(segment);
            }
        };
        followUp = new IngestFollowUp(analysis, indexer, events);
    }

    @Test
    @DisplayName("a review ingest analyses, refreshes the issue memory, and indexes customer memory")
    void reviewIngestDoesAllThree() {
        Review review = persistReview("붙였는데 이틀 만에 다 떨어졌어요");

        followUp.afterReviewIngest(org, channel, List.of(review.getId()));

        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "REVIEW", review.getId()))
                .as("item-analysis ran — this is the half that only the upload path used to get")
                .isTrue();
        assertThat(published)
                .as("the issue-memory refresh event fired — the half only NAVER import and Cafe24 got")
                .hasSize(1);
        assertThat(published.get(0).orgId()).isEqualTo(org);
        assertThat(published.get(0).channelId()).isEqualTo(channel);
        assertThat(memory.findByOrgIdAndEntryKindAndSourceId(org, CustomerMemoryKind.REVIEW, review.getId()))
                .as("and the row is recallable").isPresent();
    }

    @Test
    @DisplayName("an inquiry ingest analyses and indexes, and does NOT fire the review event")
    void inquiryIngestDoesNotFireTheReviewEvent() {
        Inquiry inquiry = persistInquiry("접착 불량 문의", "붙였는데 떨어집니다");

        followUp.afterInquiryIngest(org, List.of(inquiry.getId()));

        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "INQUIRY", inquiry.getId())).isTrue();
        assertThat(memory.findByOrgIdAndEntryKindAndSourceId(org, CustomerMemoryKind.INQUIRY, inquiry.getId()))
                .isPresent();
        assertThat(published)
                .as("ReviewSegmentIngestedEvent means 'reviews landed'; firing it for inquiries would "
                        + "make the issue memory re-scan reviews for no reason and redefine the event")
                .isEmpty();
    }

    @Test
    @DisplayName("the index copies the analysis topic, which is why analysis must run first")
    void theIndexCopiesTheAnalysisTopic() {
        Inquiry inquiry = persistInquiry("배송 문의", "택배가 언제 오나요");

        followUp.afterInquiryIngest(org, List.of(inquiry.getId()));

        CustomerMemoryEntry entry = memory
                .findByOrgIdAndEntryKindAndSourceId(org, CustomerMemoryKind.INQUIRY, inquiry.getId())
                .orElseThrow();
        assertThat(entry.getTopic())
                .as("the topic is the analysis row's category, not a second classification")
                .isEqualTo(analyses.findByOrgIdAndSourceTypeAndSourceIdIn(org, "INQUIRY",
                        List.of(inquiry.getId())).get(0).getCategory());
    }

    @Test
    @DisplayName("re-running the follow-up over the same ids indexes once, not twice")
    void theFollowUpIsIdempotent() {
        Review review = persistReview("붙였는데 이틀 만에 다 떨어졌어요");

        followUp.afterReviewIngest(org, channel, List.of(review.getId()));
        followUp.afterReviewIngest(org, channel, List.of(review.getId()));

        assertThat(memory.countByOrgIdAndEntryKind(org, CustomerMemoryKind.REVIEW))
                .as("a replayed upload or a re-run sync must not inflate a repeat count")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("an empty insert list does nothing at all — no analysis, no event, no index")
    void emptyInsertsAreANoOp() {
        followUp.afterReviewIngest(org, channel, List.of());
        followUp.afterInquiryIngest(org, List.of());

        assertThat(published).isEmpty();
        assertThat(memory.countByOrgIdAndEntryKind(org, CustomerMemoryKind.REVIEW)).isZero();
        assertThat(memory.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY)).isZero();
    }

    /**
     * A follow-up failure never propagates.
     *
     * <p>The rows are already committed by the time the follow-up runs, so a throwing collaborator must
     * not fail (or roll back) the collection that produced them. Asserted with an indexer whose
     * repository throws, because "best-effort" written in a comment is not a property.
     */
    @Test
    @DisplayName("a throwing follow-up step never fails the ingest that produced the rows")
    void aFailingStepIsSwallowed() {
        Review review = persistReview("붙였는데 이틀 만에 다 떨어졌어요");
        CustomerMemoryIndexer exploding = new CustomerMemoryIndexer(memory, reviews, inquiries, analyses,
                new RuleBasedIssueSignatureExtractor(false)) {
            @Override
            public int indexReviews(UUID orgId, List<UUID> reviewIds) {
                throw new IllegalStateException("index unavailable");
            }
        };
        IngestFollowUp fragile = new IngestFollowUp(
                new ItemAnalysisService(inquiries, reviews, analyses, new RuleBasedInboxItemAnalyzer()),
                exploding,
                event -> {
                    if (event instanceof ReviewSegmentIngestedEvent segment) {
                        published.add(segment);
                    }
                });

        fragile.afterReviewIngest(org, channel, List.of(review.getId()));

        assertThat(published)
                .as("the steps after the failing one still ran — best-effort is per step, not per call")
                .hasSize(1);
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private Review persistReview(String body) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channel);
        review.setRating(1);
        review.setBody(body);
        review.setNegative(true);
        review.setReceivedAt(Instant.parse("2026-08-14T00:00:00Z"));
        return reviews.save(review);
    }

    private Inquiry persistInquiry(String title, String body) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(channel);
        inquiry.setTitle(title);
        inquiry.setBody(body);
        inquiry.setStatus("UNANSWERED");
        inquiry.setReceivedAt(Instant.parse("2026-08-18T00:00:00Z"));
        return inquiries.save(inquiry);
    }
}
