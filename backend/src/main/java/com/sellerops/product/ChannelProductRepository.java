package com.sellerops.product;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelProductRepository extends JpaRepository<ChannelProduct, UUID> {

    /** The listing identity — {@code uq_channel_products_external}. */
    Optional<ChannelProduct> findByChannelIdAndExternalProductId(UUID channelId, String externalProductId);

    /**
     * A listing by the channel's DISPLAY id — the reverse lookup the Coupang 상품평 path needs, since the
     * review screen names its product with 노출상품ID and nothing else.
     *
     * <p>Org-scoped deliberately. The listing key {@code (channel, external_product_id)} is unique
     * globally and needs no org; a display id carries no such constraint of ours, so the tenancy is
     * asserted here rather than assumed from the channel. The {@code RealDataOnly} filter still
     * applies, which is what keeps a synthetic listing from answering for a real review.
     *
     * <p><b>A List, and not an Optional.</b> A display id is not unique and the live catalogue proves it:
     * on 2026-08-23 the canonical demo org's 68 Coupang listings carried 63 distinct 노출상품ID, five of
     * them shared by two 등록상품 rows pointing at two different products. An {@code Optional} finder over
     * that column throws on exactly those five, which turns a review of a merged listing into a 500 for
     * the whole sitting. The caller decides what an ambiguous answer means; the repository does not get
     * to decide it by crashing.
     */
    List<ChannelProduct> findAllByOrgIdAndChannelIdAndExternalDisplayProductId(
            UUID orgId, UUID channelId, String externalDisplayProductId);

    /** Every channel this product is listed on. Org-scoped: a bare product id is not proof of tenancy. */
    List<ChannelProduct> findByOrgIdAndProductId(UUID orgId, UUID productId);

    List<ChannelProduct> findByOrgIdAndProductIdIn(UUID orgId, Collection<UUID> productIds);

    long countByOrgId(UUID orgId);
}
