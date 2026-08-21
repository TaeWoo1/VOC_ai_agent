package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;

/**
 * Projection of one Cafe24 Admin product row ({@code GET /api/v2/admin/products}) — the catalogue
 * fields Product Knowledge needs, and nothing else.
 *
 * <p><b>Wire shape is {@code NEEDS_VERIFICATION}.</b> Field names come from Cafe24's published Admin
 * API product resource and have NOT been observed on a live mall from this repository — the same status
 * the ESM inquiry skeleton carries and states. Every field except {@code product_no} is nullable, so an
 * absent or renamed field degrades to "we do not hold this" ({@code KnowledgeCoverage.UNAVAILABLE})
 * rather than to a crash or, worse, to a fabricated value.
 *
 * <p><b>Scope.</b> This read requires {@code mall.read_product}, which malls connected before Operator
 * Graph v2 did NOT grant — the stored scope list was {@code mall.read_community,mall.read_order}. A
 * token without it fails as {@code insufficient_scope}, which {@link Cafe24OAuthException} already
 * classifies distinctly from "reconnect", and the capability surface reports it as a re-consent item.
 * Nothing here attempts to widen a grant on its own.
 *
 * <p>No buyer field exists on this resource and none is projected.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cafe24ProductRow(
        @JsonProperty("product_no") Long productNo,
        @JsonProperty("product_code") String productCode,
        @JsonProperty("product_name") String productName,
        @JsonProperty("eng_product_name") String engProductName,
        @JsonProperty("custom_product_code") String customProductCode,
        @JsonProperty("price") BigDecimal price,
        @JsonProperty("retail_price") BigDecimal retailPrice,
        /** {@code T}/{@code F} — whether the product is on sale. */
        @JsonProperty("selling") String selling,
        /** {@code T}/{@code F} — whether it is displayed. Not the same as being sellable. */
        @JsonProperty("display") String display,
        @JsonProperty("brand_name") String brandName,
        @JsonProperty("manufacturer_name") String manufacturerName,
        @JsonProperty("summary_description") String summaryDescription,
        @JsonProperty("simple_description") String simpleDescription,
        @JsonProperty("origin_place_value") String originPlace,
        @JsonProperty("product_weight") String productWeight,
        @JsonProperty("created_date") String createdDate,
        @JsonProperty("updated_date") String updatedDate) {

    /**
     * The selling status token this row states, as one value for {@code SellingStatus} to normalize.
     *
     * <p>{@code selling} and {@code display} are two different facts and only the first is about
     * sellability. A product that is selling but hidden is still selling; a product that is displayed
     * but not selling is not. Reporting the second as the first is the kind of small inversion that
     * makes a seller think a dead listing is live, so {@code selling} decides and {@code display} is
     * ignored here.
     */
    public String sellingToken() {
        return selling;
    }
}
