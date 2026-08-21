package com.sellerops.product;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductVariantRepository extends JpaRepository<ProductVariant, UUID> {

    Optional<ProductVariant> findByOrgIdAndProductIdAndExternalVariantId(
            UUID orgId, UUID productId, String externalVariantId);

    List<ProductVariant> findByOrgIdAndProductId(UUID orgId, UUID productId);

    long countByOrgId(UUID orgId);
}
