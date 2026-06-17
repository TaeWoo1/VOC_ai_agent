package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.dto.BackfillResult;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.RunResult;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.List;
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

    @Test
    void analyzeForSourcesAnalyzesOnlyGivenNewIds() {
        // Two fresh reviews; analyze only the first by id.
        Review a = reviews.save(review(org, "배송이 너무 느려요", 2, true));
        Review b = reviews.save(review(org, "색상이 예뻐요", 5, false));

        RunResult result = service.analyzeForSources(org, "REVIEW", List.of(a.getId()));

        assertThat(result.analyzed()).isEqualTo(1);
        assertThat(result.skipped()).isZero();
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "REVIEW", a.getId())).isTrue();
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "REVIEW", b.getId())).isFalse();

        ItemAnalysis row = analyses.findAllByOrgIdOrderByCreatedAtDesc(org).stream()
                .filter(x -> x.getSourceId().equals(a.getId())).findFirst().orElseThrow();
        assertThat(row.getAnalyzerKind()).isEqualTo("RULE_BASED");
        assertThat(row.getAnalyzerVersion()).isEqualTo("rules-v1");
        assertThat(row.getModelName()).isNull();
        assertThat(row.getPromptVersion()).isNull();
    }

    @Test
    void analyzeForSourcesIsIdempotent() {
        Review a = reviews.save(review(org, "불량 환불 원해요", 1, true));

        service.analyzeForSources(org, "REVIEW", List.of(a.getId()));
        RunResult second = service.analyzeForSources(org, "REVIEW", List.of(a.getId()));

        assertThat(second.analyzed()).isZero();
        assertThat(second.skipped()).isEqualTo(1);
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org).stream()
                .filter(x -> x.getSourceId().equals(a.getId())).count()).isEqualTo(1);
    }

    @Test
    void analyzeForSourcesIsOrgScoped() {
        Review foreign = reviews.save(review(otherOrg, "다른 조직 리뷰", 3, false));

        // Even if a foreign id is passed under `org`, it must not be analyzed.
        RunResult result = service.analyzeForSources(org, "REVIEW", List.of(foreign.getId()));

        assertThat(result.analyzed()).isZero();
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "REVIEW", foreign.getId())).isFalse();
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(otherOrg, "REVIEW", foreign.getId())).isFalse();
    }

    @Test
    void analyzeForSourcesHandlesInquiries() {
        Inquiry q = inquiries.save(inquiry(org, "교환하고 싶어요", "UNANSWERED"));

        RunResult result = service.analyzeForSources(org, "INQUIRY", List.of(q.getId()));

        assertThat(result.analyzed()).isEqualTo(1);
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "INQUIRY", q.getId())).isTrue();
    }

    @Test
    void backfillAnalyzesMissingReviews() {
        Review a = reviews.save(review(org, "배송이 너무 느려요", 2, true));
        Review b = reviews.save(review(org, "포장이 꼼꼼해요", 5, false));

        BackfillResult result = service.backfillMissing(org, 100);

        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "REVIEW", a.getId())).isTrue();
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "REVIEW", b.getId())).isTrue();
        assertThat(result.remaining()).isZero();

        ItemAnalysis row = analyses.findAllByOrgIdOrderByCreatedAtDesc(org).stream()
                .filter(x -> x.getSourceId().equals(a.getId())).findFirst().orElseThrow();
        assertThat(row.getAnalyzerKind()).isEqualTo("RULE_BASED");
        assertThat(row.getAnalyzerVersion()).isEqualTo("rules-v1");
        assertThat(row.getModelName()).isNull();
        assertThat(row.getPromptVersion()).isNull();
    }

    @Test
    void backfillAnalyzesMissingInquiries() {
        Inquiry q = inquiries.save(inquiry(org, "교환은 어떻게 하나요?", "UNANSWERED"));

        service.backfillMissing(org, 100);

        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "INQUIRY", q.getId())).isTrue();
    }

    @Test
    void backfillSkipsAlreadyAnalyzed() {
        service.backfillMissing(org, 100);
        long countAfterFirst = analyses.findAllByOrgIdOrderByCreatedAtDesc(org).size();

        BackfillResult second = service.backfillMissing(org, 100);

        assertThat(second.analyzed()).isZero();
        assertThat(second.remaining()).isZero();
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org)).hasSize((int) countAfterFirst);
    }

    @Test
    void backfillRespectsLimit() {
        // Fresh org with no @BeforeEach-seeded rows, so the counts are exact.
        UUID freshOrg = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            reviews.save(review(freshOrg, "리뷰 본문 " + i, 3, false));
        }

        BackfillResult first = service.backfillMissing(freshOrg, 2);
        assertThat(first.analyzed()).isEqualTo(2);
        assertThat(first.remaining()).isEqualTo(3);

        BackfillResult second = service.backfillMissing(freshOrg, 2);
        assertThat(second.analyzed()).isEqualTo(2);
        assertThat(second.remaining()).isEqualTo(1);
    }

    @Test
    void backfillIsOrgScoped() {
        // otherOrg has a seeded inquiry; backfilling `org` must never touch it.
        UUID otherOrgInquiryId = inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(otherOrg)
                .get(0).getId();

        service.backfillMissing(org, 100);

        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(org, "INQUIRY", otherOrgInquiryId))
                .isFalse();
        assertThat(analyses.existsByOrgIdAndSourceTypeAndSourceId(otherOrg, "INQUIRY", otherOrgInquiryId))
                .isFalse();
    }

    @Test
    void backfillCreatesNoDuplicates() {
        UUID freshOrg = UUID.randomUUID();
        Review a = reviews.save(review(freshOrg, "중복 방지 리뷰", 4, false));
        Inquiry q = inquiries.save(inquiry(freshOrg, "중복 방지 문의", "UNANSWERED"));

        service.backfillMissing(freshOrg, 100);
        service.backfillMissing(freshOrg, 100);

        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(freshOrg).stream()
                .filter(x -> x.getSourceId().equals(a.getId())).count()).isEqualTo(1);
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(freshOrg).stream()
                .filter(x -> x.getSourceId().equals(q.getId())).count()).isEqualTo(1);
    }

    @Test
    void backfillProcessesInquiriesBeforeReviews() {
        // Many reviews, few inquiries, limit smaller than the review count: inquiries
        // must not be starved — all of them get analyzed first.
        UUID freshOrg = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            reviews.save(review(freshOrg, "리뷰 " + i, 3, false));
        }
        for (int i = 0; i < 2; i++) {
            inquiries.save(inquiry(freshOrg, "문의 " + i, "UNANSWERED"));
        }

        BackfillResult result = service.backfillMissing(freshOrg, 3);

        assertThat(result.analyzedInquiries()).isEqualTo(2);
        assertThat(result.analyzedReviews()).isEqualTo(1);
        assertThat(result.analyzed()).isEqualTo(3);
        assertThat(result.remaining()).isEqualTo(4); // 4 reviews left
    }

    @Test
    void backfillSharedBudgetRespectsTotalLimit() {
        UUID freshOrg = UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            reviews.save(review(freshOrg, "리뷰 " + i, 3, false));
            inquiries.save(inquiry(freshOrg, "문의 " + i, "UNANSWERED"));
        }

        BackfillResult result = service.backfillMissing(freshOrg, 4);

        assertThat(result.analyzed()).isEqualTo(4);
        assertThat(result.analyzedInquiries()).isEqualTo(3); // inquiries first
        assertThat(result.analyzedReviews()).isEqualTo(1);
        assertThat(result.remaining()).isEqualTo(2);
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
