package com.sellerops.product.library.dto;

import com.sellerops.product.library.KnowledgeSourceType;
import java.time.Instant;
import java.util.UUID;

/**
 * A knowledge document as the seller sees it in the library.
 *
 * <p>{@code chunks} is shown because it is what retrieval can actually reach: a document saved but
 * split into zero passages is a document the Agent will never quote, and the seller should be able to
 * see that without asking.
 */
public record KnowledgeSourceView(UUID id, UUID productId, KnowledgeSourceType sourceType,
                                  String title, String body, String sourceUrl,
                                  String authorName, int chunks,
                                  Instant createdAt, Instant updatedAt) {
}
