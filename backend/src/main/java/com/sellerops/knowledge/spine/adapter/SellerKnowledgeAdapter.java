package com.sellerops.knowledge.spine.adapter;

import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.org.OrgKnowledgeChunk;
import com.sellerops.knowledge.org.OrgKnowledgeChunkRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.spine.KnowledgeAuthority;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.SourceRef;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.product.library.KnowledgeAuthorship;
import com.sellerops.product.library.ProductKnowledgeChunk;
import com.sellerops.product.library.ProductKnowledgeChunkRepository;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * <b>What the seller wrote down: the company's operating rules and each product's notes and documents.</b>
 *
 * <p>Read passage by passage, exactly as the draft retrieval reads them — the chunks the two library services
 * index — so an entry here is the same unit a draft can cite. A source with no passages cannot be cited and
 * is not offered; a retired source stopped speaking for the company and is not offered either.
 *
 * <p><b>One table, two authorities.</b> In the product corpus a note the seller typed is
 * {@link KnowledgeAuthority#SELLER_CONFIRMED_PRODUCT_KNOWLEDGE}; a file they uploaded (a manual) and text read
 * off their own detail page are {@link KnowledgeAuthority#PRODUCT_DETAIL}. Every org rule is
 * {@link KnowledgeAuthority#SELLER_POLICY}, typed or uploaded — both are the company's written policy.
 */
@Component
public class SellerKnowledgeAdapter implements KnowledgeSourceAdapter {

    private final OrgKnowledgeSourceRepository orgSources;
    private final OrgKnowledgeChunkRepository orgChunks;
    private final ProductKnowledgeSourceRepository productSources;
    private final ProductKnowledgeChunkRepository productChunks;

    public SellerKnowledgeAdapter(OrgKnowledgeSourceRepository orgSources, OrgKnowledgeChunkRepository orgChunks,
                                  ProductKnowledgeSourceRepository productSources,
                                  ProductKnowledgeChunkRepository productChunks) {
        this.orgSources = orgSources;
        this.orgChunks = orgChunks;
        this.productSources = productSources;
        this.productChunks = productChunks;
    }

    @Override
    public List<Indexed> read(UUID orgId, UUID productId) {
        List<Indexed> entries = new ArrayList<>(orgEntries(orgId));
        if (productId != null) {
            entries.addAll(productEntries(orgId, productId));
        }
        return entries;
    }

    private List<Indexed> orgEntries(UUID orgId) {
        Map<UUID, OrgKnowledgeSource> active = orgSources.findAllByOrgIdOrderByCreatedAtAsc(orgId).stream()
                .filter(OrgKnowledgeSource::isActive)
                .filter(s -> orgId.equals(s.getOrgId()))
                .collect(Collectors.toMap(OrgKnowledgeSource::getId, Function.identity()));
        List<Indexed> entries = new ArrayList<>();
        for (OrgKnowledgeChunk chunk : sorted(orgChunks.findAllByOrgId(orgId),
                OrgKnowledgeChunk::getSourceId, OrgKnowledgeChunk::getOrdinal)) {
            OrgKnowledgeSource source = active.get(chunk.getSourceId());
            if (source == null || !orgId.equals(chunk.getOrgId())) {
                continue;
            }
            String provenance = source.getAuthoredOrigin() == KnowledgeAuthorship.SELLER_UPLOADED_DOCUMENT
                    ? "판매자가 올린 운영 기준 자료" : "판매자가 등록한 운영 기준";
            entries.add(new Indexed(new KnowledgeEntry(
                    SpineSourceType.ORG_KNOWLEDGE + ":" + chunk.getId(),
                    SpineSourceType.ORG_KNOWLEDGE, KnowledgeSpineScope.ORG, null, null,
                    KnowledgeAuthority.SELLER_POLICY, source.getTitle(), chunk.getContent(), source.getUpdatedAt(),
                    provenance,
                    List.of(new SourceRef(SourceRef.Kind.ORG_KNOWLEDGE_SOURCE, source.getId(), "v" + source.getVersion()),
                            new SourceRef(SourceRef.Kind.ORG_KNOWLEDGE_CHUNK, chunk.getId(), "#" + chunk.getOrdinal()))),
                    KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized()));
        }
        return entries;
    }

    private List<Indexed> productEntries(UUID orgId, UUID productId) {
        Map<UUID, ProductKnowledgeSource> active = productSources
                .findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                .filter(ProductKnowledgeSource::isActive)
                .filter(s -> orgId.equals(s.getOrgId()) && productId.equals(s.getProductId()))
                .collect(Collectors.toMap(ProductKnowledgeSource::getId, Function.identity()));
        List<Indexed> entries = new ArrayList<>();
        for (ProductKnowledgeChunk chunk : sorted(productChunks.findAllByOrgIdAndProductId(orgId, productId),
                ProductKnowledgeChunk::getSourceId, ProductKnowledgeChunk::getOrdinal)) {
            ProductKnowledgeSource source = active.get(chunk.getSourceId());
            if (source == null || !productId.equals(chunk.getProductId())) {
                continue;
            }
            SpineSourceType type = typeOf(source.getAuthoredOrigin());
            List<SourceRef> refs = new ArrayList<>();
            refs.add(new SourceRef(SourceRef.Kind.PRODUCT_KNOWLEDGE_SOURCE, source.getId(),
                    source.getVariantId() == null ? null : "variant"));
            refs.add(new SourceRef(SourceRef.Kind.PRODUCT_KNOWLEDGE_CHUNK, chunk.getId(), "#" + chunk.getOrdinal()));
            entries.add(new Indexed(new KnowledgeEntry(
                    type + ":" + chunk.getId(),
                    type, KnowledgeSpineScope.PRODUCT, productId, null, authorityOf(source.getAuthoredOrigin()),
                    source.getTitle(), chunk.getContent(), source.getUpdatedAt(), provenanceOf(source), refs),
                    KnowledgeText.normalize(source.getTitle()) + chunk.getNormalized()));
        }
        return entries;
    }

    public static SpineSourceType typeOf(KnowledgeAuthorship authorship) {
        return switch (authorship == null ? KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE : authorship) {
            case SELLER_ENTERED_KNOWLEDGE -> SpineSourceType.PRODUCT_KNOWLEDGE;
            case SELLER_UPLOADED_DOCUMENT -> SpineSourceType.PRODUCT_DOCUMENT;
            // Text read off the seller's own listing — as text, or out of a picture on it. The image authorship is not
            // named here: it has exactly one producer, and a reader that spelled it would count as a second.
            default -> SpineSourceType.PRODUCT_DETAIL_PAGE;
        };
    }

    public static KnowledgeAuthority authorityOf(KnowledgeAuthorship authorship) {
        return typeOf(authorship) == SpineSourceType.PRODUCT_KNOWLEDGE
                ? KnowledgeAuthority.SELLER_CONFIRMED_PRODUCT_KNOWLEDGE : KnowledgeAuthority.PRODUCT_DETAIL;
    }

    private static String provenanceOf(ProductKnowledgeSource source) {
        KnowledgeAuthorship authorship = source.getAuthoredOrigin() == null
                ? KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE : source.getAuthoredOrigin();
        return switch (authorship) {
            case SELLER_ENTERED_KNOWLEDGE -> "판매자가 등록한 상품 지식";
            case SELLER_UPLOADED_DOCUMENT -> "판매자가 올린 상품 자료";
            case SELLER_AUTHORED_CHANNEL_CONTENT -> "상품 상세페이지";
            // The page is the seller's; a figure read out of its picture by a model is not a typed one. The sentence
            // keeps both, asked through the authorship's own property rather than by name.
            default -> authorship.carriesExactFiguresUnaided() ? "상품 상세페이지" : "상품 상세페이지 이미지에서 읽은 내용";
        };
    }

    private static <T> List<T> sorted(List<T> rows, Function<T, UUID> source, Function<T, Integer> ordinal) {
        return rows.stream()
                .sorted(Comparator.comparing(source, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(ordinal))
                .toList();
    }
}
