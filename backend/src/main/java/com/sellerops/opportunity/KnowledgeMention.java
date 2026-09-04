package com.sellerops.opportunity;

import java.util.List;

/**
 * What the seller's own knowledge says about one aspect — a deterministic mention check, NOT a
 * retrieval.
 *
 * <p>The question an opportunity needs answered is narrow: "has this seller written anything that
 * names this aspect, in the place a customer-facing sentence about it would live?" That is a
 * substring question over active sources with the extractor's own keywords, so it is answered by
 * reading the rows — no ranking, no threshold, no vendor call. Running the grounded retriever here
 * would spend an embedding per issue per read to answer a question a {@code contains} answers.
 *
 * @param sources active sources in the checked scope (the product's library, or the company's rules)
 * @param mentions how many of them name the aspect
 * @param excerpts up to three of the seller's own sentences that name it — the seller's words, so
 *     they may be shown back to the seller and copied into a draft
 */
public record KnowledgeMention(int sources, int mentions, List<String> excerpts) {

    public static KnowledgeMention none(int sources) {
        return new KnowledgeMention(sources, 0, List.of());
    }

    public boolean mentioned() {
        return mentions > 0;
    }
}
