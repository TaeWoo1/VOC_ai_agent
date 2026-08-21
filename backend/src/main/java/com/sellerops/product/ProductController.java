package com.sellerops.product;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.ingest.ReviewProductLinkBackfill;
import com.sellerops.product.dto.ProductFactView;
import com.sellerops.product.dto.ProductKnowledgeView;
import com.sellerops.product.dto.ProductSignalsView;
import com.sellerops.product.dto.ProductSummaryView;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.sellerops.common.ApiException;

/**
 * The product read surface — resolve a product, then read what is happening to it.
 *
 * <p><b>No create, no update, no delete of a product.</b> Products are created by ingest
 * ({@code ProductService.resolveOrCreate}) or by a channel PRODUCT read as a side effect of real
 * collected rows; an operator-facing write would let a catalog entry exist with nothing behind it.
 * The one POST here is a <b>backfill</b>: it derives knowledge from rows SellerOps already holds and
 * cannot invent a product that no row mentions. Authenticated like every {@code /api/**} route; the
 * org comes from the principal, never from a parameter.
 */
@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final ProductQueryService query;
    private final ProductSignalsService signals;
    private final ProductKnowledgeService knowledge;
    private final ProductKnowledgeDerivation derivation;
    private final ReviewProductLinkBackfill reviewLinks;

    public ProductController(ProductQueryService query, ProductSignalsService signals,
                             ProductKnowledgeService knowledge, ProductKnowledgeDerivation derivation,
                             ReviewProductLinkBackfill reviewLinks) {
        this.query = query;
        this.signals = signals;
        this.knowledge = knowledge;
        this.derivation = derivation;
        this.reviewLinks = reviewLinks;
    }

    /** Candidates for a seller's own words ("A상품", a SKU). Best match first, bounded. */
    @GetMapping
    public List<ProductSummaryView> search(@AuthenticationPrincipal AuthPrincipal principal,
                                           @RequestParam(name = "q", required = false) String query,
                                           @RequestParam(defaultValue = "10") int limit) {
        return this.query.search(principal.orgId(), query, limit);
    }

    /**
     * One product's signals plus the coverage verdict for each source.
     *
     * <p>{@code referenceDate} pins the trend judgements exactly as {@code /api/review-issues} does, so
     * a product answer and an issue answer taken on the same anchor agree.
     */
    @GetMapping("/{productId}/signals")
    public ProductSignalsView signals(@AuthenticationPrincipal AuthPrincipal principal,
                                      @PathVariable UUID productId,
                                      @RequestParam(required = false) String referenceDate) {
        try {
            return signals.signals(principal.orgId(), productId, parseDate(referenceDate));
        } catch (IllegalArgumentException notFound) {
            throw ApiException.notFound(notFound.getMessage());
        }
    }

    /**
     * Everything SellerOps knows about one product — identity, listings, variants, facts, signals, and
     * the coverage verdict for each facet.
     *
     * <p>Separate from {@code /signals} rather than replacing it: a caller that only needs "what is
     * happening" should not pay for the catalogue, and a caller that needs the catalogue must not be
     * able to get it without the coverage rows that qualify it.
     */
    @GetMapping("/{productId}/knowledge")
    public ProductKnowledgeView knowledge(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID productId,
                                          @RequestParam(required = false) String referenceDate) {
        return knowledge.knowledge(principal.orgId(), productId, parseDate(referenceDate))
                .orElseThrow(() -> ApiException.notFound("상품을 찾을 수 없습니다."));
    }

    /**
     * A few named facts about one product — the targeted read an information need makes.
     *
     * <p>{@code keys} accepts either a full key ({@code spec:길이}) or a bare name ({@code 길이}). A
     * planner names what it wants in the seller's words; making a need depend on a storage namespace
     * would turn a spelling difference into a silent "규격 정보가 없습니다".
     */
    @GetMapping("/{productId}/facts")
    public List<ProductFactView> facts(@AuthenticationPrincipal AuthPrincipal principal,
                                       @PathVariable UUID productId,
                                       @RequestParam(name = "keys", required = false) List<String> keys) {
        return knowledge.factsFor(principal.orgId(), productId, keys);
    }

    /**
     * Bounded, idempotent Product Knowledge backfill over rows already stored — no channel call.
     *
     * <p><b>Required rather than optional, for the reason the customer-memory backfill is.</b> Derived
     * state is written on the ingest path, and ingest is idempotent: re-collecting already-collected
     * data inserts nothing, so every follow-up is a no-op and no amount of re-collection can populate
     * this for an existing seller. Proven on the demo org 2026-08-21.
     *
     * <p>Page until {@code scanned < limit}.
     */
    @PostMapping("/knowledge/backfill")
    public ProductKnowledgeDerivation.DerivationResult backfill(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "200") int limit,
            @RequestParam(defaultValue = "0") int page) {
        return derivation.derive(principal.orgId(), limit, page);
    }

    /**
     * Attach promoted Cafe24 reviews to the products their own articles name — a consistency repair.
     *
     * <p>Run this BEFORE {@code /knowledge/backfill}: linkage decides which reviews are attributable to
     * a product, and the knowledge derivation reads that attribution to decide which channels a product
     * was seen on. Running them the other way round still converges, one pass later.
     */
    @PostMapping("/product-link/backfill")
    public ReviewProductLinkBackfill.LinkResult linkBackfill(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam(defaultValue = "500") int limit,
            @RequestParam(defaultValue = "0") int page) {
        return reviewLinks.backfill(principal.orgId(), limit, page);
    }

    private static LocalDate parseDate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("referenceDate 형식이 올바르지 않습니다 (YYYY-MM-DD).");
        }
    }
}
