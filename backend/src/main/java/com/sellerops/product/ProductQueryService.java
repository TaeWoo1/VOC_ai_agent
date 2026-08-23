package com.sellerops.product;

import com.sellerops.product.dto.ProductSummaryView;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolving a product the way a seller names one — "A상품", part of a name, a SKU, or the title they
 * read on the marketplace.
 *
 * <p>Deliberately a separate service from {@link ProductService}, which owns the WRITE side
 * ({@code resolveOrCreate} during ingest). Reading must never create: an operator asking about a
 * product that does not exist has to get an empty answer, not a new empty product row that then shows
 * up in every rollup as a real thing with no data.
 *
 * <p><b>{@code products.name} is not always a name.</b> For a Coupang- or Cafe24-derived catalogue it
 * is the seller's product code, so the demo org holds "15223228019" as the name of a product whose
 * listing is titled "판도리 일체형 종이컵 수거함". A seller who typed the title they can actually see
 * got nothing back — measured live on 2026-08-23 ({@code docs/agent_real_validation_v1.md} §9.5, C1).
 * So {@code channel_products.channel_product_name} is a resolution ALIAS here: the listing is found,
 * and the canonical product it is <i>already linked to</i> is returned. Nothing is created, nothing is
 * merged, and a listing is never returned in a product's place.
 *
 * <p>Matching is deterministic and local — exact SKU, exact canonical name, exact listing title, then
 * case-insensitive substring of the canonical name, in that order, with ties broken by name so two
 * runs of the same question return the same product. Comparison runs through
 * {@link ProductNameKey} and no further: no fuzzy scoring, no model in the loop. A wrong product
 * resolved confidently is worse than several candidates returned honestly, and the Operator is built
 * to ask again rather than guess — which is why {@link ProductMatchSurface} travels with each row.
 *
 * <p><b>Scope is the org's REAL data, twice over.</b> Both reads are org-scoped, and the auto-enabled
 * {@code realDataOnly} filter excludes seeded rows from each — so a synthetic listing cannot name a
 * real product, and a listing belonging to another tenant cannot be reached at all.
 */
@Service
public class ProductQueryService {

    /** Ceiling on returned candidates; a resolver that returns fifty has not resolved anything. */
    public static final int MAX_RESULTS = 10;

    private final ProductRepository products;
    private final ChannelProductRepository listings;

    public ProductQueryService(ProductRepository products, ChannelProductRepository listings) {
        this.products = products;
        this.listings = listings;
    }

    /**
     * Candidates for a query, best match first. An empty/blank query returns the org's catalog head
     * rather than everything, so a caller that forgot the parameter gets something small and obvious.
     */
    @Transactional(readOnly = true)
    public List<ProductSummaryView> search(UUID orgId, String query, int limit) {
        int cap = Math.min(Math.max(limit <= 0 ? MAX_RESULTS : limit, 1), MAX_RESULTS);
        List<Product> all = products.findAllByOrgId(orgId);
        if (query == null || query.isBlank()) {
            return all.stream()
                    .sorted(Comparator.comparing(Product::getName))
                    .limit(cap)
                    .map(p -> view(p, ProductMatchSurface.CATALOG_HEAD, null))
                    .toList();
        }
        String needle = ProductNameKey.of(query);
        Map<UUID, String> aliases = aliasHits(orgId, needle);
        return all.stream()
                .map(p -> match(p, needle, aliases))
                .filter(java.util.Objects::nonNull)
                .sorted(Comparator.comparingInt((Match m) -> m.surface().ordinal())
                        .thenComparing(m -> m.product().getName(),
                                Comparator.nullsLast(Comparator.naturalOrder())))
                .limit(cap)
                .map(m -> view(m.product(), m.surface(), m.matchedName()))
                .toList();
    }

    /** One product by id, org-scoped. Absent for another org's id — never a probe. */
    @Transactional(readOnly = true)
    public Optional<ProductSummaryView> byId(UUID orgId, UUID productId) {
        return products.findAllByOrgIdAndIdIn(orgId, List.of(productId)).stream()
                .findFirst()
                // No query ran, so there is no surface to report. Null says that; inventing
                // CANONICAL_NAME_EXACT here would tell a caller the seller typed something they did not.
                .map(p -> view(p, null, null));
    }

    /**
     * Which products carry this exact title on a listing, and the title as stored.
     *
     * <p>Keyed by product, so several listings of one product that share a title converge to a single
     * candidate — the ordinary case for a seller listing the same item on two channels. Several
     * listings pointing at DIFFERENT products stay several candidates, all at the same surface, and the
     * caller is expected to refuse rather than take the first: on 2026-08-23 the demo org held 10 such
     * titles, one of them shared by four separate products.
     *
     * <p>Reads the org's listings and normalizes in Java rather than in SQL, because the comparison key
     * must be the same one {@link ProductNameKey} defines — a lower()/trim() in a query would be a
     * second definition of sameness, free to drift from the first.
     */
    private Map<UUID, String> aliasHits(UUID orgId, String needle) {
        Map<UUID, String> hits = new HashMap<>();
        for (ChannelProduct listing : listings.findAllByOrgIdAndChannelProductNameIsNotNull(orgId)) {
            if (ProductNameKey.of(listing.getChannelProductName()).equals(needle)) {
                hits.putIfAbsent(listing.getProductId(), listing.getChannelProductName().strip());
            }
        }
        return hits;
    }

    /** The best surface this product matches on, or null when it matches none. */
    private static Match match(Product p, String needle, Map<UUID, String> aliases) {
        String sku = ProductNameKey.of(p.getSku());
        String name = ProductNameKey.of(p.getName());
        if (!sku.isEmpty() && sku.equals(needle)) {
            return new Match(p, ProductMatchSurface.SKU_EXACT, null);
        }
        if (!name.isEmpty() && name.equals(needle)) {
            return new Match(p, ProductMatchSurface.CANONICAL_NAME_EXACT, null);
        }
        String alias = aliases.get(p.getId());
        if (alias != null) {
            return new Match(p, ProductMatchSurface.CHANNEL_PRODUCT_NAME_EXACT, alias);
        }
        if (!name.isEmpty() && name.contains(needle)) {
            return new Match(p, ProductMatchSurface.CANONICAL_NAME_PARTIAL, null);
        }
        return null;
    }

    private record Match(Product product, ProductMatchSurface surface, String matchedName) {
    }

    private static ProductSummaryView view(Product p, ProductMatchSurface surface, String matchedName) {
        return new ProductSummaryView(p.getId(), p.getName(), p.getSku(), p.getStatus(),
                surface, matchedName);
    }
}
