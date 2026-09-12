package com.sellerops.repeatedissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.opportunity.KnowledgeMentionCheck;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.repeatedissue.dto.RepeatedIssueContextView;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.IssueSignatureExtractor;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueExtractionService;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.reviewissue.ReviewIssueSnapshotService;
import com.sellerops.reviewissue.ReviewIssueStateEventRepository;
import com.sellerops.reviewissue.ReviewIssueUnknownUnitRepository;
import com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor;
import com.sellerops.reviewissue.dto.IssueProductEvidenceView;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The Repeated Issue workspace's read, over a real (H2) database.
 *
 * <p>Every test here is about a sentence the screen is allowed to say. The workspace's whole claim is
 * that a seller can judge a repeated problem without leaving it, and the way that claim goes wrong is
 * a number whose population nobody named — so most of what is asserted below is which rows a count is
 * counting, not that the count is nonzero.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class RepeatedIssueWorkspaceServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ReviewIssueUnknownUnitRepository unknowns;
    @Autowired ReviewIssueStateEventRepository stateEvents;
    @Autowired ProductRepository products;
    @Autowired ProductKnowledgeSourceRepository productSources;
    @Autowired OrgKnowledgeSourceRepository orgSources;

    private static final LocalDate REF = LocalDate.of(2026, 7, 25);

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private ReviewIssueExtractionService extraction;
    private RepeatedIssueWorkspaceService service;

    @BeforeEach
    void setUp() {
        IssueSignatureExtractor extractor = new RuleBasedIssueSignatureExtractor(false);
        extraction = new ReviewIssueExtractionService(extractor, issues, evidence, unknowns, stateEvents);
        ReviewIssueSnapshotService snapshots = new ReviewIssueSnapshotService(evidence);
        ReviewIssueQueryService queries = new ReviewIssueQueryService(
                issues, evidence, stateEvents, snapshots, reviews, products);
        service = new RepeatedIssueWorkspaceService(
                queries, new KnowledgeMentionCheck(productSources, orgSources));
    }

    private UUID product(String name) {
        Product product = new Product();
        product.setOrgId(org);
        product.setName(name);
        product.setStatus("ACTIVE");
        return products.save(product).getId();
    }

    private Review review(String body, LocalDate on, UUID productId) {
        Review review = new Review();
        review.setOrgId(org);
        review.setChannelId(channel);
        review.setProductId(productId);
        review.setBody(body);
        review.setRating(2);
        review.setReceivedAt(on.atStartOfDay(ZoneOffset.UTC).toInstant());
        return reviews.save(review);
    }

    /** A review that says nothing the extractor recognises — it lands in the denominator only. */
    private void quietReview(LocalDate on, UUID productId) {
        extraction.extract(review("잘 받았습니다", on, productId));
    }

    private ReviewIssue issueByKey(String key) {
        return issues.findByOrgIdAndSignatureKey(org, key).orElseThrow();
    }

    private IssueProductEvidenceView rowFor(RepeatedIssueContextView context, UUID productId) {
        return context.evidence().byProduct().stream()
                .filter(row -> row.productId().equals(productId))
                .findFirst().orElseThrow();
    }

    // ---- where it repeats, and against what ---------------------------------------------------

    /**
     * The question the workspace exists for: 「어디서 얼마나」. The evidence count and the denominator
     * it is a count OF travel in the same row, so a surface cannot print one product's numerator
     * beside another's total.
     */
    @Test
    void each_product_carries_its_own_evidence_count_and_its_own_review_total() {
        UUID moulding = product("전선몰딩");
        UUID cups = product("종이컵");

        extraction.extract(review("접착이 부족해서 다시 붙였습니다", REF, moulding));
        extraction.extract(review("접착이 부족합니다", REF.minusDays(3), moulding));
        extraction.extract(review("접착이 부족해요", REF.minusDays(9), cups));
        quietReview(REF.minusDays(1), moulding);
        quietReview(REF.minusDays(2), cups);
        quietReview(REF.minusDays(4), cups);

        RepeatedIssueContextView context =
                service.context(org, issueByKey("접착:부족").getId(), REF);

        assertThat(rowFor(context, moulding).evidenceCount()).isEqualTo(2);
        assertThat(rowFor(context, moulding).productReviews()).isEqualTo(3);
        assertThat(rowFor(context, cups).evidenceCount()).isEqualTo(1);
        assertThat(rowFor(context, cups).productReviews()).isEqualTo(3);
        // Largest first, so the product a seller should look at is the one they read first.
        assertThat(context.evidence().byProduct().get(0).productId()).isEqualTo(moulding);
    }

    /**
     * <b>The denominator counts reviews, not evidence — including reviews that said nothing.</b> That
     * is the whole reason it is worth showing: 2 out of 3 and 2 out of 300 are different problems, and
     * a surface that only ever printed the numerator could not tell them apart.
     */
    @Test
    void the_denominator_counts_the_products_quiet_reviews_too() {
        UUID moulding = product("전선몰딩");
        extraction.extract(review("접착이 부족해요", REF, moulding));
        for (int i = 1; i <= 9; i++) {
            quietReview(REF.minusDays(i), moulding);
        }

        RepeatedIssueContextView context =
                service.context(org, issueByKey("접착:부족").getId(), REF);

        assertThat(rowFor(context, moulding).evidenceCount()).isEqualTo(1);
        assertThat(rowFor(context, moulding).productReviews()).isEqualTo(10);
    }

    /**
     * Evidence whose review resolved to no product has no denominator to be measured against, so it is
     * reported as its own number rather than folded into some product's total.
     */
    @Test
    void evidence_with_no_product_is_reported_apart_from_every_products_total() {
        UUID moulding = product("전선몰딩");
        extraction.extract(review("접착이 부족해요", REF, moulding));
        extraction.extract(review("접착이 부족합니다", REF.minusDays(2), null));

        RepeatedIssueContextView context =
                service.context(org, issueByKey("접착:부족").getId(), REF);

        assertThat(context.evidence().totalEvidence()).isEqualTo(2);
        assertThat(context.evidence().unattributedEvidence()).isEqualTo(1);
        assertThat(context.evidence().byProduct()).hasSize(1);
        assertThat(rowFor(context, moulding).evidenceCount()).isEqualTo(1);
    }

    // ---- what this company has already written ------------------------------------------------

    /**
     * The library answer is a word match over what the seller actually registered — so an issue about
     * 접착 finds the note they wrote about 접착, and the sentence shown is the seller's own.
     */
    @Test
    void the_library_answer_names_what_the_seller_has_written_about_this_problem() {
        UUID moulding = product("전선몰딩");
        ProductKnowledgeSource source = new ProductKnowledgeSource();
        source.setOrgId(org);
        source.setProductId(moulding);
        source.setSourceType(KnowledgeSourceType.USAGE);
        source.setTitle("부착 안내");
        source.setBody("접착 면의 먼지를 닦고 30초간 눌러 주세요.");
        source.setActive(true);
        productSources.save(source);

        extraction.extract(review("접착이 부족해요", REF, moulding));
        extraction.extract(review("접착이 부족합니다", REF.minusDays(1), moulding));

        RepeatedIssueContextView context =
                service.context(org, issueByKey("접착:부족").getId(), REF);

        assertThat(context.aspect()).isEqualTo("접착");
        assertThat(context.knowledge().productId()).isEqualTo(moulding);
        assertThat(context.knowledge().productSources()).isEqualTo(1);
        assertThat(context.knowledge().productMentions()).isEqualTo(1);
        assertThat(context.knowledge().excerpts())
                .anySatisfy(excerpt -> assertThat(excerpt).contains("먼지를 닦고"));
    }

    /**
     * <b>A library with entries that say nothing about this problem is not an empty library.</b> The
     * two counts are separate so the screen can say 「3건 중 0건이 이 문제를 다룹니다」 — which is a
     * different sentence, and a different next step, from 「등록된 지식이 없습니다」.
     */
    @Test
    void a_library_that_says_nothing_about_this_problem_still_reports_what_it_holds() {
        UUID moulding = product("전선몰딩");
        ProductKnowledgeSource source = new ProductKnowledgeSource();
        source.setOrgId(org);
        source.setProductId(moulding);
        source.setSourceType(KnowledgeSourceType.DESCRIPTION);
        source.setTitle("색상 안내");
        source.setBody("아이보리와 화이트 두 가지입니다.");
        source.setActive(true);
        productSources.save(source);

        extraction.extract(review("접착이 부족해요", REF, moulding));

        RepeatedIssueContextView context =
                service.context(org, issueByKey("접착:부족").getId(), REF);

        assertThat(context.knowledge().productSources()).isEqualTo(1);
        assertThat(context.knowledge().productMentions()).isZero();
        assertThat(context.knowledge().excerpts()).isEmpty();
    }

    /**
     * <b>「배송 파손」 is answered by the exchange rule, not the shipping one.</b> That correction was
     * measured once in the improvement lane, and this read reuses that pure decision rather than
     * making it a second time — two surfaces deciding which rule answers a problem is how they come to
     * give a seller two different answers.
     */
    @Test
    void a_damaged_delivery_is_matched_against_the_exchange_rule_the_improvement_lane_already_chose() {
        OrgKnowledgeSource rule = new OrgKnowledgeSource();
        rule.setOrgId(org);
        rule.setKnowledgeType(OrgKnowledgeType.EXCHANGE_REFUND_POLICY);
        rule.setTitle("교환 기준");
        rule.setBody("수령 후 7일 이내에 접수해 주시면 새 제품으로 보내 드립니다.");
        rule.setActive(true);
        orgSources.save(rule);

        UUID moulding = product("전선몰딩");
        extraction.extract(review("배송 중에 파손되어 왔습니다", REF, moulding));

        RepeatedIssueContextView context =
                service.context(org, issueByKey("배송:파손").getId(), REF);

        // Matched by TYPE, though the rule's text never says 배송 or 파손.
        assertThat(context.knowledge().orgSources()).isEqualTo(1);
        assertThat(context.knowledge().orgMentions()).isEqualTo(1);
    }

    /**
     * An issue whose evidence resolves to no product has no product shelf to read, and the read says
     * so with zeroes rather than reporting the company's answer under a product's name.
     */
    @Test
    void an_issue_bound_to_no_product_reads_no_product_library() {
        extraction.extract(review("접착이 부족해요", REF, null));

        RepeatedIssueContextView context =
                service.context(org, issueByKey("접착:부족").getId(), REF);

        assertThat(context.knowledge().productId()).isNull();
        assertThat(context.knowledge().productName()).isNull();
        assertThat(context.knowledge().productSources()).isZero();
        assertThat(context.knowledge().productMentions()).isZero();
    }

    // ---- scoping ------------------------------------------------------------------------------

    /**
     * Another org's issue id fails exactly as a missing one does, so this surface cannot be used to
     * learn that an id exists somewhere else.
     */
    @Test
    void another_orgs_issue_is_indistinguishable_from_one_that_never_existed() {
        extraction.extract(review("접착이 부족해요", REF, product("전선몰딩")));
        UUID real = issueByKey("접착:부족").getId();

        assertThatThrownBy(() -> service.context(UUID.randomUUID(), real, REF))
                .hasMessage("이슈를 찾을 수 없습니다.");
        assertThatThrownBy(() -> service.context(org, UUID.randomUUID(), REF))
                .hasMessage("이슈를 찾을 수 없습니다.");
    }
}
