package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Projection of one Cafe24 Admin board-article row
 * ({@code GET /api/v2/admin/boards/{board_no}/articles}) — the fields the
 * review/inquiry capture needs. Everything else in the article object is ignored.
 *
 * <p><b>Shape live-verified (boards 4/6).</b> Field names, the presence of
 * {@code rating} on review boards, the observed {@code reply_status} tokens, and the
 * {@code created_date}/{@code updated_date} formats were confirmed at the gated
 * live-shape step (PR C) and the live runtime backfill runs. The one token still
 * unobserved is the <em>answered</em> {@code reply_status} value — it stays
 * {@code UNKNOWN} until seen. Every field is nullable so an unexpected/missing value
 * is tolerated rather than fatal; {@code article_no} is the one field a row cannot
 * be stored without.
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
