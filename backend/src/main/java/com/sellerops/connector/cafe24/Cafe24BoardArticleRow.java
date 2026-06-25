package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Projection of one Cafe24 Admin board-article row
 * ({@code GET /api/v2/admin/boards/{board_no}/articles}) — the fields the
 * review/inquiry capture needs. Everything else in the article object is ignored.
 *
 * <p><b>Doc-asserted shape ({@code NEEDS_VERIFICATION}).</b> Field names, the
 * presence of {@code rating} on review boards, the concrete {@code reply_status}
 * tokens, and the {@code created_date}/{@code updated_date} formats are taken from
 * the Admin API docs and confirmed only at the gated live-shape step (PR C). Every
 * field is nullable so an unexpected/missing value is tolerated rather than fatal;
 * {@code article_no} is the one field a row cannot be stored without.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cafe24BoardArticleRow(
        @JsonProperty("article_no") Long articleNo,
        @JsonProperty("title") String title,
        @JsonProperty("content") String content,
        @JsonProperty("product_no") Long productNo,
        @JsonProperty("rating") Integer rating,
        @JsonProperty("created_date") String createdDate,
        @JsonProperty("updated_date") String updatedDate,
        @JsonProperty("reply_status") String replyStatus) {
}
