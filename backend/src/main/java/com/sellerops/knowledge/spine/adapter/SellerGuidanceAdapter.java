package com.sellerops.knowledge.spine.adapter;

import com.sellerops.knowledge.guidance.SellerGuidance;
import com.sellerops.knowledge.guidance.SellerGuidanceRepository;
import com.sellerops.knowledge.spine.KnowledgeAuthority;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.SourceRef;
import com.sellerops.knowledge.spine.SpineSourceType;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * <b>What the seller explicitly asked to be kept in mind</b> — a corrected draft or recommendation they marked
 * 「다음에도 참고」.
 *
 * <p>{@link KnowledgeAuthority#RECENT_SELLER_DECISION}: it is a decision the seller made, stated in their own words.
 * It outranks the product detail and past answers when they disagree, and it yields to a written policy and to
 * product knowledge the seller confirmed. A guidance bound to one product is that product's; one written for the
 * whole company is ORG.
 */
@Component
public class SellerGuidanceAdapter implements KnowledgeSourceAdapter {

    private final SellerGuidanceRepository guidance;

    public SellerGuidanceAdapter(SellerGuidanceRepository guidance) {
        this.guidance = guidance;
    }

    @Override
    public List<Indexed> read(UUID orgId, UUID productId) {
        return guidance.findAllByOrgIdAndActiveTrueOrderByCreatedAtDesc(orgId).stream()
                .filter(g -> orgId.equals(g.getOrgId()))
                .filter(g -> g.getProductId() == null || g.getProductId().equals(productId))
                .map(g -> new Indexed(new KnowledgeEntry(SpineSourceType.SELLER_GUIDANCE + ":" + g.getId(),
                        SpineSourceType.SELLER_GUIDANCE,
                        g.getProductId() == null ? KnowledgeSpineScope.ORG : KnowledgeSpineScope.PRODUCT,
                        g.getProductId(), null, KnowledgeAuthority.RECENT_SELLER_DECISION,
                        g.getKind() == SellerGuidance.Kind.DRAFT_CORRECTION ? "판매자가 고쳐 쓴 답변" : "판매자 판단 지침",
                        g.getGuidance(), g.getCreatedAt(),
                        g.getKind() == SellerGuidance.Kind.DRAFT_CORRECTION
                                ? "판매자 지침 · 초안을 고치며 다음에도 참고하라고 남김"
                                : "판매자 지침 · 추천을 고치며 다음에도 참고하라고 남김",
                        List.of(SourceRef.of(SourceRef.Kind.SELLER_GUIDANCE, g.getId()))),
                        g.getNormalized()))
                .toList();
    }
}
