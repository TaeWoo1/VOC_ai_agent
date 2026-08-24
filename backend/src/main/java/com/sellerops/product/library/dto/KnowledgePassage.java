package com.sellerops.product.library.dto;

import com.sellerops.product.library.KnowledgeSourceType;
import java.time.Instant;
import java.util.UUID;

/**
 * One retrieved passage, with everything needed to attribute it.
 *
 * <p><b>The provenance travels with the text, always.</b> A passage separated from who wrote it, when,
 * and under what kind of document is a sentence with no owner — and a sentence with no owner is
 * exactly what the Evidence Judge has to refuse. {@code score} is carried so a caller can see how
 * weak the best match was rather than inferring confidence from the fact that something came back.
 */
public record KnowledgePassage(UUID sourceId, UUID chunkId, KnowledgeSourceType sourceType,
                               String title, String content, int ordinal, double score,
                               String authorName, String sourceUrl, Instant updatedAt) {
}
