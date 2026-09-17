package com.sellerops.product;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelProductRepository extends JpaRepository<ChannelProduct, UUID> {

    /**
     * How many of these listing ids this organisation holds on this channel.
     *
     * <p>The store fence for a browser-read NAVER review list. A listing id is unique per channel across every
     * organisation ({@code uq_channel_products_external}), and this org's NAVER listings were collected by the
     * official API with this org's own credential — so a page whose every product number is counted here is a
     * page of this org's store, and a page with even one that is not cannot be proved to be. Counted, not
     * returned: the caller needs the verdict, not the catalogue.
     */
    @org.springframework.data.jpa.repository.Query("""
            select count(distinct cp.externalProductId) from ChannelProduct cp
            where cp.orgId = :orgId and cp.channelId = :channelId and cp.externalProductId in :externalIds
            """)
    long countOwnedListings(@org.springframework.data.repository.query.Param("orgId") UUID orgId,
                            @org.springframework.data.repository.query.Param("channelId") UUID channelId,
                            @org.springframework.data.repository.query.Param("externalIds") Collection<String> externalIds);

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

    /**
     * Every listing in one org that carries a title, for resolving a product by the name a human reads.
     *
     * <p>The whole org, and matched in memory, because sameness of a product name is defined once — in
     * {@code ProductNameKey} — and a {@code lower(trim(...))} predicate here would be a second, quietly
     * different definition. The result is bounded by the seller's own catalogue (294 rows on the demo
     * org, 2026-08-23); if that stops being small, the fix is an indexed normalized column, not a
     * looser comparison.
     *
     * <p>The {@code realDataOnly} filter applies, so a seeded listing can never name a real product.
     */
    List<ChannelProduct> findAllByOrgIdAndChannelProductNameIsNotNull(UUID orgId);

    /** Every channel this product is listed on. Org-scoped: a bare product id is not proof of tenancy. */
    List<ChannelProduct> findByOrgIdAndProductId(UUID orgId, UUID productId);

    List<ChannelProduct> findByOrgIdAndProductIdIn(UUID orgId, Collection<UUID> productIds);

    long countByOrgId(UUID orgId);
}
