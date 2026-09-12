package com.sellerops.repeatedissue;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.opportunity.KnowledgeMention;
import com.sellerops.opportunity.KnowledgeMentionCheck;
import com.sellerops.opportunity.OpportunityRules;
import com.sellerops.repeatedissue.dto.RepeatedIssueContextView;
import com.sellerops.reviewissue.ReviewIssueQueryService;
import com.sellerops.reviewissue.dto.IssueEvidenceSummaryView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Repeated Issue workspace's second read — <b>a reader, not a new truth.</b>
 *
 * <p>Every number it returns is already owned somewhere: the per-product roll-up by
 * {@link ReviewIssueQueryService#evidenceSummary}, the review denominator by {@code ReviewRepository},
 * the aspect vocabulary by {@code IssueVocabulary}, and the library answer by
 * {@link KnowledgeMentionCheck}. This class chooses WHICH product's library to ask about and puts the
 * two together; it tallies nothing itself, so there is no second copy of a count to drift.
 *
 * <p><b>It lives outside {@code reviewissue} on purpose.</b> It needs both the issue package and the
 * improvement lane's library check, and {@code opportunity} already depends on {@code reviewissue} —
 * putting this read inside {@code reviewissue} would point that dependency both ways. Nothing depends
 * on this package, which is the property that keeps the cycle from existing.
 *
 * <p><b>Zero model calls.</b> Opening a repeated problem must not cost a vendor round trip: the two
 * retrieval stages are model calls made afresh on every search, and a workspace that ran them at open
 * would charge a seller for passages nobody asked to quote. What the library HAS is a deterministic
 * word match; what it can GROUND is the drafter's question, asked where a draft is written.
 */
@Service
public class RepeatedIssueWorkspaceService {

    private final ReviewIssueQueryService query;
    private final KnowledgeMentionCheck knowledge;

    public RepeatedIssueWorkspaceService(ReviewIssueQueryService query, KnowledgeMentionCheck knowledge) {
        this.query = query;
        this.knowledge = knowledge;
    }

    /**
     * @param referenceDate the day the change judgement is evaluated against — passed through to the
     *                      issue read so this surface and the list cannot be looking at two different
     *                      "today"s.
     */
    @Transactional(readOnly = true)
    public RepeatedIssueContextView context(UUID orgId, UUID issueId, LocalDate referenceDate) {
        // Both reads are org-scoped and both throw the same "이슈를 찾을 수 없습니다." for an id that is
        // missing OR another org's — an id from elsewhere cannot be told apart from one that never
        // existed, so this surface cannot be used to probe.
        ReviewIssueView issue = query.issueView(orgId, issueId, referenceDate);
        IssueEvidenceSummaryView evidence = query.evidenceSummary(orgId, issueId);
        return new RepeatedIssueContextView(
                issueId, issue.aspect(), evidence, knowledgeFor(orgId, issue));
    }

    /**
     * Ask the seller's library about this problem — the product's own shelf and the company's rules.
     *
     * <p>Which company rule type counts is {@link OpportunityRules#guidanceTargetOf}, reused as the
     * pure function it is rather than re-decided here. It is worth reusing rather than passing null:
     * it carries a measured correction — 「배송 파손」 is a customer holding a broken product, so the
     * rule that answers them is the exchange/refund one and not the shipping one. Deciding that a
     * second time here is how the two surfaces would come to disagree about which rule answers a
     * problem.
     */
    private RepeatedIssueContextView.KnowledgeOnHand knowledgeFor(UUID orgId, ReviewIssueView issue) {
        OpportunityRules.GuidanceTarget target = OpportunityRules.guidanceTargetOf(issue);
        OrgKnowledgeType orgType = target == null ? null : target.orgType();

        KnowledgeMention org = knowledge.org(orgId, issue.aspect(), orgType);

        UUID productId = issue.dominantProductId();
        if (productId == null) {
            // No product resolved for this issue's evidence, so there is no product shelf to read.
            // Zeroes here mean 「we read no product library」, and the surface says that rather than
            // reporting the company's answer under a product's name.
            return new RepeatedIssueContextView.KnowledgeOnHand(
                    null, null, 0, 0, org.sources(), org.mentions(), org.excerpts());
        }
        KnowledgeMention product = knowledge.product(orgId, productId, issue.aspect());
        // The product's own sentences lead: a repeated problem on one product is answered from that
        // product's shelf before it is answered from a company-wide rule.
        List<String> excerpts = java.util.stream.Stream
                .concat(product.excerpts().stream(), org.excerpts().stream())
                .distinct()
                .limit(EXCERPTS)
                .toList();
        return new RepeatedIssueContextView.KnowledgeOnHand(
                productId, issue.dominantProductName(),
                product.sources(), product.mentions(),
                org.sources(), org.mentions(), excerpts);
    }

    /** Enough to show that something is written, never enough to reprint the library. */
    private static final int EXCERPTS = 3;
}
