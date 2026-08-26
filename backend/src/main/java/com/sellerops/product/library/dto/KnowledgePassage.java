package com.sellerops.product.library.dto;

import com.sellerops.product.library.KnowledgeAuthorship;
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
 *
 * <p>{@code variantName} is non-null only when the document it came from is scoped to one 규격. The
 * drafter is told, in one line, that some of its evidence is option-specific — which is a different
 * caution from 「어떤 규격인지 모른다」 and has to be able to travel separately from it.
 */
public record KnowledgePassage(UUID sourceId, UUID chunkId, KnowledgeSourceType sourceType,
                               String title, String content, int ordinal, double score,
                               String authorName, String sourceUrl, Instant updatedAt,
                               KnowledgeAuthorship authoredOrigin, String variantName) {

    /**
     * Back-compat for callers written before authorship existed. Defaults to the kind every passage
     * was until 2026-08-26 — a person typed it — which is what those callers already assumed.
     */
    public KnowledgePassage(UUID sourceId, UUID chunkId, KnowledgeSourceType sourceType,
                            String title, String content, int ordinal, double score,
                            String authorName, String sourceUrl, Instant updatedAt) {
        this(sourceId, chunkId, sourceType, title, content, ordinal, score, authorName, sourceUrl,
                updatedAt, KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE, null);
    }

    public KnowledgePassage(UUID sourceId, UUID chunkId, KnowledgeSourceType sourceType,
                            String title, String content, int ordinal, double score,
                            String authorName, String sourceUrl, Instant updatedAt,
                            KnowledgeAuthorship authoredOrigin) {
        this(sourceId, chunkId, sourceType, title, content, ordinal, score, authorName, sourceUrl,
                updatedAt, authoredOrigin, null);
    }
}
