package com.sellerops.product;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductVariantRepository extends JpaRepository<ProductVariant, UUID> {

    Optional<ProductVariant> findByOrgIdAndProductIdAndExternalVariantId(
            UUID orgId, UUID productId, String externalVariantId);

    List<ProductVariant> findByOrgIdAndProductId(UUID orgId, UUID productId);

    /**
     * Variants matching one channel option id, <b>within a named set of products</b>.
     *
     * <p>The product set is a required argument and not a convenience: this exists for the Coupang 상품평
     * tie-break, where the 옵션ID may only ever choose BETWEEN the products a 노출상품ID already selected.
     * A finder keyed on {@code externalVariantId} alone would be a whole-catalogue lookup by an id the
     * client supplied, which is a different and much wider contract than the one that was agreed.
     */
    List<ProductVariant> findByOrgIdAndProductIdInAndExternalVariantId(
            UUID orgId, Collection<UUID> productIds, String externalVariantId);

    /**
     * Which of these channel option ids this org holds a variant for — <b>the ids back, and nothing else</b>.
     *
     * <p>Diagnosis only. It answers one question about coverage: "does the catalogue already contain the
     * product this unplaced 상품평 names, under some other 노출상품ID?" It deliberately returns
     * {@code String}s rather than variants, so it cannot hand anyone a product and therefore cannot be
     * used to resolve a review — the sibling finder above stays the only path an 옵션ID may take toward a
     * product, and only inside a candidate set a 노출상품ID already chose.
     */
    @Query("select v.externalVariantId from ProductVariant v "
            + "where v.orgId = :orgId and v.externalVariantId in :externalVariantIds")
    List<String> findKnownExternalVariantIds(@Param("orgId") UUID orgId,
                                             @Param("externalVariantIds") Collection<String> externalVariantIds);

    long countByOrgId(UUID orgId);
}
