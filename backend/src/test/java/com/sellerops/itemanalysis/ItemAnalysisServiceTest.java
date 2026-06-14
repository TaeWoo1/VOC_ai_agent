package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.RunResult;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Persistence, idempotency, and org-scoping for the batch analyze run. The
 * analyzer is the real deterministic implementation (pure), so this also exercises
 * the end-to-end mapping into stored rows.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ItemAnalysisServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired ItemAnalysisRepository analyses;

    private ItemAnalysisService service;
    private final UUID org = UUID.randomUUID();
    private final UUID otherOrg = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ItemAnalysisService(inquiries, reviews, analyses,
                new RuleBasedInboxItemAnalyzer());

        inquiries.save(inquiry(org, "배송이 언제 도착하나요?", "UNANSWERED"));
        reviews.save(review(org, "불량이라 환불하고 싶어요", 1, true));
        // A different org's item must never be analyzed under `org`.
        inquiries.save(inquiry(otherOrg, "다른 조직 문의", "UNANSWERED"));
    }

    @Test
    void runAnalyzesEachItemOnceWithHonestProvenance() {
        RunResult result = service.run(org);

        assertThat(result.analyzed()).isEqualTo(2);
        assertThat(result.skipped()).isZero();
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org)).hasSize(2);

        ItemAnalysis row = analyses.findAllByOrgIdOrderByCreatedAtDesc(org).get(0);
        assertThat(row.getAnalyzerKind()).isEqualTo("RULE_BASED");
        assertThat(row.getAnalyzerName()).isEqualTo("rule-based");
        assertThat(row.getAnalyzerVersion()).isEqualTo("rules-v1");
        assertThat(row.getModelName()).isNull();
        assertThat(row.getPromptVersion()).isNull();
        assertThat(row.getSummary()).doesNotContain("환불하고 싶어요");
    }

    @Test
    void reRunIsIdempotentSkipIfExists() {
        service.run(org);
        RunResult second = service.run(org);

        assertThat(second.analyzed()).isZero();
        assertThat(second.skipped()).isEqualTo(2);
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org)).hasSize(2);
    }

    @Test
    void runIsOrgScoped() {
        service.run(org);

        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(otherOrg)).isEmpty();
    }

    @Test
    void listReturnsOnlyDerivedMetadata() {
        service.run(org);

        ItemAnalysisView view = service.list(org).stream()
                .filter(v -> v.sourceType().equals("REVIEW")).findFirst().orElseThrow();
        assertThat(view.category()).isEqualTo("교환");
        assertThat(view.sentiment()).isEqualTo("NEGATIVE");
        assertThat(view.summary()).isEqualTo("교환 관련 부정 리뷰");
    }

    private static Inquiry inquiry(UUID org, String body, String status) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setBody(body);
        q.setStatus(status);
        q.setReceivedAt(Instant.parse("2026-06-10T00:00:00Z"));
        return q;
    }

    private static Review review(UUID org, String body, int rating, boolean negative) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(UUID.randomUUID());
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(negative);
        r.setReceivedAt(Instant.parse("2026-06-09T00:00:00Z"));
        return r;
    }
}
