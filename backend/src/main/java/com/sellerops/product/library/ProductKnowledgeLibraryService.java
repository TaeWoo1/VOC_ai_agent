package com.sellerops.product.library;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.KnowledgeSemantics;
import com.sellerops.knowledge.KnowledgeEligibility;
import com.sellerops.knowledge.semantic.KnowledgeEvidenceEligibility;
import com.sellerops.knowledge.semantic.KnowledgeSemanticSearch;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductVariant;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import com.sellerops.product.library.dto.KnowledgeSourceRequest;
import com.sellerops.product.library.dto.KnowledgeSourceView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
    private final ProductVariantRepository variants;
    private final ProductKnowledgeIndexer indexer;
    private final KnowledgeSemanticSearch semanticSearch;
    private final KnowledgeEvidenceEligibility eligibility;

    public ProductKnowledgeLibraryService(ProductRepository products,
                                          ProductKnowledgeSourceRepository sources,
                                          ProductKnowledgeChunkRepository chunks,
                                          ProductVariantRepository variants) {
        this(products, sources, chunks, variants, KnowledgeSemanticSearch.disabled(),
                KnowledgeEvidenceEligibility.disabled());
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ProductKnowledgeLibraryService(ProductRepository products,
                                          ProductKnowledgeSourceRepository sources,
                                          ProductKnowledgeChunkRepository chunks,
                                          ProductVariantRepository variants,
                                          KnowledgeSemanticSearch semanticSearch,
                                          KnowledgeEvidenceEligibility eligibility) {
        this.products = products;
        this.sources = sources;
        this.chunks = chunks;
        this.variants = variants;
        this.indexer = new ProductKnowledgeIndexer(chunks);
        this.semanticSearch = semanticSearch;
        this.eligibility = eligibility;
    }

    @Transactional(readOnly = true)
    public List<KnowledgeSourceView> list(UUID orgId, UUID productId) {
        requireProduct(orgId, productId);
        Map<UUID, Integer> chunkCounts = new HashMap<>();
        for (ProductKnowledgeChunk chunk : chunks.findAllByOrgIdAndProductId(orgId, productId)) {
            chunkCounts.merge(chunk.getSourceId(), 1, Integer::sum);
        }
        Map<UUID, String> variantNames = variantNames(orgId, productId);
        return sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                .map(source -> view(source, chunkCounts.getOrDefault(source.getId(), 0),
                        variantNames.get(source.getVariantId())))
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
        apply(source, request, orgId, productId);
        ProductKnowledgeSource saved = sources.save(source);
        int count = reindex(saved);
        return view(saved, count, variantNames(orgId, productId).get(saved.getVariantId()));
    }

    @Transactional
    public KnowledgeSourceView update(UUID orgId, UUID sourceId, KnowledgeSourceRequest request) {
        ProductKnowledgeSource source = sources.findByIdAndOrgId(sourceId, orgId)
                .orElseThrow(() -> ApiException.notFound("지식 문서를 찾을 수 없습니다."));
        apply(source, request, orgId, source.getProductId());
        ProductKnowledgeSource saved = sources.save(source);
        int count = reindex(saved);
        return view(saved, count,
                variantNames(orgId, saved.getProductId()).get(saved.getVariantId()));
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
        return search(orgId, productId, query, limit, KnowledgeVariantScope.unresolved());
    }

    /**
     * The same search, restricted to the 규격 the caller has resolved.
     *
     * <p>The restriction is applied to the DOCUMENT SET before ranking, not to the results after it.
     * Filtering afterwards would let another 규격's document occupy one of the five slots and then
     * vanish, so a question with a perfectly good product-level answer could come back empty.
     */
    @Transactional(readOnly = true)
    public KnowledgeSearchResponse search(UUID orgId, UUID productId, String query, int limit,
                                          KnowledgeVariantScope scope) {
        return search(orgId, productId, RetrievalQuery.ofText(query), limit, scope);
    }

    /**
     * The search, over the bounded candidates of one question (Retrieval &amp; Grounding Correctness v1).
     *
     * <p>Each candidate is ranked by the unchanged gates; the first one that yields an APPLICABLE
     * passage answers. A lexical hit whose document is declared about another operating topic
     * ({@link KnowledgeTopic}) is counted as rejected, not returned — 「배송 기간」 does not get the
     * return policy because that policy mentions 반품 배송비. The response says which of the four
     * outcomes this was and which form of the question found it.
     */
    @Transactional(readOnly = true)
    public KnowledgeSearchResponse search(UUID orgId, UUID productId, RetrievalQuery question, int limit,
                                          KnowledgeVariantScope scope) {
        Product product = requireProduct(orgId, productId);
        List<ProductKnowledgeSource> documents =
                sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                        // A retired source stops grounding new answers (Knowledge Sources & Acquisition
                        // v1). The row stays, so citations already written still resolve; what changes
                        // is that a superseded manual can no longer be quoted to a customer.
                        .filter(ProductKnowledgeSource::isActive)
                        .filter(d -> scope.admits(d.getVariantId()))
                        .toList();
        List<ProductKnowledgeChunk> corpus = chunks.findAllByOrgIdAndProductId(orgId, productId);

        Map<UUID, ProductKnowledgeSource> byId = new HashMap<>();
        documents.forEach(d -> byId.put(d.getId(), d));
        Map<UUID, String> variantNames = variantNames(orgId, productId);

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
                        KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized(),
                        // The same passage as it reads, for the semantic lane. The lexical scorer
                        // never looks at it; a vector of text with the spacing removed is a vector
                        // of different text.
                        source.getTitle() + "\n" + chunk.getContent()));
            }
        }
        // The product's own name is handed in because it distinguishes no passage in its own library
        // and must not be able to admit one: a question that names the product would otherwise score
        // against every document that repeats the title.
        Set<KnowledgeTopic> asked = KnowledgeTopic.of(question.text());
        List<KnowledgePassage> hits = new ArrayList<>();
        int rejected = 0;
        int tried = 0;
        String matchedBy = question.full();
        // The semantic lane reads THIS list — already filtered by product, by variant scope and by
        // whether the seller retired the document — so nothing it can find is anything the lexical
        // lane could not also have been offered. Null means it could not see the whole corpus, and
        // then everything below is byte-for-byte what it was before this package.
        KnowledgeSemantics semantics = semanticSearch.forQuestion(orgId, question.full(), candidates,
                question.customerWritten());
        List<RetrievalQuery.Candidate> forms = semantics != null
                ? List.of(new RetrievalQuery.Candidate(question.full(), RetrievalQuery.Origin.FULL))
                : question.candidates();
        for (RetrievalQuery.Candidate candidate : forms) {
            tried++;
            List<KnowledgePassage> found = new ArrayList<>();
            int rejectedHere = 0;
            for (KnowledgeRetriever.Hit<ProductKnowledgeChunk> hit
                    : KnowledgeRetriever.rank(candidate.text(), candidates, product.getName(), semantics)) {
                ProductKnowledgeChunk chunk = hit.ref();
                ProductKnowledgeSource source = byId.get(chunk.getSourceId());
                // The document's declared topic comes from its title only — the body may mention
                // 배송비 inside a return policy without being about shipping.
                if (!KnowledgeTopic.applicable(asked, KnowledgeTopic.of(source.getTitle()))
                        || !KnowledgeTopic.remedyApplicable(question.text(), source.getTitle())) {
                    rejectedHere++;
                    continue;
                }
                found.add(new KnowledgePassage(source.getId(), chunk.getId(), source.getSourceType(),
                        source.getTitle(), chunk.getContent(), chunk.getOrdinal(),
                        round(hit.coverage()), source.getAuthorName(), source.getSourceUrl(),
                        source.getUpdatedAt(),
                        source.getAuthoredOrigin(), variantNames.get(source.getVariantId())));
            }
            rejected += rejectedHere;
            if (!found.isEmpty()) {
                hits = found;
                matchedBy = candidate.text();
                break;
            }
        }
        // Refusal-only, after ranking, on the passages that would have been quoted: similarity says
        // a passage is about the question's subject, and cannot say it holds the fact the answer
        // needs. Nothing it does can add a passage, and when every one is refused the outcome is
        // NO_RELEVANT_EVIDENCE — 「관련된 내용은 있지만 이 질문에 답하지 않습니다」, which is what happened.
        if (semantics != null) {
            hits = new ArrayList<>(eligibility.filter(orgId, question.full(), hits,
                    p -> p.title() + "\n" + p.content()));
        }
        RetrievalOutcome outcome = documents.isEmpty() ? RetrievalOutcome.ABSENT
                : !hits.isEmpty() ? RetrievalOutcome.FOUND
                : rejected > 0 ? RetrievalOutcome.NOT_APPLICABLE
                : RetrievalOutcome.NO_RELEVANT_EVIDENCE;
        hits.sort(Comparator.comparingDouble(KnowledgePassage::score).reversed()
                // Equal relevance: what the seller typed before what a channel page said before what
                // a model read off an image (Knowledge Context v1-A). A tie-break, not a weight — it
                // cannot lift a less relevant passage over a more relevant one.
                .thenComparingInt(p -> p.authoredOrigin() == null
                        ? Integer.MAX_VALUE : p.authoredOrigin().tieBreakRank())
                // Ties resolve by document order, not by whatever the map iterated — an answer that
                // cites a different passage on every identical run is not reproducible evidence.
                .thenComparing(KnowledgePassage::title)
                .thenComparingInt(KnowledgePassage::ordinal));
        int cap = Math.max(1, Math.min(limit <= 0 ? MAX_PASSAGES : limit, MAX_PASSAGES));
        return new KnowledgeSearchResponse(productId, matchedBy, documents.size(), corpus.size(),
                hits.size() > cap ? List.copyOf(hits.subList(0, cap)) : List.copyOf(hits),
                outcome, rejected, tried);
    }

    /** Rebuild one document's passages, through the collaborator every writer shares. */
    private int reindex(ProductKnowledgeSource source) {
        return indexer.index(source);
    }

    private void apply(ProductKnowledgeSource source, KnowledgeSourceRequest request, UUID orgId,
                       UUID productId) {
        source.setVariantId(resolveVariant(orgId, productId, request.variantId()));
        source.setSourceType(request.sourceType());
        source.setTitle(request.title().strip());
        source.setBody(request.body().strip());
        String url = request.sourceUrl() == null || request.sourceUrl().isBlank()
                ? null : request.sourceUrl().strip();
        source.setSourceUrl(url);
    }

    /**
     * The 규격 this document is about — or null, which is 전체 상품 공통.
     *
     * <p>A variant that belongs to another product or another org is a 400, not a silent null. The
     * two failures look identical to the caller and are opposite to the seller: one means "you asked
     * for a scope we could not honour" and the other would quietly widen their statement about one
     * 규격 into a statement about all of them.
     */
    private UUID resolveVariant(UUID orgId, UUID productId, UUID variantId) {
        if (variantId == null) {
            return null;
        }
        ProductVariant variant = variants.findById(variantId)
                .filter(v -> orgId.equals(v.getOrgId()) && productId.equals(v.getProductId()))
                .orElseThrow(() -> ApiException.badRequest("이 상품의 규격이 아닙니다."));
        return variant.getId();
    }

    /** Option names by variant id, for display and for the drafter's caution line. */
    private Map<UUID, String> variantNames(UUID orgId, UUID productId) {
        Map<UUID, String> names = new HashMap<>();
        for (ProductVariant variant : variants.findByOrgIdAndProductId(orgId, productId)) {
            names.put(variant.getId(), variant.getOptionName());
        }
        return names;
    }

    private Product requireProduct(UUID orgId, UUID productId) {
        return products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
    }

    private static KnowledgeSourceView view(ProductKnowledgeSource source, int chunkCount,
                                            String variantName) {
        return new KnowledgeSourceView(source.getId(), source.getProductId(), source.getSourceType(),
                source.getTitle(), source.getBody(), source.getSourceUrl(), source.getAuthorName(),
                chunkCount, source.getCreatedAt(), source.getUpdatedAt(),
                source.getAuthoredOrigin(), source.getVariantId(), variantName);
    }

    /** Two decimals — a score is a diagnostic, and full float noise reads as false precision. */
    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
