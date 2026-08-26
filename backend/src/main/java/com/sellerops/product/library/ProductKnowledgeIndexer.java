package com.sellerops.product.library;

import com.sellerops.knowledge.KnowledgeText;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Turn one knowledge document into the passages that are actually searchable.
 *
 * <p><b>Extracted because a writer forgot to call it.</b> Retrieval reads
 * {@code product_knowledge_chunks}, never {@code product_knowledge_sources} — so a document saved
 * without passages is a document that exists on the product screen and cannot be found by any
 * question. {@code ProductDetailEnrichment} did exactly that: it reported {@code TEXT_INDEXED} for
 * every 상세페이지 it read, and indexed nothing. The behaviour lived inside a private method of the
 * service that happens to serve the seller's own editor, so the second writer had no way to reuse it
 * and no compiler error for not doing so.
 *
 * <p>One class, one method, two callers — the editor and the channel-derived writers. A third writer
 * that forgets it will be as broken as the second one was, which is why this is a named collaborator
 * rather than a convention.
 */
@Component
public class ProductKnowledgeIndexer {

    private final ProductKnowledgeChunkRepository chunks;

    public ProductKnowledgeIndexer(ProductKnowledgeChunkRepository chunks) {
        this.chunks = chunks;
    }

    /** Rebuild one document's passages. Old passages go first, so a shortened document shrinks. */
    public int index(ProductKnowledgeSource source) {
        chunks.deleteAllBySourceId(source.getId());
        List<String> parts = KnowledgeText.chunk(source.getBody());
        List<ProductKnowledgeChunk> rows = new ArrayList<>(parts.size());
        for (int i = 0; i < parts.size(); i++) {
            ProductKnowledgeChunk chunk = new ProductKnowledgeChunk();
            chunk.setOrgId(source.getOrgId());
            chunk.setProductId(source.getProductId());
            chunk.setSourceId(source.getId());
            chunk.setOrdinal(i + 1);
            chunk.setContent(parts.get(i));
            chunk.setNormalized(KnowledgeText.normalize(parts.get(i)));
            rows.add(chunk);
        }
        chunks.saveAll(rows);
        return rows.size();
    }
}
