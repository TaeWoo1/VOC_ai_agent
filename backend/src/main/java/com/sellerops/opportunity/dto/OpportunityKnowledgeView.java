package com.sellerops.opportunity.dto;

import java.util.List;

/**
 * The knowledge half of an opportunity's basis — what the seller has already written about the aspect.
 *
 * @param scope PRODUCT (this product's library) or ORG (the company's rules); null for a product
 *     improvement review, which no sentence answers
 * @param scopeLabelKo the seller's word for that place
 * @param sources active sources in that scope
 * @param mentions how many of them name the aspect
 * @param excerpts the seller's own sentences that do, bounded
 * @param type the stored knowledge type an accepted draft would be filed under — a
 *     {@code KnowledgeSourceType} for PRODUCT, an {@code OrgKnowledgeType} for ORG — so the screen never
 *     guesses the destination from the aspect
 * @param topicLabelKo what the guidance is about, in the seller's words (the rule's name, or the aspect)
 */
public record OpportunityKnowledgeView(String scope, String scopeLabelKo, String type, String topicLabelKo,
                                       int sources, int mentions, List<String> excerpts) {
}
