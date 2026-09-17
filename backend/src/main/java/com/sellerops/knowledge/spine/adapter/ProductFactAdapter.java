package com.sellerops.knowledge.spine.adapter;

import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.spine.KnowledgeAuthority;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.SourceRef;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.product.FactConfidence;
import com.sellerops.product.FactKeys;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>What the channel states about the product today</b> — the attributes, specification and description the
 * product sync already stored in {@code product_facts}.
 *
 * <p>{@link KnowledgeAuthority#PRODUCT_DETAIL}: it is the current listing, which the seller maintains on the
 * channel, and it yields to anything the seller confirmed here. Freshness is when the channel says the row last
 * changed, and when it says nothing, when we read it.
 *
 * <p>PRODUCT scope only — a fact is always about one product, so an org-level read returns nothing.
 */
@Component
public class ProductFactAdapter implements KnowledgeSourceAdapter {

    private final ProductFactRepository facts;

    public ProductFactAdapter(ProductFactRepository facts) {
        this.facts = facts;
    }

    @Override
    public List<Indexed> read(UUID orgId, UUID productId) {
        if (productId == null) {
            return List.of();
        }
        return facts.findByOrgIdAndProductId(orgId, productId).stream()
                .filter(f -> orgId.equals(f.getOrgId()) && productId.equals(f.getProductId()))
                .filter(f -> f.getFactValue() != null && !f.getFactValue().isBlank())
                .sorted(Comparator.comparing(ProductFact::getFactKey))
                .map(f -> {
                    String title = titleOf(f.getFactKey());
                    String text = f.getUnit() == null || f.getUnit().isBlank()
                            ? f.getFactValue().strip() : f.getFactValue().strip() + " " + f.getUnit().strip();
                    String channel = channelOf(f.getSource());
                    return new Indexed(new KnowledgeEntry(
                            SpineSourceType.PRODUCT_FACT + ":" + f.getId(), SpineSourceType.PRODUCT_FACT,
                            KnowledgeSpineScope.PRODUCT, productId, channel, KnowledgeAuthority.PRODUCT_DETAIL,
                            title, text,
                            f.getSourceUpdatedAt() != null ? f.getSourceUpdatedAt() : f.getObservedAt(),
                            f.getConfidence() == FactConfidence.SOURCE_STATED
                                    ? "채널 상품 정보" : "채널 상품 정보에서 정리한 값",
                            List.of(new SourceRef(SourceRef.Kind.PRODUCT_FACT, f.getId(), f.getFactKey()))),
                            KnowledgeText.normalize(title + " " + text));
                })
                .toList();
    }

    /**
     * Whether this fact is a short stated attribute (spec, attribute, taxonomy) rather than the long description.
     * Only attributes are offered as retrieval context: the description is the detail page's text, which the product
     * lane already reads, and a paragraph matched on one shared word is not evidence about the question.
     */
    public static boolean isAttribute(KnowledgeEntry entry) {
        String key = entry.sourceRefs().isEmpty() ? null : entry.sourceRefs().get(0).locator();
        return key != null && !FactKeys.DESC.equals(FactKeys.namespaceOf(key));
    }

    /** {@code spec:길이} reads as 「길이」; the four SellerOps-named keys read as what they are. */
    static String titleOf(String factKey) {
        if (FactKeys.DESC_SUMMARY.equals(factKey)) {
            return "상품 설명";
        }
        if (FactKeys.TAXONOMY_BRAND.equals(factKey)) {
            return "브랜드";
        }
        if (FactKeys.TAXONOMY_MANUFACTURER.equals(factKey)) {
            return "제조사";
        }
        if (FactKeys.TAXONOMY_CATEGORY.equals(factKey)) {
            return "카테고리";
        }
        int at = factKey == null ? -1 : factKey.indexOf(':');
        return at < 0 ? String.valueOf(factKey) : factKey.substring(at + 1);
    }

    /** {@code NAVER:PRODUCT_API:v1} → {@code NAVER}. The channel token only; the rest is our read path. */
    static String channelOf(String source) {
        if (source == null || source.isBlank()) {
            return null;
        }
        int at = source.indexOf(':');
        return at < 0 ? source : source.substring(0, at);
    }
}
