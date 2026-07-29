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
 *
 * <p><b>{@code secret} (비밀글 flag).</b> Cafe24's Admin board-article {@code secret}
 * is a {@code "T"}(비밀글 / private)/{@code "F"}(공개 / public) string — the platform's
 * standard boolean-like flag convention — and was observed present on the board-article
 * response at the PR-C shape step. It is captured only to <b>gate storage</b>: the
 * review (구매후기, board 4) path stores a post only when {@link #isPublicPost()}
 * positively confirms it is public, so a private post's title/content never reach the
 * mapper, storage, or any log. The value itself is never persisted.
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
        @JsonProperty("reply_status") String replyStatus,
        @JsonProperty("secret") String secret) {

    /**
     * Back-compat constructor for callers that do not carry a {@code secret} flag
     * (existing tests / non-review fixtures): defaults {@code secret} to {@code null},
     * which {@link #isPublicPost()} treats as fail-closed (not public).
     */
    public Cafe24BoardArticleRow(Long articleNo, String title, String content, Long productNo,
                                 Integer rating, String createdDate, String updatedDate,
                                 String replyStatus) {
        this(articleNo, title, content, productNo, rating, createdDate, updatedDate, replyStatus, null);
    }

    /**
     * Fail-closed public-post check for the 구매후기 (board 4) review path. Returns
     * {@code true} <b>only</b> when {@code secret} positively confirms a public post —
     * the documented {@code "F"} token (trimmed, case-insensitive), or a {@code "false"}
     * boolean coercion. Every other shape — {@code "T"}, null, blank, or any
     * unrecognized/changed value — returns {@code false} so the caller excludes the row.
     * A genuinely private post is never {@code "F"}/{@code "false"}, so this can never
     * store a private post, while an unexpected contract change fails safe (excluded),
     * loud (a sanitized exclusion count), and recoverable.
     */
    public boolean isPublicPost() {
        if (secret == null) {
            return false;
        }
        String token = secret.strip();
        return token.equalsIgnoreCase("F") || token.equalsIgnoreCase("FALSE");
    }
}
