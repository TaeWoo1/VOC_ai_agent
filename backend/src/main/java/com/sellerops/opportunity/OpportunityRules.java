package com.sellerops.opportunity;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.product.library.KnowledgeSourceType;
import com.sellerops.reviewissue.IssueLifecycleState;
import com.sellerops.reviewissue.ReviewIssueThresholds;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Which opportunities one repeated problem yields — a closed table over the issue extractor's own
 * closed vocabulary ({@code IssueVocabulary}: aspect × problem), evaluated deterministically.
 *
 * <p><b>No model, no cause.</b> The table says where a seller CAN act about an aspect (their FAQ,
 * their detail page, their operating rules, their product); the issue's evidence says the problem
 * repeats; the seller's own knowledge says whether they have already written anything about the
 * aspect. Those three facts are all an opportunity is made of. Nothing here decides why customers
 * complained or what an action will achieve, and the sentences a seller reads are written to hold
 * that line ({@link OpportunityDraftComposer}).
 *
 * <p><b>Two lanes, at most one opportunity each.</b> The GUIDANCE lane is "something the seller can
 * tell customers" and exists only for aspects a sentence can help with; the PRODUCT lane is "the
 * thing itself keeps failing" and exists only for problems that are about the product's condition.
 * 접착 × 탈락 yields both: an FAQ about attachment and a review of the adhesive. 포장 × 파손 yields
 * only the second — no sentence to a customer fixes a crushed box.
 *
 * <p><b>The repeat gate is the extractor's own.</b> {@link ReviewIssueThresholds#NEW_MIN_EVIDENCE}
 * is the number below which one review is not an issue; an opportunity over fewer rows would be a
 * suggestion resting on a coincidence.
 */
public final class OpportunityRules {

    /** Where a guidance opportunity lands, and under which stored type the seller would file it. */
    public record GuidanceTarget(Scope scope, KnowledgeSourceType productType, OrgKnowledgeType orgType) {
        public static GuidanceTarget product(KnowledgeSourceType type) {
            return new GuidanceTarget(Scope.PRODUCT, type, null);
        }

        public static GuidanceTarget org(OrgKnowledgeType type) {
            return new GuidanceTarget(Scope.ORG, null, type);
        }
    }

    public enum Scope { PRODUCT, ORG }

    /** A derived opportunity before the seller's decision is joined. */
    public record Candidate(OpportunityKind kind, Lane lane, GuidanceTarget target) {
    }

    public enum Lane { GUIDANCE, PRODUCT }

    /** Aspects a customer-facing sentence can help with, and where that sentence belongs. */
    private static final Map<String, GuidanceTarget> GUIDANCE_OF = Map.of(
            "배송", GuidanceTarget.org(OrgKnowledgeType.SHIPPING_POLICY),
            "접착", GuidanceTarget.product(KnowledgeSourceType.USAGE),
            "설치", GuidanceTarget.product(KnowledgeSourceType.USAGE),
            "설명", GuidanceTarget.product(KnowledgeSourceType.USAGE),
            "표면", GuidanceTarget.product(KnowledgeSourceType.DESCRIPTION),
            "색상", GuidanceTarget.product(KnowledgeSourceType.DESCRIPTION),
            "크기", GuidanceTarget.product(KnowledgeSourceType.DESCRIPTION));

    /** Problems that are about the product's condition — the thing itself, not what was said about it. */
    private static final Set<String> PRODUCT_CONDITION_PROBLEMS =
            Set.of("파손", "결함", "균열", "탈락", "부족", "오염");

    /** "It was not what I expected" — the one problem whose guidance is always the detail page. */
    private static final String MISMATCH = "불일치";
    /** "It was hard to use/install" — guidance wherever it lands is a usage note. */
    private static final String DIFFICULTY = "난이도";

    private OpportunityRules() {
    }

    /** Whether the issue is one an opportunity may be derived from at all. */
    public static boolean qualifies(ReviewIssueView issue) {
        if (issue.dismissed()) {
            return false;
        }
        if (IssueLifecycleState.RESOLVED.name().equals(issue.lifecycleState())) {
            return false;
        }
        return issue.evidenceCount() >= ReviewIssueThresholds.NEW_MIN_EVIDENCE;
    }

    /**
     * The candidates for one issue, given whether the seller's knowledge already mentions the aspect.
     *
     * @param aspectMentioned whether the seller's own knowledge (product library for a PRODUCT-scoped
     *     guidance, the company's rules for an ORG-scoped one) already says something about the aspect
     */
    public static List<Candidate> derive(ReviewIssueView issue, boolean aspectMentioned) {
        List<Candidate> out = new ArrayList<>(2);
        if (!qualifies(issue)) {
            return out;
        }
        boolean hasProduct = issue.dominantProductId() != null;

        GuidanceTarget target = guidanceTargetOf(issue);
        if (target != null && (target.scope() == Scope.ORG || hasProduct)) {
            out.add(new Candidate(guidanceKindOf(issue, target, aspectMentioned), Lane.GUIDANCE, target));
        }
        if (hasProduct && PRODUCT_CONDITION_PROBLEMS.contains(issue.problem())) {
            out.add(new Candidate(OpportunityKind.PRODUCT_IMPROVEMENT_REVIEW, Lane.PRODUCT, null));
        }
        return out;
    }

    /** Where a customer-facing sentence about this issue would go, or null when none helps. */
    public static GuidanceTarget guidanceTargetOf(ReviewIssueView issue) {
        GuidanceTarget byAspect = GUIDANCE_OF.get(issue.aspect());
        // 배송 × 파손/결함/… is not a question about WHEN things ship — it is a customer holding a broken
        // product, and the rule that answers them is the exchange/refund one. Measured on the demo org
        // (2026-09-04): 「배송 파손」 15 rows would otherwise have been filed under the shipping rule.
        if (byAspect != null && byAspect.scope() == Scope.ORG && PRODUCT_CONDITION_PROBLEMS.contains(issue.problem())) {
            return GuidanceTarget.org(OrgKnowledgeType.EXCHANGE_REFUND_POLICY);
        }
        if (DIFFICULTY.equals(issue.problem())) {
            // 「어렵다」 is answered by a usage note whatever it was about — unless the aspect is the
            // company's (배송), where the note is a rule.
            return byAspect != null && byAspect.scope() == Scope.ORG ? byAspect
                    : GuidanceTarget.product(KnowledgeSourceType.USAGE);
        }
        if (MISMATCH.equals(issue.problem())) {
            return byAspect != null && byAspect.scope() == Scope.ORG ? byAspect
                    : GuidanceTarget.product(KnowledgeSourceType.DESCRIPTION);
        }
        return byAspect;
    }

    private static OpportunityKind guidanceKindOf(ReviewIssueView issue, GuidanceTarget target,
                                                  boolean aspectMentioned) {
        if (target.scope() == Scope.ORG) {
            return OpportunityKind.OPERATING_POLICY_SUPPLEMENT;
        }
        if (MISMATCH.equals(issue.problem())) {
            return OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT;
        }
        // Nothing written yet ⇒ the FAQ is empty on this aspect. Something written ⇒ the seller
        // already knows the answer, and the question is whether customers see it before buying.
        return aspectMentioned ? OpportunityKind.PRODUCT_GUIDE_SUPPLEMENT : OpportunityKind.FAQ_SUPPLEMENT;
    }
}
