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
     * <p>The product set is a required argument and not a convenience: this is the Coupang 상품평 tie-break,
     * where the 옵션ID may only ever choose BETWEEN the products a 노출상품ID already selected. It remains
     * the narrower of the two option lookups and is still what the display-id fallback uses.
     */
    List<ProductVariant> findByOrgIdAndProductIdInAndExternalVariantId(
            UUID orgId, Collection<UUID> productIds, String externalVariantId);

    /**
     * Variants matching one channel option id within one org and one channel — the Coupang 상품평 PRIMARY
     * resolution since 2026-08-23.
     *
     * <p>This deliberately reverses an earlier decision, and the reason is measured rather than argued: a
     * live diagnosis found that 10 of 10 unplaceable 상품평 already had a variant here under their 옵션ID,
     * while the 노출상품ID they printed matched no listing. Coupang's exposure id is a MUTABLE alias — a
     * merge or split moves it — and the option id is the immutable per-option key. Resolving by the id that
     * moves, when the id that does not is right there, was the wrong way round.
     *
     * <p><b>Scoped, not global.</b> Org and channel are both required, so another org's catalogue and another
     * channel's option space can never answer. Finer than that is not available: neither this table nor
     * {@code channel_products} carries a seller-account column, so an org with two Coupang accounts shares
     * this lookup — a schema fact, recorded here rather than papered over.
     */
    List<ProductVariant> findByOrgIdAndChannelIdAndExternalVariantId(
            UUID orgId, UUID channelId, String externalVariantId);

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
