package com.sellerops.ingest.canonical;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Source-agnostic product record produced by any PRODUCT read before persistence — the catalogue
 * sibling of {@link CanonicalReview} and {@link CanonicalInquiry}.
 *
 * <p><b>Every field is optional except {@code externalProductId} and {@code observedAt}.</b> Channels
 * differ enormously in what their product read returns, and the honest representation of that is a
 * null, never a placeholder: a null {@code description} becomes {@code UNAVAILABLE} coverage, while a
 * synthesized empty string would become a stated fact that the description is empty. The two are
 * different claims and only one of them is true.
 *
 * <p>{@code attributes} is the channel's own attribute map, label kept verbatim ({@code FactKeys}
 * explains why renaming it would make the fact untraceable). {@code sourceKind} is the provenance
 * stamp every derived row carries, e.g. {@code CAFE24:PRODUCT_API:v2}.
 *
 * <p>No customer data can reach this record: it is the seller's own catalogue.
 */
public record CanonicalProduct(
        String externalProductId,
        String name,
        String sku,
        String productUrl,
        BigDecimal price,
        String currency,
        /** The channel's own status token; normalized by {@code SellingStatus}, never stored verbatim. */
        String rawSellingStatus,
        String brand,
        String manufacturer,
        String category,
        String description,
        Map<String, String> attributes,
        List<CanonicalProductVariant> variants,
        /**
         * When SELLEROPS read this row from the channel — the collection instant, always.
         *
         * <p>Not the channel's own "last modified". The two were one field, and each connector filled
         * it differently: Cafe24 with {@code updated_date}, NAVER with {@code modifiedDate}, Coupang
         * with the read time. So a catalogue read on 2026-08-22 produced listings stamped 2014, and
         * every staleness verdict computed from them said STALE about a product that had just been
         * read successfully — the freshness of the READ confused with the age of the PRODUCT.
         */
        Instant observedAt,
        /**
         * When the CHANNEL says the row last changed, or null when it does not say.
         *
         * <p>Null is the honest answer for a channel that publishes no such field; it is never derived
         * from {@code observedAt}, which would assert that the product changed at the moment we
         * happened to look at it.
         */
        Instant sourceUpdatedAt,
        String sourceKind,
        int sourceRow) {

    public CanonicalProduct {
        attributes = attributes == null ? Map.of() : Map.copyOf(attributes);
        variants = variants == null ? List.of() : List.copyOf(variants);
    }

    /** Identity only — the shape a channel that lists products but details them separately emits. */
    public static CanonicalProduct identity(String externalProductId, String name, String sku,
                                            Instant observedAt, String sourceKind, int sourceRow) {
        return identity(externalProductId, name, sku, observedAt, null, sourceKind, sourceRow);
    }

    /** Identity plus the channel's own last-changed time, when it states one. */
    public static CanonicalProduct identity(String externalProductId, String name, String sku,
                                            Instant observedAt, Instant sourceUpdatedAt,
                                            String sourceKind, int sourceRow) {
        return new CanonicalProduct(externalProductId, name, sku, null, null, null, null, null, null,
                null, null, Map.of(), List.of(), observedAt, sourceUpdatedAt, sourceKind, sourceRow);
    }
}
