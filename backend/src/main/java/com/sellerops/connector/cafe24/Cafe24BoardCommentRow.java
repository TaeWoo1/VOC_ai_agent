package com.sellerops.connector.cafe24;

/**
 * One Cafe24 board comment, reduced to what the inquiry lane can act on.
 *
 * <p>Four values, and the fourth is the whole point: {@code authoredByMall} is the ANSWER to
 * "did the shop write this", computed in {@link Cafe24BoardCommentsClient} from
 * {@code member_id == mall_id} and carried instead of the id. The comment's text, its writer name,
 * its ip and its attachments have no field here, so nothing downstream can persist them.
 *
 * <p>{@code createdDate} is the source's own string; parsing is
 * {@link Cafe24BoardArticleMapper#parseOffsetInstant} like every other Cafe24 timestamp — a
 * timezone-less value stays unknown rather than being assumed KST.
 */
public record Cafe24BoardCommentRow(Long commentNo, Long articleNo, String createdDate,
                                    boolean authoredByMall) {
}
