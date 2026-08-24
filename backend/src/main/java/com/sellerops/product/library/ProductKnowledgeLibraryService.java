package com.sellerops.product.library;

import com.sellerops.common.ApiException;
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
     * How much of the askable question a passage must cover to be offered as grounding.
     *
     * <p>A RANKING floor, and only that. Its denominator is the same for every passage of one search
     * ({@code Weighing.askableWeight}), so unlike the measure it replaced it cannot admit a passage by
     * shrinking — a library that knows less about a question no longer scores higher on it.
     */
    static final double MIN_TOPIC_COVERAGE = 0.4;

    /**
     * How much of the question's CONTENT words the library must have at all before any passage is
     * offered.
     *
     * <p>The absence gate, and the one that makes "우리는 그 내용을 갖고 있지 않습니다" reachable. It is
     * measured over content words only — interrogatives and the words for the product we already
     * resolved are removed first ({@link QueryWords}), which is why a well-formed question no longer
     * fails it. What remains in the denominator is the part of the question nobody wrote about, which
     * is exactly what absence means: "방수 되나요?" against a molding library is 0.0.
     */
    static final double MIN_ASKABLE_RATIO = 0.35;

    /**
     * The fewest characters of the question's own words a passage must actually share.
     *
     * <p>An absolute floor beside the ratio, because a ratio can be satisfied by one syllable when the
     * question has one content word — "폭" lands inside 폭넓은, 폭염, 폭우. Two characters is the first
     * length at which a Korean match is a word rather than a syllable, and it is checked on the
     * characters left AFTER the product's own name is discounted.
     */
    static final int MIN_MATCHED_CHARS = 2;

    /** Passages per answer. More than this is not grounding; it is pasting the document back. */
    static final int MAX_PASSAGES = 5;

    private final ProductRepository products;
    private final ProductKnowledgeSourceRepository sources;
    private final ProductKnowledgeChunkRepository chunks;

    public ProductKnowledgeLibraryService(ProductRepository products,
                                          ProductKnowledgeSourceRepository sources,
                                          ProductKnowledgeChunkRepository chunks) {
        this.products = products;
        this.sources = sources;
        this.chunks = chunks;
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
        Map<UUID, String> searchable = new HashMap<>();
        for (ProductKnowledgeChunk chunk : corpus) {
            ProductKnowledgeSource source = byId.get(chunk.getSourceId());
            if (source != null) {
                searchable.put(chunk.getId(),
                        KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized());
            }
        }
        // Rarity is measured over THIS product's corpus, so the weights answer "which part of the
        // question distinguishes one of these documents from the others". The product's own name is
        // handed in because it distinguishes none of them and must not be able to admit a passage.
        KnowledgeText.Weighing weighing =
                KnowledgeText.weigh(query, List.copyOf(searchable.values()), product.getName());

        // <b>Absence is decided once, for the question, before any passage is looked at.</b> A gate
        // applied per passage would let the best coincidence through on a question the library does
        // not cover — which is the failure this whole layer exists to prevent.
        if (weighing.askableRatio() < MIN_ASKABLE_RATIO) {
            return new KnowledgeSearchResponse(productId, query, documents.size(), corpus.size(),
                    List.of());
        }
        List<KnowledgePassage> hits = new ArrayList<>();
        for (ProductKnowledgeChunk chunk : corpus) {
            ProductKnowledgeSource source = byId.get(chunk.getSourceId());
            // A chunk whose document the read filter excluded (a seeded note in a real deployment)
            // is skipped rather than quoted with no attribution.
            if (source == null) {
                continue;
            }
            KnowledgeText.Assessment assessment = weighing.assess(searchable.get(chunk.getId()));
            if (assessment.matchedChars() < MIN_MATCHED_CHARS
                    || assessment.coverage() < MIN_TOPIC_COVERAGE) {
                continue;
            }
            hits.add(new KnowledgePassage(source.getId(), chunk.getId(), source.getSourceType(),
                    source.getTitle(), chunk.getContent(), chunk.getOrdinal(),
                    round(assessment.coverage()), source.getAuthorName(), source.getSourceUrl(),
                    source.getUpdatedAt()));
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

    /** Rebuild one document's passages. Old passages go first, so a shortened document shrinks. */
    private int reindex(ProductKnowledgeSource source) {
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
                chunkCount, source.getCreatedAt(), source.getUpdatedAt());
    }

    /** Two decimals — a score is a diagnostic, and full float noise reads as false precision. */
    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
