package com.sellerops.connector.cafe24;

/**
 * One Cafe24 board comment, reduced to what the inquiry lane can act on.
 *
 * <p>Four values, and the fourth is the whole point: {@code authoredByMall} is the ANSWER to
 * "did the shop write this", computed in {@link Cafe24BoardCommentsClient} from
 * {@code member_id == mall_id} and carried instead of the id. The comment's text, its writer name,
 * its ip and its attachments have no field here, so nothing downstream can persist them.
 *
 * <p>The fifth, {@code contentHash}, is a one-way SHA-256 of the whitespace-collapsed text — the ONLY
 * shape the text may take past the client. It exists so the review lane can verify that a comment
 * reviewnary posted is the approved draft ({@code Cafe24ReviewCommentAdapter}); the raw text is
 * digested in the client and dropped, and a hash of a customer's words is not the words.
 *
 * <p>{@code createdDate} is the source's own string; parsing is
 * {@link Cafe24BoardArticleMapper#parseOffsetInstant} like every other Cafe24 timestamp — a
 * timezone-less value stays unknown rather than being assumed KST.
 */
public record Cafe24BoardCommentRow(Long commentNo, Long articleNo, String createdDate,
                                    boolean authoredByMall, String contentHash) {

    /** The pre-hash shape, kept for every reader that never needed a comparison value. */
    public Cafe24BoardCommentRow(Long commentNo, Long articleNo, String createdDate, boolean authoredByMall) {
        this(commentNo, articleNo, createdDate, authoredByMall, null);
    }
}
