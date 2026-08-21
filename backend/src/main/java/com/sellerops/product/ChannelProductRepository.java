package com.sellerops.product;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelProductRepository extends JpaRepository<ChannelProduct, UUID> {

    /** The listing identity — {@code uq_channel_products_external}. */
    Optional<ChannelProduct> findByChannelIdAndExternalProductId(UUID channelId, String externalProductId);

    /** Every channel this product is listed on. Org-scoped: a bare product id is not proof of tenancy. */
    List<ChannelProduct> findByOrgIdAndProductId(UUID orgId, UUID productId);

    List<ChannelProduct> findByOrgIdAndProductIdIn(UUID orgId, Collection<UUID> productIds);

    long countByOrgId(UUID orgId);
}
