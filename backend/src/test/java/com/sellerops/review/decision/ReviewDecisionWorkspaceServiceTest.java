package com.sellerops.review.decision;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalAudit;
import com.sellerops.attention.reply.ReviewReplyApprovalAuditRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalState;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageAudit;
import com.sellerops.attention.triage.ReviewTriageAuditRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.knowledge.candidate.KnowledgeCandidate;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.decision.dto.ReviewDecisionContextView;
import com.sellerops.review.decision.dto.ReviewDecisionLogEntryView;
import com.sellerops.review.decision.dto.ReviewDecisionLogKind;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.TriageAction;
import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageActionRepository;
import com.sellerops.review.triage.feedback.TriageCorrectionAudit;
import com.sellerops.review.triage.feedback.TriageCorrectionAuditRepository;
import com.sellerops.reviewissue.IssueLifecycleState;
import com.sellerops.reviewissue.IssueSeverity;
import com.sellerops.reviewissue.MatchConfidence;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The two reads behind the Decision Workspace.
 *
 * <p>What is under test is mostly what the workspace REFUSES to do. It does not judge resemblance —
 * the only reviews it calls similar are ones the extractor already tied to the same problem, and it
 * never counts the review being decided among them. It does not answer for a product the review is
 * not bound to. It does not count retired knowledge the drafter cannot see. And it invents no decision
 * store: every log entry comes from a trail that was already being written, so a review nobody has
 * decided has an empty log rather than a fabricated 「판단 전」 event.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewDecisionWorkspaceServiceTest {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository evidence;
    @Autowired ProductKnowledgeSourceRepository productKnowledge;
    @Autowired OrgKnowledgeSourceRepository orgKnowledge;
    @Autowired KnowledgeCandidateRepository candidates;
    @Autowired TriageCorrectionAuditRepository correctionAudit;
    @Autowired TriageActionRepository actions;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewTriageAuditRepository triageAudit;
    @Autowired ReviewReplyApprovalRepository approvals;
    @Autowired ReviewReplyApprovalAuditRepository approvalAudit;
    @Autowired ReviewReplyOutcomeRepository outcomes;

    private ReviewDecisionWorkspaceService service;
    private final UUID org = UUID.randomUUID();
    private SellerAccount account;
    private UUID channelId;
    private static final LocalDate REF = LocalDate.of(2026, 9, 1);

    @BeforeEach
    void setUp() {
        service = new ReviewDecisionWorkspaceService(reviews, channels, products, evidence, issues,
                productKnowledge, orgKnowledge, candidates, correctionAudit, actions, triages,
                triageAudit, approvals, approvalAudit, outcomes);
        account = account(org);
        channelId = account.getChannelId();
    }

    /* ───────────────────────────── context ───────────────────────────── */

    @Test
    void a_review_that_backs_a_repeated_problem_brings_the_other_reviews_that_said_the_same() {
        Product product = product("선바로 전선몰딩");
        Review subject = review("자꾸 떨어져요 접착이 약합니다", 2, product);
        Review other = review("설치하고 이틀만에 떨어졌습니다", 1, product);
        ReviewIssue issue = issue("접착 탈락");
        link(issue, subject, product);
        link(issue, other, product);

        ReviewDecisionContextView view = service.context(org, subject.getId());

        assertThat(view.repeatedProblems()).hasSize(1);
        ReviewDecisionContextView.RepeatedProblem problem = view.repeatedProblems().get(0);
        assertThat(problem.title()).isEqualTo("접착 탈락");
        assertThat(problem.evidenceCount()).isEqualTo(2);
        // The review being decided is never shown as evidence that it repeats.
        assertThat(problem.similar()).extracting(ReviewDecisionContextView.SimilarReview::reviewId)
                .containsExactly(other.getId())
                .doesNotContain(subject.getId());
        assertThat(problem.similar().get(0).sameProduct()).isTrue();
        assertThat(problem.similar().get(0).quote()).contains("떨어졌");
    }

    @Test
    void a_review_the_extractor_tied_to_nothing_reports_no_problems_rather_than_guessing_at_one() {
        Product product = product("논슬립 주방매트");
        Review subject = review("색이 생각보다 진하네요", 3, product);
        // A neighbour on the same product with a similar-sounding complaint, deliberately unlinked:
        // resemblance is not this service's judgment to make.
        review("색이 진합니다", 3, product);

        ReviewDecisionContextView view = service.context(org, subject.getId());

        assertThat(view.repeatedProblems()).isEmpty();
    }

    @Test
    void the_product_signal_answers_for_the_product_and_is_absent_when_the_review_has_none() {
        Product product = product("선바로 전선몰딩");
        Review bound = review("괜찮습니다", 5, product);
        review("떨어집니다", 1, product);
        Review unbound = review("상품 미지정 리뷰", 2, null);

        ReviewDecisionContextView boundView = service.context(org, bound.getId());
        assertThat(boundView.productSignal()).isNotNull();
        assertThat(boundView.productSignal().reviews()).isEqualTo(2);
        assertThat(boundView.productSignal().negativeReviews()).isEqualTo(1);

        // Null, not zeros: "this product has no other reviews" and "this review is bound to no
        // product" are different statements and 0건 would answer a question nobody could ask.
        ReviewDecisionContextView unboundView = service.context(org, unbound.getId());
        assertThat(unboundView.productSignal()).isNull();
        assertThat(unboundView.productId()).isNull();
    }

    @Test
    void knowledge_on_hand_counts_only_what_could_actually_ground_a_reply() {
        Product product = product("선바로 전선몰딩");
        Review subject = review("접착이 약합니다", 2, product);
        productSource(product, "부착 안내", true);
        productSource(product, "옛 부착 안내", false);
        orgSource("배송 기준", true);
        orgSource("폐기된 반품 기준", false);
        openAsk(product);

        ReviewDecisionContextView view = service.context(org, subject.getId());

        assertThat(view.knowledge().productSources()).isEqualTo(1);
        assertThat(view.knowledge().orgSources()).isEqualTo(1);
        assertThat(view.knowledge().productTitles()).containsExactly("부착 안내");
        assertThat(view.knowledge().openAsks()).isEqualTo(1);
    }

    /**
     * The correction this service makes: a review on a channel with NO reply flow is still a review a
     * seller can DECIDE about. The fixture's channel is Coupang, where a seller cannot answer a 상품평 —
     * so before this, {@code ReviewReplyWorkLookup} handed out no ref and the screen could offer no
     * decision at all, even though the decision endpoint has never been capability-gated.
     */
    @Test
    void the_decision_address_is_handed_out_even_where_the_channel_has_no_reply_flow() {
        Review subject = review("본문", 2, null);

        ReviewDecisionContextView view = service.context(org, subject.getId());

        assertThat(view.decisionRef()).isEqualTo("review:" + subject.getId());
        assertThat(view.channelCode()).isEqualTo("COUPANG");
        assertThat(view.currentDecision()).isNull();
    }

    @Test
    void the_decision_that_stands_is_read_back_so_the_workspace_survives_a_refresh() {
        Review subject = review("본문", 2, null);
        dispositionEvent(subject, null, TriageDisposition.MONITOR, Instant.parse("2026-09-01T00:00:00Z"));

        assertThat(service.context(org, subject.getId()).currentDecision())
                .isEqualTo(TriageDisposition.MONITOR.name());
    }

    @Test
    void another_orgs_review_is_indistinguishable_from_one_that_does_not_exist() {
        Review subject = review("본문", 2, null);

        assertThatThrownBy(() -> service.context(UUID.randomUUID(), subject.getId()))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.log(UUID.randomUUID(), subject.getId()))
                .isInstanceOf(ApiException.class);
    }

    /* ───────────────────────────── the log ───────────────────────────── */

    @Test
    void the_log_is_read_from_the_trails_that_were_already_being_written_newest_first() {
        Review subject = review("접착이 약합니다", 2, null);
        Instant t0 = Instant.parse("2026-09-01T00:00:00Z");

        correctionEvent(subject, TriageCorrectionAudit.Kind.SET, null, ReviewTriageTier.FYI, t0);
        dispositionEvent(subject, null, TriageDisposition.RESPONSE_NEEDED, t0.plus(1, ChronoUnit.HOURS));
        actionEvent(subject, TriageActionKind.ACTION_COMPLETED, t0.plus(2, ChronoUnit.HOURS));
        approvalEvent(subject, null, ReviewReplyApprovalState.APPROVED, t0.plus(3, ChronoUnit.HOURS));

        List<ReviewDecisionLogEntryView> log = service.log(org, subject.getId());

        assertThat(log).extracting(ReviewDecisionLogEntryView::kind).containsExactly(
                ReviewDecisionLogKind.REPLY_APPROVAL.name(),
                ReviewDecisionLogKind.ACTION_RECORDED.name(),
                ReviewDecisionLogKind.ACTION_CHOSEN.name(),
                ReviewDecisionLogKind.SELLER_JUDGMENT_SET.name());
        assertThat(log.get(2).to()).isEqualTo(TriageDisposition.RESPONSE_NEEDED.name());
        assertThat(log.get(3).to()).isEqualTo(ReviewTriageTier.FYI.name());
    }

    @Test
    void a_withdrawn_judgment_is_its_own_event_and_carries_no_target_tier() {
        Review subject = review("본문", 2, null);
        Instant t0 = Instant.parse("2026-09-01T00:00:00Z");
        correctionEvent(subject, TriageCorrectionAudit.Kind.SET, null, ReviewTriageTier.FYI, t0);
        correctionEvent(subject, TriageCorrectionAudit.Kind.WITHDRAWN, ReviewTriageTier.FYI, null,
                t0.plus(1, ChronoUnit.HOURS));

        List<ReviewDecisionLogEntryView> log = service.log(org, subject.getId());

        assertThat(log).hasSize(2);
        assertThat(log.get(0).kind()).isEqualTo(ReviewDecisionLogKind.SELLER_JUDGMENT_WITHDRAWN.name());
        assertThat(log.get(0).from()).isEqualTo(ReviewTriageTier.FYI.name());
        assertThat(log.get(0).to()).isNull();
    }

    @Test
    void a_review_nobody_has_decided_has_an_empty_log_rather_than_an_invented_event() {
        Review subject = review("본문", 5, null);

        assertThat(service.log(org, subject.getId())).isEmpty();
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private SellerAccount account(UUID ownerOrg) {
        Channel ch = new Channel();
        ch.setCode("COUPANG");
        ch.setNameKo("쿠팡");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        channels.save(ch);

        SellerAccount acc = new SellerAccount();
        acc.setOrgId(ownerOrg);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.PENDING);
        acc.setFileUpload(false);
        return accounts.save(acc);
    }

    private Product product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku(UUID.randomUUID().toString().substring(0, 8));
        p.setStatus("ACTIVE");
        return products.save(p);
    }

    private Review review(String body, int rating, Product product) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channelId);
        r.setProductId(product == null ? null : product.getId());
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating <= 2);
        r.setReceivedAt(REF.atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        return reviews.save(r);
    }

    private ReviewIssue issue(String title) {
        ReviewIssue issue = new ReviewIssue();
        issue.setOrgId(org);
        issue.setSignatureKey(title);
        issue.setTitle(title);
        issue.setAspect("접착");
        issue.setProblem("탈락");
        issue.setSeverity(IssueSeverity.HIGH);
        issue.setLifecycleState(IssueLifecycleState.OBSERVING);
        issue.setExtractorKind("RULE_BASED");
        issue.setExtractorVersion("issue-rules-v2");
        issue.setDismissed(false);
        issue.setFirstEvidenceOn(REF);
        issue.setLastEvidenceOn(REF);
        return issues.save(issue);
    }

    private void link(ReviewIssue issue, Review review, Product product) {
        ReviewIssueEvidence row = new ReviewIssueEvidence();
        row.setOrgId(org);
        row.setIssueId(issue.getId());
        row.setReviewId(review.getId());
        row.setUnitOrdinal(0);
        row.setProductId(product == null ? null : product.getId());
        row.setOccurredOn(REF);
        row.setMatchConfidence(MatchConfidence.EXACT_SIGNATURE);
        evidence.save(row);
    }

    private void productSource(Product product, String title, boolean active) {
        ProductKnowledgeSource row = new ProductKnowledgeSource();
        row.setOrgId(org);
        row.setProductId(product.getId());
        row.setSourceType(KnowledgeSourceType.FAQ);
        row.setTitle(title);
        row.setBody("내용");
        row.setActive(active);
        productKnowledge.save(row);
    }

    private void orgSource(String title, boolean active) {
        OrgKnowledgeSource row = new OrgKnowledgeSource();
        row.setOrgId(org);
        row.setKnowledgeType(OrgKnowledgeType.SHIPPING_POLICY);
        row.setTitle(title);
        row.setBody("내용");
        row.setActive(active);
        orgKnowledge.save(row);
    }

    private void openAsk(Product product) {
        KnowledgeCandidate row = new KnowledgeCandidate();
        row.setOrgId(org);
        row.setScope("PRODUCT");
        row.setProductId(product.getId());
        row.setSubject("접착");
        row.setContent("질문");
        row.setOrigin(KnowledgeCandidateService.ORIGIN_DRAFT_GAP);
        row.setEvidenceCount(1);
        row.setState(KnowledgeCandidateService.STATE_OPEN);
        row.setDedupeKey(UUID.randomUUID().toString());
        row.setCreatedAt(Instant.now());
        candidates.save(row);
    }

    private void correctionEvent(Review review, TriageCorrectionAudit.Kind kind,
                                 ReviewTriageTier from, ReviewTriageTier to, Instant at) {
        TriageCorrectionAudit row = new TriageCorrectionAudit();
        row.setOrgId(org);
        row.setReviewId(review.getId());
        row.setCorrectionId(UUID.randomUUID());
        row.setKind(kind);
        row.setTierFrom(from);
        row.setTierTo(to);
        row.setDecidedAt(at);
        correctionAudit.save(row);
    }

    private void dispositionEvent(Review review, TriageDisposition from, TriageDisposition to, Instant at) {
        ReviewTriage decision = triages.findByOrgIdAndReviewId(org, review.getId()).orElseGet(() -> {
            ReviewTriage row = new ReviewTriage();
            row.setOrgId(org);
            row.setReviewId(review.getId());
            row.setChannelId(channelId);
            row.setDisposition(to);
            row.setDecidedBy("SELLER:test");
            row.setDecidedAt(at);
            return triages.save(row);
        });
        ReviewTriageAudit audit = new ReviewTriageAudit();
        audit.setOrgId(org);
        audit.setReviewTriageId(decision.getId());
        audit.setCommandId(UUID.randomUUID().toString());
        audit.setDispositionFrom(from);
        audit.setDispositionTo(to);
        audit.setActor("SELLER:test");
        audit.setCreatedAt(at);
        triageAudit.save(audit);
    }

    private void actionEvent(Review review, TriageActionKind kind, Instant at) {
        TriageAction row = new TriageAction();
        row.setOrgId(org);
        row.setReviewId(review.getId());
        row.setKind(kind);
        row.setActedAt(at);
        actions.save(row);
    }

    private void approvalEvent(Review review, ReviewReplyApprovalState from,
                               ReviewReplyApprovalState to, Instant at) {
        ReviewReplyApproval approval = approvals.findByOrgIdAndReviewId(org, review.getId()).orElseGet(() -> {
            ReviewReplyApproval row = new ReviewReplyApproval();
            row.setOrgId(org);
            row.setReviewId(review.getId());
            row.setState(to);
            row.setApprovedVersion(1);
            row.setApprovedFingerprint("0".repeat(64));
            row.setDecidedBy("SELLER:test");
            row.setDecidedAt(at);
            return approvals.save(row);
        });
        ReviewReplyApprovalAudit audit = new ReviewReplyApprovalAudit();
        audit.setOrgId(org);
        audit.setReviewReplyApprovalId(approval.getId());
        audit.setCommandId(UUID.randomUUID().toString());
        audit.setStateFrom(from);
        audit.setStateTo(to);
        audit.setApprovedVersion(1);
        audit.setApprovedFingerprint("0".repeat(64));
        audit.setActor("SELLER:test");
        audit.setCreatedAt(at);
        approvalAudit.save(audit);
    }
}
