package com.sellerops.product.library;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import com.sellerops.product.library.dto.KnowledgeSourceView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The seller's own product knowledge: write it, keep it quotable, find the part that answers a question.
 *
 * <p><b>Indexing is not a background job.</b> A document's passages are rebuilt inside the same
 * transaction that saves it, so the library is never in a state where a seller has saved something the
 * Agent cannot see. There is no queue to drain and no staleness to explain.
 *
 * <p><b>Retrieval may return nothing, and that is a result.</b> Below {@link #MIN_TOPIC_COVERAGE} the passages
 * are dropped rather than ranked, because handing back the least-bad paragraph is how a grounded
 * answer quietly becomes a guess with a citation attached.
 */
@Service
public class ProductKnowledgeLibraryService {

    /**
     * The thresholds live in {@link KnowledgeRetriever}, not here.
     *
     * <p>They used to live in this class, when this was the only corpus anyone searched. It is not:
     * the seller's operating policy and their past answers are searched by the same scorer, and a
     * floor that means one thing for a product's notes and another for a shipping policy is a floor
     * nobody can reason about. Moving them was the point of extracting the retriever.
     */
    /** Passages per answer. More than this is not grounding; it is pasting the document back. */
    static final int MAX_PASSAGES = 5;

    private final ProductRepository products;
    private final ProductKnowledgeSourceRepository sources;
    private final ProductKnowledgeChunkRepository chunks;
    private final ProductKnowledgeIndexer indexer;

    public ProductKnowledgeLibraryService(ProductRepository products,
                                          ProductKnowledgeSourceRepository sources,
                                          ProductKnowledgeChunkRepository chunks) {
        this.products = products;
        this.sources = sources;
        this.chunks = chunks;
        this.indexer = new ProductKnowledgeIndexer(chunks);
    }

    @Transactional(readOnly = true)
    public List<KnowledgeSourceView> list(UUID orgId, UUID productId) {
        requireProduct(orgId, productId);
        Map<UUID, Integer> chunkCounts = new HashMap<>();
        for (ProductKnowledgeChunk chunk : chunks.findAllByOrgIdAndProductId(orgId, productId)) {
            chunkCounts.merge(chunk.getSourceId(), 1, Integer::sum);
        }
        return sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                .map(source -> view(source, chunkCounts.getOrDefault(source.getId(), 0)))
                .toList();
    }

    @Transactional
    public KnowledgeSourceView create(UUID orgId, UUID productId, KnowledgeSourceRequest request,
                                      UUID authorUserId, String authorName) {
        requireProduct(orgId, productId);
        ProductKnowledgeSource source = new ProductKnowledgeSource();
        source.setOrgId(orgId);
        source.setProductId(productId);
        source.setAuthorUserId(authorUserId);
        source.setAuthorName(authorName);
        apply(source, request);
        ProductKnowledgeSource saved = sources.save(source);
        int count = reindex(saved);
        return view(saved, count);
    }

    @Transactional
    public KnowledgeSourceView update(UUID orgId, UUID sourceId, KnowledgeSourceRequest request) {
        ProductKnowledgeSource source = sources.findByIdAndOrgId(sourceId, orgId)
                .orElseThrow(() -> ApiException.notFound("지식 문서를 찾을 수 없습니다."));
        apply(source, request);
        ProductKnowledgeSource saved = sources.save(source);
        int count = reindex(saved);
        return view(saved, count);
    }

    @Transactional
    public void delete(UUID orgId, UUID sourceId) {
        ProductKnowledgeSource source = sources.findByIdAndOrgId(sourceId, orgId)
                .orElseThrow(() -> ApiException.notFound("지식 문서를 찾을 수 없습니다."));
        chunks.deleteAllBySourceId(source.getId());
        sources.delete(source);
    }

    /**
     * The passages of this product that best cover the question.
     *
     * <p>Scoped to one product because that is the only scope in which "the corpus is small" is a
     * structural fact rather than a hope. The caller resolves the product first; this method never
     * guesses one.
     */
    @Transactional(readOnly = true)
    public KnowledgeSearchResponse search(UUID orgId, UUID productId, String query, int limit) {
        Product product = requireProduct(orgId, productId);
        List<ProductKnowledgeSource> documents =
                sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId);
        List<ProductKnowledgeChunk> corpus = chunks.findAllByOrgIdAndProductId(orgId, productId);

        Map<UUID, ProductKnowledgeSource> byId = new HashMap<>();
        documents.forEach(d -> byId.put(d.getId(), d));

        // <b>The title is part of the passage for matching.</b> A seller puts the topic in the title
        // ("교환 및 반품 안내") and then never repeats it in the body, so a passage judged on its body
        // alone loses the one word its document is about.
        List<KnowledgeRetriever.Candidate<ProductKnowledgeChunk>> candidates = new ArrayList<>();
        for (ProductKnowledgeChunk chunk : corpus) {
            ProductKnowledgeSource source = byId.get(chunk.getSourceId());
            // A chunk whose document the read filter excluded (a seeded note in a real deployment)
            // is skipped rather than quoted with no attribution.
            if (source != null) {
                candidates.add(new KnowledgeRetriever.Candidate<>(chunk,
                        KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized()));
            }
        }
        // The product's own name is handed in because it distinguishes no passage in its own library
        // and must not be able to admit one: a question that names the product would otherwise score
        // against every document that repeats the title.
        List<KnowledgePassage> hits = new ArrayList<>();
        for (KnowledgeRetriever.Hit<ProductKnowledgeChunk> hit
                : KnowledgeRetriever.rank(query, candidates, product.getName())) {
            ProductKnowledgeChunk chunk = hit.ref();
            ProductKnowledgeSource source = byId.get(chunk.getSourceId());
            hits.add(new KnowledgePassage(source.getId(), chunk.getId(), source.getSourceType(),
                    source.getTitle(), chunk.getContent(), chunk.getOrdinal(),
                    round(hit.coverage()), source.getAuthorName(), source.getSourceUrl(),
                    source.getUpdatedAt(),
                    source.getAuthoredOrigin()));
        }
        hits.sort(Comparator.comparingDouble(KnowledgePassage::score).reversed()
                // Ties resolve by document order, not by whatever the map iterated — an answer that
                // cites a different passage on every identical run is not reproducible evidence.
                .thenComparing(KnowledgePassage::title)
                .thenComparingInt(KnowledgePassage::ordinal));
        int cap = Math.max(1, Math.min(limit <= 0 ? MAX_PASSAGES : limit, MAX_PASSAGES));
        return new KnowledgeSearchResponse(productId, query, documents.size(), corpus.size(),
                hits.size() > cap ? List.copyOf(hits.subList(0, cap)) : List.copyOf(hits));
    }

    /** Rebuild one document's passages, through the collaborator every writer shares. */
    private int reindex(ProductKnowledgeSource source) {
        return indexer.index(source);
    }

    private void apply(ProductKnowledgeSource source, KnowledgeSourceRequest request) {
        source.setSourceType(request.sourceType());
        source.setTitle(request.title().strip());
        source.setBody(request.body().strip());
        String url = request.sourceUrl() == null || request.sourceUrl().isBlank()
                ? null : request.sourceUrl().strip();
        source.setSourceUrl(url);
    }

    private Product requireProduct(UUID orgId, UUID productId) {
        return products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
    }

    private static KnowledgeSourceView view(ProductKnowledgeSource source, int chunkCount) {
        return new KnowledgeSourceView(source.getId(), source.getProductId(), source.getSourceType(),
                source.getTitle(), source.getBody(), source.getSourceUrl(), source.getAuthorName(),
                chunkCount, source.getCreatedAt(), source.getUpdatedAt(),
                source.getAuthoredOrigin());
    }

    /** Two decimals — a score is a diagnostic, and full float noise reads as false precision. */
    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
