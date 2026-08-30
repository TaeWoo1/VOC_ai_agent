package com.sellerops.product.library.dto;

import com.sellerops.knowledge.RetrievalOutcome;
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
                                      int passagesSearched, List<KnowledgePassage> passages,
                                      RetrievalOutcome outcome, int rejectedNotApplicable,
                                      int candidatesTried) {

    /** The pre-outcome shape: derives the outcome from the counts, as every caller used to. */
    public KnowledgeSearchResponse(UUID productId, String query, int documentsSearched,
                                   int passagesSearched, List<KnowledgePassage> passages) {
        this(productId, query, documentsSearched, passagesSearched, passages,
                documentsSearched == 0 ? RetrievalOutcome.ABSENT
                        : passages.isEmpty() ? RetrievalOutcome.NO_RELEVANT_EVIDENCE : RetrievalOutcome.FOUND,
                0, 1);
    }
}
