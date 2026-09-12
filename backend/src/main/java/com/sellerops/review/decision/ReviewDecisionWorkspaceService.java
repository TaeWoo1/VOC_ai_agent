package com.sellerops.review.decision;

import com.sellerops.attention.VocItemRef;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.attention.reply.OperatorOutcome;
import com.sellerops.attention.reply.ReviewReplyApproval;
import com.sellerops.attention.reply.ReviewReplyApprovalAudit;
import com.sellerops.attention.reply.ReviewReplyApprovalAuditRepository;
import com.sellerops.attention.reply.ReviewReplyApprovalRepository;
import com.sellerops.attention.reply.ReviewReplyOutcome;
import com.sellerops.attention.reply.ReviewReplyOutcomeRepository;
import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageAudit;
import com.sellerops.attention.triage.ReviewTriageAuditRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.common.ApiException;
import com.sellerops.knowledge.candidate.KnowledgeCandidateRepository;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.decision.dto.ReviewDecisionContextView;
import com.sellerops.review.decision.dto.ReviewDecisionLogEntryView;
import com.sellerops.review.decision.dto.ReviewDecisionLogKind;
import com.sellerops.review.triage.feedback.TriageAction;
import com.sellerops.review.triage.feedback.TriageActionRepository;
import com.sellerops.review.triage.feedback.TriageCorrectionAudit;
import com.sellerops.review.triage.feedback.TriageCorrectionAuditRepository;
import com.sellerops.reviewissue.IssueEvidenceQuote;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>Review Decision Workspace v1 — the two reads that let one screen answer «why am I looking at
 * this, and what have I already decided».</b>
 *
 * <p>Everything the workspace shows was already true somewhere in this repository. The problem it
 * closes is that it was true in five different places: the repeated problems on the issue memory, the
 * other reviews that said the same on the issue page, the product's own volume on the product page,
 * the company's written knowledge in the library, and the seller's own past decisions in four
 * separate audit trails none of which had a reader. A seller deciding one review had to leave it to
 * find each one, and came back without it.
 *
 * <p><b>Nothing is stored by this service and nothing is computed by a model.</b> Both methods are
 * reads. There is no decision table here: the workspace's writes are the ones the product already
 * has — the response decision ({@code review_triage}), the seller's own tier
 * ({@code review_triage_corrections}), the explicit act ({@code review_triage_actions}), the reply
 * approval and the reported outcome. A fifth store for «what the seller decided» would be a second
 * copy of answers that are already answerable, and the copy is what drifts.
 *
 * <p><b>Every read is bounded by construction</b> and none of them grows with the seller's data: one
 * review, one product, this review's own evidence links, at most {@link #MAX_PROBLEMS} issues with at
 * most {@link #MAX_SIMILAR_PER_PROBLEM} other reviews each, four counts, and at most
 * {@link #MAX_LOG_ENTRIES} trail rows. <b>Marketplace calls: 0. Model calls: 0.</b>
 *
 * <p><b>An id from outside is not a fact.</b> The review is fetched with the caller's org and the
 * account's channel, exactly as {@code ChannelReviewService.detail} does, and a miss is a 404 — a
 * review belonging to another org is indistinguishable from one that does not exist.
 */
@Service
public class ReviewDecisionWorkspaceService {

    /**
     * How many repeated problems the workspace carries.
     *
     * <p>{@code ReviewDetailService.MAX_ISSUES} is 5 because the conversation's review card lists
     * titles. Here each one brings example reviews with it, and a screen that opens with fifteen other
     * people's complaints is not a place to decide one review. The issue page shows them all.
     */
    static final int MAX_PROBLEMS = 3;

    /** How many other reviews stand beside one problem. Enough to recognise a pattern, few enough to read. */
    static final int MAX_SIMILAR_PER_PROBLEM = 3;

    /** How many knowledge titles the workspace names before it stops and points at the library. */
    static final int MAX_KNOWLEDGE_TITLES = 5;

    /** How far back the decision log reads. A review is decided a handful of times, not streamed. */
    static final int MAX_LOG_ENTRIES = 50;

    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final SellerAccountRepository accounts;
    private final ReviewIssueEvidenceRepository issueEvidence;
    private final ReviewIssueRepository issues;
    private final ProductKnowledgeSourceRepository productKnowledge;
    private final OrgKnowledgeSourceRepository orgKnowledge;
    private final KnowledgeCandidateRepository candidates;
    private final TriageCorrectionAuditRepository correctionAudit;
    private final TriageActionRepository actions;
    private final ReviewTriageRepository triage;
    private final ReviewTriageAuditRepository triageAudit;
    private final ReviewReplyApprovalRepository approvals;
    private final ReviewReplyApprovalAuditRepository approvalAudit;
    private final ReviewReplyOutcomeRepository outcomes;

    public ReviewDecisionWorkspaceService(ReviewRepository reviews, ChannelRepository channels,
                                          ProductRepository products,
                                          SellerAccountRepository accounts,
                                          ReviewIssueEvidenceRepository issueEvidence,
                                          ReviewIssueRepository issues,
                                          ProductKnowledgeSourceRepository productKnowledge,
                                          OrgKnowledgeSourceRepository orgKnowledge,
                                          KnowledgeCandidateRepository candidates,
                                          TriageCorrectionAuditRepository correctionAudit,
                                          TriageActionRepository actions,
                                          ReviewTriageRepository triage,
                                          ReviewTriageAuditRepository triageAudit,
                                          ReviewReplyApprovalRepository approvals,
                                          ReviewReplyApprovalAuditRepository approvalAudit,
                                          ReviewReplyOutcomeRepository outcomes) {
        this.reviews = reviews;
        this.channels = channels;
        this.products = products;
        this.accounts = accounts;
        this.issueEvidence = issueEvidence;
        this.issues = issues;
        this.productKnowledge = productKnowledge;
        this.orgKnowledge = orgKnowledge;
        this.candidates = candidates;
        this.correctionAudit = correctionAudit;
        this.actions = actions;
        this.triage = triage;
        this.triageAudit = triageAudit;
        this.approvals = approvals;
        this.approvalAudit = approvalAudit;
        this.outcomes = outcomes;
    }

    /** What stands behind this review — repeated problems, what else said the same, and what is written down. */
    @Transactional(readOnly = true)
    public ReviewDecisionContextView context(UUID orgId, UUID accountId, UUID reviewId) {
        Review review = requireReview(orgId, accountId, reviewId);
        Product product = review.getProductId() == null ? null
                : products.findAllByOrgIdAndIdIn(orgId, List.of(review.getProductId()))
                        .stream().findFirst().orElse(null);
        String channelCode = review.getChannelId() == null ? null
                : channels.findById(review.getChannelId()).map(Channel::getCode).orElse(null);

        return new ReviewDecisionContextView(
                review.getId(),
                VocItemRef.forReview(review.getId()),
                triage.findByOrgIdAndReviewId(orgId, review.getId())
                        .map(ReviewTriage::getDisposition).map(Enum::name).orElse(null),
                channelCode,
                product == null ? null : product.getId(),
                product == null ? null : product.getName(),
                repeatedProblems(orgId, review),
                signalOf(orgId, product),
                knowledgeOnHand(orgId, product));
    }

    /**
     * What the seller has already decided about this review, newest first.
     *
     * <p>Newest first because the question the log answers on this screen is «where does this stand»,
     * and the answer is the last thing that happened. The trails themselves are unchanged and each
     * still reads oldest-first where it is the subject rather than the footnote.
     */
    @Transactional(readOnly = true)
    public List<ReviewDecisionLogEntryView> log(UUID orgId, UUID accountId, UUID reviewId) {
        Review review = requireReview(orgId, accountId, reviewId);
        List<ReviewDecisionLogEntryView> entries = new ArrayList<>();

        for (TriageCorrectionAudit row : correctionAudit.findByReviewIdOrderByDecidedAtAsc(review.getId())) {
            if (!orgId.equals(row.getOrgId())) {
                continue;
            }
            boolean withdrawn = row.getKind() == TriageCorrectionAudit.Kind.WITHDRAWN;
            entries.add(new ReviewDecisionLogEntryView(
                    (withdrawn ? ReviewDecisionLogKind.SELLER_JUDGMENT_WITHDRAWN
                               : ReviewDecisionLogKind.SELLER_JUDGMENT_SET).name(),
                    row.getTierFrom() == null ? null : row.getTierFrom().name(),
                    row.getTierTo() == null ? null : row.getTierTo().name(),
                    row.getDecidedAt()));
        }

        // The response decision's trail hangs off the decision row, not off the review, so the row is
        // resolved first. No row means nobody has decided — an empty trail, not a failure.
        triage.findByOrgIdAndReviewId(orgId, review.getId())
                .map(ReviewTriage::getId)
                .map(triageAudit::findAllByReviewTriageIdOrderByCreatedAtAsc)
                .orElse(List.of())
                .forEach(row -> entries.add(new ReviewDecisionLogEntryView(
                        ReviewDecisionLogKind.ACTION_CHOSEN.name(),
                        row.getDispositionFrom() == null ? null : row.getDispositionFrom().name(),
                        row.getDispositionTo().name(),
                        row.getCreatedAt())));

        for (TriageAction row : actions.findByReviewIdOrderByActedAtDesc(review.getId())) {
            if (!orgId.equals(row.getOrgId())) {
                continue;
            }
            entries.add(new ReviewDecisionLogEntryView(
                    ReviewDecisionLogKind.ACTION_RECORDED.name(), null, row.getKind().name(), row.getActedAt()));
        }

        approvals.findByOrgIdAndReviewId(orgId, review.getId())
                .map(ReviewReplyApproval::getId)
                .map(id -> approvalAudit.findAllByReviewReplyApprovalIdOrderByCreatedAtAsc(id))
                .orElse(List.of())
                .forEach(row -> entries.add(new ReviewDecisionLogEntryView(
                        ReviewDecisionLogKind.REPLY_APPROVAL.name(),
                        row.getStateFrom() == null ? null : row.getStateFrom().name(),
                        row.getStateTo().name(),
                        row.getCreatedAt())));

        for (ReviewReplyOutcome row : outcomes.findAllByOrgIdAndReviewIdOrderByCreatedAtDesc(orgId, review.getId())) {
            entries.add(new ReviewDecisionLogEntryView(
                    ReviewDecisionLogKind.REPLY_OUTCOME.name(), null,
                    outcomeName(row.getOperatorOutcome()), row.getCreatedAt()));
        }

        entries.sort(Comparator.comparing(ReviewDecisionLogEntryView::at,
                Comparator.nullsLast(Comparator.reverseOrder())));
        return entries.size() <= MAX_LOG_ENTRIES ? List.copyOf(entries)
                : List.copyOf(entries.subList(0, MAX_LOG_ENTRIES));
    }

    private static String outcomeName(OperatorOutcome outcome) {
        return outcome == null ? null : outcome.name();
    }

    /**
     * The repeated problems this review is recorded evidence for, each with what else said the same.
     *
     * <p>The links are this review's own — the extractor's attribution, not a resemblance judged here.
     * A review that backs nothing yields an empty list, and the screen states that as a fact about our
     * records rather than as «this has never happened before».
     */
    private List<ReviewDecisionContextView.RepeatedProblem> repeatedProblems(UUID orgId, Review review) {
        List<ReviewIssueEvidence> links = issueEvidence.findByOrgIdAndReviewId(orgId, review.getId());
        if (links.isEmpty()) {
            return List.of();
        }
        // One row per issue: a review with two opinion units on the same problem is that problem once.
        Map<UUID, ReviewIssueEvidence> byIssue = new LinkedHashMap<>();
        for (ReviewIssueEvidence link : links) {
            byIssue.putIfAbsent(link.getIssueId(), link);
        }
        Map<UUID, ReviewIssue> found = new HashMap<>();
        for (ReviewIssue issue : issues.findByOrgIdAndIdIn(orgId, byIssue.keySet())) {
            found.put(issue.getId(), issue);
        }
        List<ReviewDecisionContextView.RepeatedProblem> out = new ArrayList<>();
        for (UUID issueId : byIssue.keySet()) {
            ReviewIssue issue = found.get(issueId);
            if (issue == null) {
                continue;
            }
            out.add(new ReviewDecisionContextView.RepeatedProblem(
                    issue.getId(),
                    issue.getTitle(),
                    issue.getSeverity() == null ? null : issue.getSeverity().name(),
                    issue.getLifecycleState() == null ? null : issue.getLifecycleState().name(),
                    issueEvidence.countByOrgIdAndIssueId(orgId, issue.getId()),
                    issue.getFirstEvidenceOn(),
                    issue.getLastEvidenceOn(),
                    issue.isDismissed(),
                    similar(orgId, issue.getId(), review)));
            if (out.size() == MAX_PROBLEMS) {
                break;
            }
        }
        return List.copyOf(out);
    }

    /**
     * Other reviews recorded as evidence for the same problem — never this one.
     *
     * <p>Read one page larger than the cap so excluding this review cannot silently return fewer than
     * asked for, and cut to the cap afterwards.
     */
    private List<ReviewDecisionContextView.SimilarReview> similar(UUID orgId, UUID issueId, Review subject) {
        List<ReviewIssueEvidence> rows = issueEvidence.findByOrgIdAndIssueIdOrderByOccurredOnDesc(
                orgId, issueId, PageRequest.of(0, MAX_SIMILAR_PER_PROBLEM + 1));
        List<UUID> reviewIds = rows.stream()
                .map(ReviewIssueEvidence::getReviewId)
                .filter(id -> !id.equals(subject.getId()))
                .distinct()
                .toList();
        if (reviewIds.isEmpty()) {
            return List.of();
        }
        Map<UUID, Review> byId = new HashMap<>();
        for (Review row : reviews.findAllById(reviewIds)) {
            byId.put(row.getId(), row);
        }
        List<UUID> productIds = rows.stream()
                .map(ReviewIssueEvidence::getProductId).filter(Objects::nonNull).distinct().toList();
        Map<UUID, String> productNames = new HashMap<>();
        if (!productIds.isEmpty()) {
            for (Product product : products.findAllByOrgIdAndIdIn(orgId, productIds)) {
                productNames.put(product.getId(), product.getName());
            }
        }
        List<ReviewDecisionContextView.SimilarReview> out = new ArrayList<>();
        for (ReviewIssueEvidence row : rows) {
            if (row.getReviewId().equals(subject.getId())) {
                continue;
            }
            Review other = byId.get(row.getReviewId());
            out.add(new ReviewDecisionContextView.SimilarReview(
                    row.getReviewId(),
                    row.getOccurredOn(),
                    other == null ? null : other.getRating(),
                    IssueEvidenceQuote.of(other, row.getUnitOrdinal()),
                    row.getProductId() == null ? null : productNames.get(row.getProductId()),
                    row.getProductId() != null && row.getProductId().equals(subject.getProductId())));
            if (out.size() == MAX_SIMILAR_PER_PROBLEM) {
                break;
            }
        }
        return List.copyOf(out);
    }

    /**
     * This product's own review volume, or null when the review resolves to no product.
     *
     * <p>Null rather than zeros: «this product has no other reviews» and «this review is not bound to
     * a product» are different statements, and printing 0건 for the second would be the screen
     * answering a question nobody could ask.
     */
    private ReviewDecisionContextView.ProductSignal signalOf(UUID orgId, Product product) {
        if (product == null) {
            return null;
        }
        return new ReviewDecisionContextView.ProductSignal(
                reviews.countByOrgIdAndProductId(orgId, product.getId()),
                reviews.countByOrgIdAndProductIdAndNegativeTrue(orgId, product.getId()));
    }

    /**
     * What is written down that a reply could stand on — counts, a few titles, and what is still being
     * asked.
     *
     * <p>Active sources only. A retired document cannot ground anything, so counting it would tell the
     * seller they have knowledge the drafter cannot see.
     */
    private ReviewDecisionContextView.KnowledgeOnHand knowledgeOnHand(UUID orgId, Product product) {
        long orgSources = orgKnowledge.countByOrgIdAndActiveTrue(orgId);
        if (product == null) {
            return new ReviewDecisionContextView.KnowledgeOnHand(0, orgSources, List.of(), 0);
        }
        List<String> titles = productKnowledge
                .findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, product.getId()).stream()
                .filter(ProductKnowledgeSource::isActive)
                .map(ProductKnowledgeSource::getTitle)
                .limit(MAX_KNOWLEDGE_TITLES)
                .toList();
        return new ReviewDecisionContextView.KnowledgeOnHand(
                productKnowledge.countByOrgIdAndProductIdAndActiveTrue(orgId, product.getId()),
                orgSources,
                titles,
                candidates.countByOrgIdAndProductIdAndState(orgId, product.getId(),
                        KnowledgeCandidateService.STATE_OPEN));
    }

    /** The same scoping {@code ChannelReviewService.detail} uses — org, then the account's channel. */
    private Review requireReview(UUID orgId, UUID accountId, UUID reviewId) {
        SellerAccount account = accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        return reviews.findByIdAndOrgId(reviewId, orgId)
                .filter(r -> account.getChannelId().equals(r.getChannelId()))
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));
    }
}
