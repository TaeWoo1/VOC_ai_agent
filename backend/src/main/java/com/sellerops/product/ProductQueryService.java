package com.sellerops.product;

import com.sellerops.product.dto.ProductSummaryView;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolving a product the way a seller names one — "A상품", part of a name, a SKU.
 *
 * <p>Deliberately a separate service from {@link ProductService}, which owns the WRITE side
 * ({@code resolveOrCreate} during ingest). Reading must never create: an operator asking about a
 * product that does not exist has to get an empty answer, not a new empty product row that then shows
 * up in every rollup as a real thing with no data.
 *
 * <p>Matching is deterministic and local — exact SKU, then exact name, then case-insensitive
 * substring, each in that order, with ties broken by name so two runs of the same question return the
 * same product. No fuzzy scoring: a wrong product resolved confidently is worse than several
 * candidates returned honestly, and the Operator is built to ask again rather than guess.
 */
@Service
public class ProductQueryService {

    /** Ceiling on returned candidates; a resolver that returns fifty has not resolved anything. */
    public static final int MAX_RESULTS = 10;

    private final ProductRepository products;

    public ProductQueryService(ProductRepository products) {
        this.products = products;
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
                    .sorted(java.util.Comparator.comparing(Product::getName))
                    .limit(cap)
                    .map(ProductQueryService::view)
                    .toList();
        }
        String needle = query.trim().toLowerCase(Locale.ROOT);
        return all.stream()
                .filter(p -> rank(p, needle) < Integer.MAX_VALUE)
                .sorted(java.util.Comparator.comparingInt((Product p) -> rank(p, needle))
                        .thenComparing(Product::getName))
                .limit(cap)
                .map(ProductQueryService::view)
                .toList();
    }

    /** One product by id, org-scoped. Absent for another org's id — never a probe. */
    @Transactional(readOnly = true)
    public java.util.Optional<ProductSummaryView> byId(UUID orgId, UUID productId) {
        return products.findAllByOrgIdAndIdIn(orgId, List.of(productId)).stream()
                .findFirst()
                .map(ProductQueryService::view);
    }

    /** 0 = exact SKU, 1 = exact name, 2 = name contains. {@code MAX_VALUE} = no match. */
    private static int rank(Product p, String needle) {
        String sku = p.getSku() == null ? "" : p.getSku().toLowerCase(Locale.ROOT);
        String name = p.getName() == null ? "" : p.getName().toLowerCase(Locale.ROOT);
        if (!sku.isEmpty() && sku.equals(needle)) {
            return 0;
        }
        if (name.equals(needle)) {
            return 1;
        }
        if (!name.isEmpty() && name.contains(needle)) {
            return 2;
        }
        return Integer.MAX_VALUE;
    }

    private static ProductSummaryView view(Product p) {
        return new ProductSummaryView(p.getId(), p.getName(), p.getSku(), p.getStatus());
    }
}
