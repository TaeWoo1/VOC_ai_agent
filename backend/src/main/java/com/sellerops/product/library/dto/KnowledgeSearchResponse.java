package com.sellerops.product.library.dto;

import java.util.List;
import java.util.UUID;

/**
 * What a retrieval attempt found — and, when it found nothing, why that is not "이 상품에는 그런 게
 * 없습니다".
 *
 * <p>{@code documentsSearched} separates the two absences that matter: a product with no knowledge
 * documents at all ({@code 0}) versus a product with documents none of which mention the question.
 * Collapsing them would let an answer report a gap in the library as a fact about the product.
 */
public record KnowledgeSearchResponse(UUID productId, String query, int documentsSearched,
                                      int passagesSearched, List<KnowledgePassage> passages) {
}
