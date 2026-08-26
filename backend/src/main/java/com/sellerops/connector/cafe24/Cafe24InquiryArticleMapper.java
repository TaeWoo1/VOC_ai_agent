package com.sellerops.connector.cafe24;

import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelOrderRef;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.ingest.canonical.SourceThreadRole;

/**
 * Maps a Cafe24 board-6 (문의사항) article row to a source-agnostic
 * {@link CanonicalInquiry}, so a product inquiry flows into the common inquiry +
 * OPEN work-queue path (the seller-confirmed reply lifecycle) rather than the
 * community/VOC store. Board-4 reviews keep using {@link Cafe24BoardArticleMapper};
 * board 9 (1:1 맞춤상담) is never collected.
 *
 * <p><b>Identity is Cafe24-native only.</b> The dedup {@code externalId} encodes the
 * mall's own {@code (board, article)} pair and the product ref is the mall's {@code
 * product_no}. No external-marketplace / Market Plus origin is read, inferred, or
 * stored — none is present in the row projection ({@link Cafe24BoardArticleRow}
 * ignores every other field). Buyer/writer PII is never read (not projected) and
 * never persisted.
 *
 * <p><b>The product is decided by {@code product_no} and by nothing else.</b> Until
 * 2026-08-24 this mapper passed {@code product_no} as a canonical {@code sku} and let
 * ingest resolve-or-create on it, which is a different rule wearing the same clothes:
 * Cafe24's {@code product_no} is a <em>listing</em> key, while {@code products.sku} is
 * the seller's own code ({@code custom_product_code} — {@code Cafe24ProductMapper}
 * prefers it), so the two matched only for listings whose seller set no code. When they
 * did not match, ingest invented a product named after the number. Three such rows exist
 * in the canonical Demo Org ({@code 91}, {@code 94}, {@code 170}) and all three numbers
 * are present in {@code channel_products} as real, linked listings — the attribution was
 * available and was replaced by a fabrication.
 *
 * <p>Declaring a {@link ChannelProductRef} makes that impossible: ingest matches
 * {@code (channel_id, external_product_id)} exactly or attributes nothing. An article
 * with no {@code product_no} — which on board 6 is nearly all of them — yields
 * {@link ChannelProductRef#absent()}, and unattributed is the true answer for it.
 *
 * <p><b>The order is decided by {@code order_id} and by nothing else</b> — the same rule as the
 * product, for the same reason. Declaring a {@link ChannelOrderRef} tells ingest to bind exactly or
 * not at all; an article with a blank {@code order_id}, which on board 6 is expected to be most of
 * them, yields {@link ChannelOrderRef#absent()} and stays unbound. Board 4 (리뷰) never travels this
 * method and never declares an order lane at all.
 *
 * <p><b>An answer on this board is itself an article.</b> Cafe24 publishes a seller's answer as a
 * CHILD article hanging off the question ({@code parent_article_no}), proven by an approved bounded
 * READ on 2026-08-25 — verdict {@code STANDARD_BOARD_REPLY_ARTICLE},
 * {@code docs/inquiry_answer_execution_v1.md}. Until that proof this mapper read every board-6 row as
 * an independent customer inquiry, so the shop's own answers entered the seller's 미답변 queue as
 * customers still waiting. The row's structural role now travels with it as {@link SourceThreadRole},
 * and a {@code REPLY} carries the parent's external id so the relation survives without a second
 * identifier vocabulary.
 *
 * <p><b>The role says nothing about who wrote it.</b> A {@code REPLY} is not promoted to the parent's
 * {@code answerBody}: the child's {@code reply_user_id} was observed absent, and the fields that name
 * an author carry customer PII and are not projected. "이 글은 새 고객 문의가 아니다"는 증명됐고
 * "이 글은 판매자가 썼다"는 증명되지 않았다 — 그래서 전자만 쓴다.
 *
 * <p><b>And an answer can also be a COMMENT.</b> A second approved bounded READ on 2026-08-26
 * ({@code apr-c24-a3674-obs}) found a shop answer that produced no child article and left
 * {@code reply_status} at {@code N} — verdict {@code STANDARD_BOARD_COMMENT}. So {@code reply_status}
 * is not "the answered flag"; it is one representation's flag, and a board-6 article can be answered
 * with that flag untouched. {@link Cafe24InquiryAnswerObserver} supplies the second signal, and only
 * when {@code member_id == mall_id} proves the SHOP wrote the comment — the authorship proof the
 * reply-article lane never had.
 *
 * <p>Raw {@code reply_status} is preserved verbatim as {@code informStatus};
 * canonical {@code status} is {@code ANSWERED} when either the confirmed {@link
 * CommunityReplyStatus} <em>answered</em> token is present <em>or</em> a proven shop comment was
 * observed. The confirmed unanswered {@code N} and any token not yet observed live otherwise stay
 * {@code UNANSWERED}, so an inquiry with neither signal conservatively enters the OPEN queue.
 * Timestamps parse only when offset-bearing; a timezone-less value stays unknown.
 */
final class Cafe24InquiryArticleMapper {

    private Cafe24InquiryArticleMapper() {
    }

    /**
     * Build a canonical inquiry. The caller guarantees {@code row.articleNo()} is
     * non-null (a row without it cannot be keyed and is dropped upstream).
     * {@code sourceRow} is the 1-based position in the fetched page.
     */
    static CanonicalInquiry toCanonicalInquiry(int boardNo, Cafe24BoardArticleRow row, int sourceRow) {
        return toCanonicalInquiry(boardNo, row, sourceRow, null);
    }

    /**
     * As above, plus the answer this article does not carry.
     *
     * <p><b>{@code commentAnsweredAt} is a PROVEN shop comment and nothing weaker.</b>
     * {@link Cafe24InquiryAnswerObserver} passes an instant only when a comment on this article had
     * {@code member_id == mall_id} and a parseable timestamp; an unknown author yields null and this
     * method then behaves exactly as it did before the comment lane existed. So the widened status is
     * never an inference over comment PRESENCE — "someone commented" and "the shop answered" are
     * different claims and only the second one is allowed to close a customer's question.
     *
     * <p><b>{@code informStatus} still records what the CHANNEL said</b> — {@code N} for a
     * comment-answered article, because that is genuinely what {@code reply_status} reads. The pair
     * (raw {@code N}, canonical {@code ANSWERED}) is not a contradiction; it is the observation that
     * Cafe24 has more than one answer representation and only one of them moves that flag.
     *
     * <p><b>The comment's TEXT is not taken.</b> {@code answerBody} stays null, as it already does
     * for a reply-article answer: the fix asked for is "stop calling an answered question 미답변",
     * and storing the shop's words would be a second, separate claim with its own downstream (Answer
     * Memory). What is stored is the fact and its time.
     */
    static CanonicalInquiry toCanonicalInquiry(int boardNo, Cafe24BoardArticleRow row, int sourceRow,
                                               java.time.Instant commentAnsweredAt) {
        // Cafe24 uses 0 as "no product" on some board rows; only a positive number is an identity.
        String productNo = row.productNo() == null || row.productNo() <= 0
                ? null : Long.toString(row.productNo());
        String informStatus = blankToNull(row.replyStatus());
        // Fail-closed secrecy: only a positively-public flag ("F"/"false") reads public;
        // "T", null, blank, or any unrecognized value is treated as secret.
        boolean isSecret = !row.isPublicPost();
        SourceThreadRole role = row.isThreadReply() ? SourceThreadRole.REPLY : SourceThreadRole.ROOT;
        // A thread REPLY is not a question waiting for an answer, so a comment on one cannot mark
        // anything answered. Belt and braces: the observer already excludes replies from candidates.
        java.time.Instant answeredByComment =
                role == SourceThreadRole.ROOT ? commentAnsweredAt : null;
        String status = answeredByComment != null ? "ANSWERED" : toCanonicalStatus(informStatus);
        return new CanonicalInquiry(
                // Name and SKU are no longer how this source finds its product; leaving them null
                // keeps the resolve-or-create path unreachable from here.
                null,
                null,
                // Buyer PII is never read (not projected) and never persisted.
                null,
                row.content(),
                status,
                Cafe24BoardArticleMapper.parseOffsetInstant(row.createdDate()),
                externalId(boardNo, row.articleNo()),
                sourceRow,
                row.title(),
                informStatus,
                isSecret,
                // Board 6 is the mall's only inquiry surface SellerOps collects.
                null,
                ChannelProductRef.of(productNo),
                // A board article carries no seller answer body; only the reply_status flag — and a
                // comment's text is deliberately not taken as one (see above).
                null,
                answeredByComment,
                // The mall's own payment-unit order id. Cafe24 publishes no product-order granularity
                // on this row, so the reference is the payment unit and the reader treats it as one.
                ChannelOrderRef.of(row.orderId()),
                // ROOT or REPLY, decided by the source's own parent pointer and depth — never by
                // article-number adjacency. A REPLY is not a customer inquiry.
                role,
                role == SourceThreadRole.REPLY && row.parentArticleNo() != null
                        ? externalId(boardNo, row.parentArticleNo())
                        : null);
    }

    /** Stable Cafe24-native dedup key preserving the mall's own board+article identity. */
    public static String externalId(int boardNo, long articleNo) {
        return "cafe24:b" + boardNo + ":a" + articleNo;
    }

    /**
     * Collapse the raw reply token to the canonical binary status through the confirmed
     * {@link CommunityReplyStatus} vocabulary (Cafe24: {@code N}=답변전, {@code P}=처리중,
     * {@code C}=처리완료). {@code C} → {@code ANSWERED}; {@code N} and {@code P} (in
     * progress — still needs action) → {@code UNANSWERED}; blank/unrecognized stays
     * {@code UNANSWERED} (never guessed as answered).
     */
    private static String toCanonicalStatus(String rawReplyStatus) {
        return CommunityReplyStatus.normalize(rawReplyStatus) == CommunityReplyStatus.ANSWERED
                ? "ANSWERED"
                : "UNANSWERED";
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
