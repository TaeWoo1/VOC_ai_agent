package com.sellerops.product.library.dto;

import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.KnowledgeSourceType;
import java.time.Instant;
import java.util.UUID;

/**
 * A knowledge document as the seller sees it in the library.
 *
 * <p>{@code variantId} says which 규격 this document is about; null is 전체 상품 공통.
 * {@code variantName} is that variant's option name, denormalized for display only — the binding is
 * the id.
 *
 * <p>{@code chunks} is shown because it is what retrieval can actually reach: a document saved but
 * split into zero passages is a document the Agent will never quote, and the seller should be able to
 * see that without asking.
 */
public record KnowledgeSourceView(UUID id, UUID productId, KnowledgeSourceType sourceType,
                                  String title, String body, String sourceUrl,
                                  String authorName, int chunks,
                                  Instant createdAt, Instant updatedAt,
                                  KnowledgeAuthorship authoredOrigin,
                                  UUID variantId, String variantName) {

    /** The scope as a seller reads it. One sentence, and the default says the common case out loud. */
    public String scopeKo() {
        return variantId == null ? "전체 상품 공통"
                : variantName == null || variantName.isBlank() ? "특정 규격" : variantName;
    }
}
