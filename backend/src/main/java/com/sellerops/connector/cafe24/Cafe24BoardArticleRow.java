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
 * <p><b>{@code order_id} (2026-08-25).</b> The board-article response was live-observed to carry an
 * {@code order_id} key alongside the buyer keys ({@code docs/sellerops_cafe24_review_inquiry_capture.md}
 * §"PII-bearing keys"). It is projected here for the INQUIRY (board 6) path only — see
 * {@code Cafe24InquiryArticleMapper} — because "which order is this about" is an operational fact and
 * the buyer keys beside it are not. {@code writer}, {@code writer_email}, {@code member_id} and
 * {@code client_ip} remain unprojected, and a field that is not projected cannot be persisted later
 * by accident.
 *
 * <p><b>Whether board-6 articles actually POPULATE it is unobserved.</b> The key's presence in the
 * response was recorded; a non-empty value on a 문의사항 article was not. A general Q&amp;A board
 * accepts posts with no order behind them, so the honest expectation is that many are blank — and a
 * blank one yields {@link com.sellerops.ingest.canonical.ChannelOrderRef#absent()}, which is the
 * correct answer rather than a failure.
 *
 * <p><b>Thread structure (2026-08-25).</b> {@code parent_article_no}, {@code reply_depth} and
 * {@code reply_sequence} are projected because a Cafe24 board answer <em>is itself an article</em>,
 * hanging off the question — proven by an approved bounded READ
 * ({@code docs/inquiry_answer_execution_v1.md}). They were already in every response this connector
 * has ever received and were being discarded, which is why a seller's own answer was stored as a
 * customer inquiry still waiting for one. Reading them costs no new request, no new endpoint and no
 * new scope.
 *
 * <p><b>{@code reply_user_id} is deliberately NOT projected.</b> It would be the one field that could
 * argue a reply article was written by the shop rather than by another customer — and on the one
 * child article ever observed it was <em>absent</em>, so it cannot carry that argument anyway. What
 * it can do is put an operator identity into a row projection that other code may later persist. The
 * honest state is that seller authorship of a reply article is unproven; this file stays as it is
 * until a proof exists that does not need an identity value.
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
        @JsonProperty("secret") String secret,
        @JsonProperty("order_id") String orderId,
        @JsonProperty("parent_article_no") Long parentArticleNo,
        @JsonProperty("reply_depth") Integer replyDepth,
        @JsonProperty("reply_sequence") Integer replySequence) {

    /** Back-compat for callers written before the thread-structure fields were projected. */
    public Cafe24BoardArticleRow(Long articleNo, String title, String content, Long productNo,
                                 Integer rating, String createdDate, String updatedDate,
                                 String replyStatus, String secret, String orderId) {
        this(articleNo, title, content, productNo, rating, createdDate, updatedDate, replyStatus,
                secret, orderId, null, null, null);
    }

    /** Back-compat for fixtures/tests written before {@code order_id} was projected. */
    public Cafe24BoardArticleRow(Long articleNo, String title, String content, Long productNo,
                                 Integer rating, String createdDate, String updatedDate,
                                 String replyStatus, String secret) {
        this(articleNo, title, content, productNo, rating, createdDate, updatedDate, replyStatus,
                secret, null, null, null, null);
    }

    /**
     * Back-compat constructor for callers that do not carry a {@code secret} flag
     * (existing tests / non-review fixtures): defaults {@code secret} to {@code null},
     * which {@link #isPublicPost()} treats as fail-closed (not public).
     */
    public Cafe24BoardArticleRow(Long articleNo, String title, String content, Long productNo,
                                 Integer rating, String createdDate, String updatedDate,
                                 String replyStatus) {
        this(articleNo, title, content, productNo, rating, createdDate, updatedDate, replyStatus,
                null, null, null, null, null);
    }

    /**
     * Is this article a REPLY inside a thread rather than the thread's first post?
     *
     * <p><b>Only the source's own structural relation decides.</b> {@code parent_article_no} names the
     * post this one hangs off; {@code reply_depth} says how deep it sits. Article-number adjacency —
     * "247 came right after 246, so it must be the answer to it" — decides nothing here and must not:
     * on a board where several people post in the same minute, adjacency is a coincidence, and a
     * coincidence that silences a real customer question is not recoverable by apology.
     *
     * <p><b>Fail closed toward "not a new customer inquiry".</b> Either signal alone is enough: a
     * positive {@code parent_article_no}, or a {@code reply_depth} above zero. The two have only ever
     * been observed agreeing (a root at depth 0 with no parent; its answer at depth 1 naming the
     * root), so a disagreement means the response is not the shape this was built against — and the
     * safe reading of an unexpected shape is the one that does not put possibly-our-own text in front
     * of the seller as a customer waiting for an answer. The classification is recomputed from the
     * source on every sweep, so it is self-healing rather than a one-way write.
     */
    public boolean isThreadReply() {
        return (parentArticleNo != null && parentArticleNo > 0)
                || (replyDepth != null && replyDepth > 0);
    }

    /**
     * True when the two thread signals point opposite ways — a parent with depth 0, or depth above
     * zero with no parent. Never observed; surfaced as a sanitized count so that if the response
     * shape ever changes it is visible rather than absorbed by {@link #isThreadReply()}'s OR.
     */
    public boolean threadSignalsDisagree() {
        boolean hasParent = parentArticleNo != null && parentArticleNo > 0;
        boolean deep = replyDepth != null && replyDepth > 0;
        return hasParent != deep;
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
