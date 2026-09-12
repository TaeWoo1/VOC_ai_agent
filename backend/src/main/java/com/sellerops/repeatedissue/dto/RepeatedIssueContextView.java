package com.sellerops.repeatedissue.dto;

import com.sellerops.reviewissue.dto.IssueEvidenceSummaryView;
import java.util.List;
import java.util.UUID;

/**
 * What the Repeated Issue workspace shows about ONE repeated problem beyond the problem itself —
 * where it repeats, against what, and what this company has already written about it.
 *
 * <p><b>Why this is a separate read and not more fields on the issue.</b> The issue detail read
 * answers 「what is this problem and what was said」; this answers 「how big is it where it happens,
 * and do we already have an answer」. They fail independently — a screen that could not read the
 * library still has an evidence list worth showing — and merging them would make one failure hide
 * the other.
 *
 * <p><b>Nothing here is computed by a model, and nothing new is judged.</b> The per-product roll-up
 * is {@link IssueEvidenceSummaryView}, reused whole rather than re-tallied, so the number the agent
 * reads and the number the screen prints come from one place. The knowledge answer is
 * {@code KnowledgeMentionCheck}, the same deterministic aspect-word read the improvement lane
 * already makes on this screen — it is surfaced here rather than left implicit inside a suggestion.
 *
 * <p><b>There is no write on this surface.</b> The seller's decision about a repeated problem is the
 * issue lifecycle, and {@code ReviewIssueController} has owned those four transitions since the
 * lifecycle existed. A second door onto the same decision is a second thing that can disagree with
 * the first.
 */
public record RepeatedIssueContextView(
        UUID issueId,
        /** The issue's aspect ({@code 배송}, {@code 접착}, …) — the word the knowledge read matched on. */
        String aspect,
        /**
         * The per-product roll-up, reused whole. Its {@code byProduct} rows now carry the product's
         * own review total beside the evidence count, which is what makes 「어디서 얼마나」 answerable
         * without a second read that could describe a different population.
         */
        IssueEvidenceSummaryView evidence,
        /** What this company has already written down that speaks to this problem. */
        KnowledgeOnHand knowledge) {

    /**
     * The seller's own library, asked one question: does anything we have written name this problem?
     *
     * <p><b>Counts and the seller's own sentences — never a judgement about whether the answer is
     * good.</b> Whether a registered guidance actually answers a customer is the drafting lane's
     * question and it costs model calls; this block only says what exists.
     *
     * <p><b>{@code productId} names WHICH library was read.</b> An issue has no product column — it is
     * org-wide by construction — so the product lane reads the issue's dominant product, the same one
     * the list screen prints. When evidence resolves to no product at all, there is no product library
     * to read and the fields are null/zero rather than an org answer wearing a product's name.
     */
    public record KnowledgeOnHand(
            UUID productId,
            String productName,
            /** Active sources in that product's library, and how many name this aspect. */
            int productSources,
            int productMentions,
            /** Active company rules, and how many name this aspect. */
            int orgSources,
            int orgMentions,
            /**
             * The seller's own sentences that named it, bounded. Empty when nothing did — which is a
             * statement about the library, not about whether an answer is possible.
             */
            List<String> excerpts) {
    }
}
