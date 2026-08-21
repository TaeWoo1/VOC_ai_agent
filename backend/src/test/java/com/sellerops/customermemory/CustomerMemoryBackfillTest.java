package com.sellerops.customermemory;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The backfill, and the defect that made it necessary.
 *
 * <p><b>Found on real data, 2026-08-21.</b> The demo org holds 7,136 real customer utterances collected
 * before this index existed. After re-deriving everything else that HAS an operator backfill — item
 * analysis (640 → 7,136) and the issue memory (0 → 19 issues) — the customer-memory index was still 0,
 * and no read-only re-collection could change that: ingest is idempotent, so a replay inserts no rows,
 * {@code insertedIds} is empty, and {@link IngestFollowUp} correctly does nothing.
 *
 * <p>That is the same shape as audit defect B — a capability whose code works and whose trigger only
 * fires on a path the data never takes again. The first test below reproduces it; the rest pin the
 * contract of the fix.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CustomerMemoryBackfillTest {

    @Autowired CustomerMemoryEntryRepository entries;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ItemAnalysisRepository analyses;

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private CustomerMemoryIndexer indexer;
    private IngestFollowUp followUp;

    @BeforeEach
    void setUp() {
        indexer = new CustomerMemoryIndexer(entries, reviews, inquiries, analyses,
                new RuleBasedIssueSignatureExtractor(false));
        followUp = new IngestFollowUp(
                new ItemAnalysisService(inquiries, reviews, analyses, new RuleBasedInboxItemAnalyzer()),
                indexer, event -> { });
    }

    @Test
    @DisplayName("THE DEFECT: re-ingesting already-stored rows populates nothing, forever")
    void aReplayedIngestCannotPopulateTheIndex() {
        // Rows that landed before the index existed: stored, but never indexed.
        Review review = persistReview("양면테이프 부분이 떨어졌어요");
        Inquiry inquiry = persistInquiry("접착 문의", "양면테이프 부분이 떨어졌어요");

        // A re-collection of already-collected data inserts nothing, so the follow-up receives nothing.
        followUp.afterReviewIngest(org, channel, List.of());
        followUp.afterInquiryIngest(org, List.of());

        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.REVIEW))
                .as("no re-collection can fill this index — that is why a backfill route exists")
                .isZero();
        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY)).isZero();
        assertThat(review.getId()).isNotNull();
        assertThat(inquiry.getId()).isNotNull();
    }

    @Test
    @DisplayName("the backfill indexes already-stored rows, one corpus per call")
    void theBackfillIndexesStoredRows() {
        persistReview("양면테이프 부분이 떨어졌어요");
        persistInquiry("접착 문의", "양면테이프 부분이 떨어졌어요");

        CustomerMemoryIndexer.BackfillResult reviewPass =
                indexer.backfill(org, CustomerMemoryKind.REVIEW, 500, 0);
        CustomerMemoryIndexer.BackfillResult inquiryPass =
                indexer.backfill(org, CustomerMemoryKind.INQUIRY, 500, 0);

        assertThat(reviewPass.indexedReviews()).isEqualTo(1);
        assertThat(reviewPass.indexedInquiries()).as("a REVIEW pass touches no inquiry").isZero();
        assertThat(inquiryPass.indexedInquiries()).isEqualTo(1);
        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.REVIEW)).isEqualTo(1);
        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY)).isEqualTo(1);
    }

    @Test
    @DisplayName("running it twice changes nothing — idempotent by key, so paging needs no bookmark")
    void theBackfillIsIdempotent() {
        persistInquiry("접착 문의", "양면테이프 부분이 떨어졌어요");

        indexer.backfill(org, CustomerMemoryKind.INQUIRY, 500, 0);
        indexer.backfill(org, CustomerMemoryKind.INQUIRY, 500, 0);

        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY))
                .as("a re-run must be cheap rather than incorrect — a repeat count must not inflate")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("paging walks the whole corpus and converges: scanned < limit means done")
    void pagingConvergesOverTheCorpus() {
        for (int i = 0; i < 5; i++) {
            persistInquiry("접착 문의 " + i, "양면테이프 부분이 떨어졌어요");
        }

        int scannedTotal = 0;
        for (int page = 0; page < 10; page++) {
            CustomerMemoryIndexer.BackfillResult pass =
                    indexer.backfill(org, CustomerMemoryKind.INQUIRY, 2, page);
            scannedTotal += pass.scanned();
            if (pass.scanned() < 2) {
                break;
            }
        }

        assertThat(scannedTotal).isEqualTo(5);
        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY)).isEqualTo(5);
    }

    @Test
    @DisplayName("the backfill is org-scoped — another tenant's rows are not indexed into this org")
    void theBackfillIsOrgScoped() {
        UUID other = UUID.randomUUID();
        Inquiry theirs = persistInquiry("접착 문의", "양면테이프 부분이 떨어졌어요");
        theirs.setOrgId(other);
        inquiries.save(theirs);

        indexer.backfill(org, CustomerMemoryKind.INQUIRY, 500, 0);

        assertThat(entries.countByOrgIdAndEntryKind(org, CustomerMemoryKind.INQUIRY)).isZero();
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
