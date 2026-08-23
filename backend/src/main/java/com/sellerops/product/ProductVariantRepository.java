package com.sellerops.product;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

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

    long countByOrgId(UUID orgId);
}
