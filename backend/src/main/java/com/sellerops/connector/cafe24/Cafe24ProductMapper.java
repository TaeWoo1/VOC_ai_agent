package com.sellerops.connector.cafe24;

import com.sellerops.ingest.canonical.CanonicalProduct;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Maps a Cafe24 Admin product row to a source-agnostic {@link CanonicalProduct}.
 *
 * <p><b>Absence maps to null, never to a placeholder.</b> A field the mall did not return produces no
 * fact, and the reading side reports {@code KnowledgeCoverage.UNAVAILABLE} for that facet — which is
 * the true statement. A mapper that substituted an empty string would turn "we do not know the
 * description" into "the description is empty", and only one of those is a fact.
 *
 * <p>{@code observedAt} is the row's own {@code updated_date} when the mall states one, and the
 * collection instant otherwise. Staleness is computed from it, so defaulting it to "now" for a row
 * that actually carries a date would make an old catalogue look freshly read.
 */
public final class Cafe24ProductMapper {

    /** The provenance stamp every row from this read carries. */
    public static final String SOURCE = "CAFE24:PRODUCT_API:v2";

    private Cafe24ProductMapper() {
    }

    /** Null when the row carries no {@code product_no} — a listing with no identity cannot be stored. */
    public static CanonicalProduct toCanonical(Cafe24ProductRow row, int sourceRow, Instant fallbackNow) {
        if (row == null || row.productNo() == null || row.productNo() <= 0) {
            return null;
        }
        String externalId = Long.toString(row.productNo());
        Instant observed = parseOffsetInstant(row.updatedDate());
        if (observed == null) {
            observed = parseOffsetInstant(row.createdDate());
        }
        if (observed == null) {
            observed = fallbackNow;
        }

        Map<String, String> attributes = new LinkedHashMap<>();
        put(attributes, "원산지", row.originPlace());
        put(attributes, "상품무게", row.productWeight());

        return new CanonicalProduct(
                externalId,
                blankToNull(row.productName()),
                // The SKU is the seller's own product code when they set one, and the mall's product
                // number otherwise — the SAME key Cafe24InquiryArticleMapper already uses as the SKU, so
                // a product read and an inquiry read converge on one product row instead of two.
                firstPresent(row.customProductCode(), externalId),
                null, // Cafe24's admin product resource carries no storefront URL. UNAVAILABLE, honestly.
                row.price(),
                row.price() == null ? null : "KRW",
                row.sellingToken(),
                blankToNull(row.brandName()),
                blankToNull(row.manufacturerName()),
                null, // category comes from a separate resource; not read here, so not claimed
                firstPresent(blankToNull(row.summaryDescription()), blankToNull(row.simpleDescription())),
                attributes,
                List.of(), // variants come from /products/{no}/variants — a separate, bounded read
                observed,
                SOURCE,
                sourceRow);
    }

    private static void put(Map<String, String> into, String key, String value) {
        String trimmed = blankToNull(value);
        if (trimmed != null) {
            into.put(key, trimmed);
        }
    }

    private static String firstPresent(String... values) {
        for (String value : values) {
            String trimmed = blankToNull(value);
            if (trimmed != null) {
                return trimmed;
            }
        }
        return null;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    /**
     * Cafe24 timestamps carry an offset; a value without one is left {@code null} rather than assigned a
     * zone. Same rule {@code Cafe24BoardArticleMapper} states: an assumed timezone is a fabricated fact,
     * and here it would feed a staleness verdict.
     */
    private static Instant parseOffsetInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value.strip()).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
