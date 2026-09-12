package com.sellerops.review.decision.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Everything the Decision Workspace shows a seller BEFORE they decide — and nothing they decide with
 * is invented here.
 *
 * <p><b>Why it is one read and not five.</b> The workspace asks one question — «is this one review
 * worth my hands, and on what evidence» — and the four things that answer it (what repeats, what
 * else said the same, what this product already carries, what this company has written down) lived
 * on four different screens. A seller who wanted them had to leave the review to get each one and
 * come back without it. So they arrive together, bounded, in one org-scoped call.
 *
 * <p><b>Nothing here is computed by a model, and nothing is retrieved at open.</b> The repeated
 * problems are the extractor's own evidence links for THIS review — the same links the reply screen
 * has shown since T-01 — and the similar reviews are the other evidence rows on those same issues.
 * That is the one similarity mechanism this repository has. A second one ("reviews that look alike")
 * would be a classifier nobody measured, and a retrieval pass at open would spend a model call per
 * workspace open for a passage the draft has not asked for yet. What the drafter was actually shown
 * is on the draft, where it belongs ({@code ReviewReplyPrepView.draftEvidence}).
 *
 * <p><b>An empty list is a statement about our records, never about the world.</b> No repeated
 * problem means the extractor has not recorded this review as evidence for one; the surface says
 * that and does not say 「반복된 적 없습니다」.
 */
public record ReviewDecisionContextView(
        UUID reviewId,
        /**
         * The server-minted address of this review's DECISION — {@code review:<uuid>}, round-tripped
         * to the triage endpoint and never parsed or minted by a client.
         *
         * <p><b>It is handed out for every review the workspace can open, and that is a correction.</b>
         * The only other surface that hands out a ref is {@code ReviewReplyWorkLookup}, which is gated
         * on the channel having a REPLY flow — so on Coupang, where a seller cannot answer a 상품평, the
         * screen also could not record what they had DECIDED about one. {@code TriageDisposition}'s own
         * contract says these are different things ("recording RESPONSE_NEEDED does not draft, queue,
         * send, or promise a reply"), and the decision endpoint has never been capability-gated: it
         * authorizes on org + account + channel and nothing else. What was gated was only the address.
         */
        String decisionRef,
        /** The decision that currently stands ({@code TriageDisposition}), or null when none does. */
        String currentDecision,
        /**
         * The channel this review arrived on — so the workspace can use the channel's own word for it
         * (Coupang: 상품평) without a second read whose only purpose is to learn the code.
         */
        String channelCode,
        /** The product this review is bound to, or null when the ingest resolved none. */
        UUID productId,
        String productName,
        /** The repeated problems this review is recorded evidence for, with what else said the same. */
        List<RepeatedProblem> repeatedProblems,
        /** This product's own review counts, or null when the review resolves to no product. */
        ProductSignal productSignal,
        /** What this company has written down that a reply could be grounded in. */
        KnowledgeOnHand knowledge) {

    /**
     * One repeated problem, as the issue memory holds it.
     *
     * <p>{@code evidenceCount} is org-wide and all-time — the same number the 고객운영 메모리 list
     * means by it — so the workspace never invents a per-product denominator the read did not ask for.
     */
    public record RepeatedProblem(
            UUID issueId,
            String title,
            String severity,
            String lifecycleState,
            long evidenceCount,
            LocalDate firstEvidenceOn,
            LocalDate lastEvidenceOn,
            boolean dismissed,
            /** Other reviews recorded as evidence for the same problem. Bounded; never this review. */
            List<SimilarReview> similar) {
    }

    /**
     * One other review that backs the same problem.
     *
     * <p>{@code quote} is the opinion unit re-derived at read time and masked by
     * {@code VocPreviewSanitizer} — the same rule the issue evidence screen uses — and it is null
     * when masking suppressed it. A null renders as nothing: an empty bubble would imply the customer
     * wrote nothing.
     */
    public record SimilarReview(
            UUID reviewId,
            LocalDate occurredOn,
            Integer rating,
            String quote,
            String productName,
            /** Whether it is the same product as the review being decided. */
            boolean sameProduct) {
    }

    /**
     * The product's own review volume — the honest context for «is this one review a pattern».
     *
     * <p>Counted with the same predicate the product screen counts with, so the workspace and the
     * product page cannot print two different numbers for one word.
     */
    public record ProductSignal(long reviews, long negativeReviews) {
    }

    /**
     * What is on hand to ground a reply — counts and titles, never bodies.
     *
     * <p>Bodies are not here on purpose. This block answers «does this company have anything written
     * down about this», which is a question about the library; what a DRAFT actually stood on is the
     * draft's own citations, read back from the source at display time.
     *
     * <p>{@code openAsks} is how many 확인 필요 rows are waiting for this product — the things
     * reviewnary has already asked and nobody has answered. It is the reason a draft may say less
     * than the seller expects, and it is one click from being fixed.
     */
    public record KnowledgeOnHand(
            long productSources,
            long orgSources,
            List<String> productTitles,
            long openAsks) {
    }
}
