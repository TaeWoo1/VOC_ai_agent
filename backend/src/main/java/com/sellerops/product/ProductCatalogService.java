package com.sellerops.product;

import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.product.dto.ProductCatalogView;
import com.sellerops.product.dto.ProductSummaryView;
import com.sellerops.review.ReviewRepository;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The 상품 screen's page: the products carrying operational weight first, and the org's real total.
 *
 * <p><b>Why this is not {@link ProductQueryService#search}.</b> That one resolves a seller's own
 * words — 「A상품」, part of a name, a SKU — and its empty-query head is alphabetical and capped at ten.
 * That is the right answer to 「이 이름의 상품이 있나」 and the wrong one to 「지금 무엇을 봐야 하나」,
 * and the 상품 screen was asking it the second question. On 2026-09-04 the demo org held 308 products
 * and the screen showed ten by name — six of them with no inquiry and no review at all — while the
 * product carrying 1,761 reviews was not on the page, under a heading that read 「상품 10개」.
 * {@code search} is untouched; the screen simply stops asking it a question it was not built for.
 *
 * <p><b>Weight is what the seller owes, then what customers complained about.</b> Unanswered
 * inquiries, then negative reviews, then review volume, then name so the tail is stable — the same
 * order the screen already sorted the ten rows it happened to receive by. Moving it here is what lets
 * that rule see the whole catalogue.
 *
 * <p><b>Three reads, never one per row.</b> Two grouped counts and the catalogue, then the ranking in
 * memory. Asking the per-product signals endpoint instead would be 308 requests to choose twenty.
 *
 * <p><b>Two different synthetic rules, on purpose.</b> WHICH products exist follows the auto-enabled
 * {@code realDataOnly} filter, so the page and {@code countByOrgId} agree in every deployment. WHAT
 * ranks them is REAL only and says so in the queries: ranking a catalogue by manufactured complaints
 * is how a demo screen came to name an invented product as the shop's worst.
 */
@Service
public class ProductCatalogService {

    /** The screen reads facts for every row it shows, so the page it shows is bounded. */
    public static final int CATALOG_PAGE = 20;

    private final ProductRepository products;
    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;

    public ProductCatalogService(ProductRepository products, InquiryRepository inquiries,
                                 ReviewRepository reviews) {
        this.products = products;
        this.inquiries = inquiries;
        this.reviews = reviews;
    }

    @Transactional(readOnly = true)
    public ProductCatalogView catalog(UUID orgId, int limit) {
        int cap = Math.min(Math.max(limit <= 0 ? CATALOG_PAGE : limit, 1), CATALOG_PAGE);
        List<Product> all = products.findAllByOrgId(orgId);

        Map<UUID, Long> unanswered = new HashMap<>();
        for (Object[] row : inquiries.countUnansweredOperationalByProduct(orgId)) {
            unanswered.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        Map<UUID, Long> reviewCount = new HashMap<>();
        Map<UUID, Long> negativeCount = new HashMap<>();
        for (Object[] row : reviews.countOperationalByProduct(orgId)) {
            UUID id = (UUID) row[0];
            reviewCount.put(id, ((Number) row[1]).longValue());
            negativeCount.put(id, row[2] == null ? 0L : ((Number) row[2]).longValue());
        }

        Comparator<Product> byWeight = Comparator
                .comparingLong((Product p) -> -unanswered.getOrDefault(p.getId(), 0L))
                .thenComparingLong(p -> -negativeCount.getOrDefault(p.getId(), 0L))
                .thenComparingLong(p -> -reviewCount.getOrDefault(p.getId(), 0L))
                .thenComparing(Product::getName, Comparator.nullsLast(Comparator.naturalOrder()));

        List<ProductSummaryView> rows = all.stream()
                .sorted(byWeight)
                .limit(cap)
                .map(p -> new ProductSummaryView(p.getId(), p.getName(), p.getSku(), p.getStatus(),
                        ProductMatchSurface.CATALOG_HEAD, null))
                .toList();
        return new ProductCatalogView(all.size(), rows);
    }
}
