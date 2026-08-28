package com.sellerops.review.publish.cafe24;

import com.sellerops.connector.cafe24.Cafe24Authorizer;
import com.sellerops.connector.cafe24.Cafe24BoardCommentRow;
import com.sellerops.connector.cafe24.Cafe24BoardCommentsClient;
import com.sellerops.connector.cafe24.Cafe24WriteApprovalRequired;
import com.sellerops.inquiry.publish.cafe24.Cafe24AnswerExecutionGrant;
import com.sellerops.review.publish.ReviewExecutionReason;
import com.sellerops.review.publish.ReviewExecutionVerification;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The Cafe24 review-reply adapter: an approved reply to a 구매후기 becomes a shop COMMENT under the
 * review article — the representation the seller's own admin screen produces
 * ({@code docs/cafe24_comment_answer_observation_v1.md}, verdict {@code STANDARD_BOARD_COMMENT}).
 *
 * <p><b>One POST, then a READ.</b> A 2xx is not a verified send. Verification re-reads the article's
 * comments ({@code Cafe24BoardCommentsClient}, which now carries a content hash and still no content)
 * and requires a comment that is the shop's own ({@code member_id == mall_id}) AND hashes to the
 * approved body. Four terminal readings, none of which is a reason to POST again:
 *
 * <ul>
 *   <li>{@code VERIFIED} — such a comment exists.</li>
 *   <li>{@code STATUS_UNRESOLVED} — a shop comment exists, but none hashes to the approved text.</li>
 *   <li>{@code DELIVERY_UNKNOWN} — no shop comment on the target at all.</li>
 *   <li>{@code UNVERIFIABLE} — the read-back could not run.</li>
 * </ul>
 *
 * <p><b>What it will not do.</b> It does not touch the review article's {@code reply_status}, does not
 * delete or edit, does not retry, and holds no password after the request returns.
 */
public class Cafe24ReviewCommentAdapter {

    /** {@code cafe24:b4:a123} — the promoter's identity for a board review. */
    private static final Pattern EXTERNAL_ID =
            Pattern.compile("^cafe24:b(?<board>[0-9]{1,9}):a(?<article>[0-9]{1,18})$");

    private final Cafe24ReviewCommentClient writeClient;
    private final Cafe24BoardCommentsClient readClient;
    private final Cafe24Authorizer authorizer;
    private final Cafe24AnswerExecutionGrant grant;
    private final int shopNo;

    public Cafe24ReviewCommentAdapter(Cafe24ReviewCommentClient writeClient,
                                      Cafe24BoardCommentsClient readClient,
                                      Cafe24Authorizer authorizer,
                                      Cafe24AnswerExecutionGrant grant,
                                      int shopNo) {
        this.writeClient = writeClient;
        this.readClient = readClient;
        this.authorizer = authorizer;
        this.grant = grant;
        this.shopNo = shopNo;
    }

    /** What the POST did, or why it was not attempted. */
    public record PostResult(Kind kind, Long commentNo, ReviewExecutionReason reason) {

        public enum Kind { ACCEPTED, REFUSED, DELIVERY_UNKNOWN }

        static PostResult refused(ReviewExecutionReason reason) {
            return new PostResult(Kind.REFUSED, null, reason);
        }
    }

    /** Post the approved body as a shop comment under the review the external id names. */
    public PostResult post(UUID orgId, UUID sellerAccountId, String externalId, String approvedBody) {
        Target target = Target.parse(externalId);
        if (target == null) {
            return PostResult.refused(ReviewExecutionReason.TARGET_UNPARSEABLE);
        }
        if (!grant.hasWriteGrant(orgId, sellerAccountId)) {
            return PostResult.refused(ReviewExecutionReason.WRITE_GRANT_MISSING);
        }
        if (shopNo <= 0) {
            return PostResult.refused(ReviewExecutionReason.SHOP_NO_UNSET);
        }
        if (approvedBody == null || approvedBody.isBlank()) {
            return PostResult.refused(ReviewExecutionReason.REJECTED_BY_CHANNEL);
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(orgId, sellerAccountId);
        } catch (RuntimeException e) {
            return PostResult.refused(ReviewExecutionReason.AUTH_FAILED);
        }
        Cafe24ReviewCommentClient.Outcome outcome;
        try {
            // Outcome A: a fresh per-comment secret, alive for this one call.
            outcome = writeClient.post(auth.accessToken(), auth.mallId(),
                    new Cafe24ReviewCommentClient.Comment(shopNo, target.boardNo(), target.articleNo(),
                            approvedBody, auth.mallId(), auth.mallId(), Cafe24CommentPassword.fresh()));
        } catch (Cafe24WriteApprovalRequired unarmed) {
            return PostResult.refused(ReviewExecutionReason.NOT_ARMED);
        } catch (RuntimeException failure) {
            return PostResult.refused(ReviewExecutionReason.REJECTED_BY_CHANNEL);
        }
        return switch (outcome.kind()) {
            case ACCEPTED -> new PostResult(PostResult.Kind.ACCEPTED, outcome.commentNo(), null);
            case REJECTED -> PostResult.refused(ReviewExecutionReason.REJECTED_BY_CHANNEL);
            case RETRYABLE -> PostResult.refused(outcome.httpStatus() != null && outcome.httpStatus() == 429
                    ? ReviewExecutionReason.RATE_LIMITED : ReviewExecutionReason.AUTH_FAILED);
            case UNKNOWN -> new PostResult(PostResult.Kind.DELIVERY_UNKNOWN, null, null);
        };
    }

    /**
     * Read the comments back and decide. {@code commentNo} narrows to the created comment when the
     * create response named one; otherwise any shop comment with the approved hash counts.
     */
    public ReviewExecutionVerification verify(UUID orgId, UUID sellerAccountId, String externalId,
                                              String approvedBody, Long commentNo) {
        Target target = Target.parse(externalId);
        if (target == null) {
            return ReviewExecutionVerification.UNVERIFIABLE;
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(orgId, sellerAccountId);
        } catch (RuntimeException e) {
            return ReviewExecutionVerification.UNVERIFIABLE;
        }
        List<Cafe24BoardCommentRow> rows;
        try {
            rows = readClient.fetchComments(auth.accessToken(), auth.mallId(), target.boardNo(),
                    target.articleNo());
        } catch (RuntimeException e) {
            return ReviewExecutionVerification.UNVERIFIABLE;
        }
        return decide(rows, normalizedHash(approvedBody), commentNo);
    }

    /** The pure decision, so the mapping is testable without a transport. */
    static ReviewExecutionVerification decide(List<Cafe24BoardCommentRow> rows, String approvedHash,
                                              Long commentNo) {
        List<Cafe24BoardCommentRow> shop = rows.stream().filter(Cafe24BoardCommentRow::authoredByMall).toList();
        if (shop.isEmpty()) {
            return ReviewExecutionVerification.DELIVERY_UNKNOWN;
        }
        boolean matched = shop.stream()
                .filter(r -> commentNo == null || (r.commentNo() != null && r.commentNo().equals(commentNo)))
                .anyMatch(r -> approvedHash.equals(r.contentHash()));
        return matched ? ReviewExecutionVerification.VERIFIED : ReviewExecutionVerification.STATUS_UNRESOLVED;
    }

    /**
     * The comparison value — whitespace collapsed, nothing else normalized, SHA-256 hex. The same rule
     * {@code Cafe24BoardCommentsClient} applies to what it reads, so the two sides compare one thing.
     */
    public static String normalizedHash(String body) {
        String normalized = body == null ? "" : body.replaceAll("\\s+", " ").strip();
        try {
            byte[] out = MessageDigest.getInstance("SHA-256").digest(normalized.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(out.length * 2);
            for (byte b : out) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** The board and article an external id names, or null. */
    public record Target(int boardNo, long articleNo) {

        public static Target parse(String externalId) {
            if (externalId == null) {
                return null;
            }
            Matcher m = EXTERNAL_ID.matcher(externalId.strip());
            if (!m.matches()) {
                return null;
            }
            try {
                int board = Integer.parseInt(m.group("board"));
                long article = Long.parseLong(m.group("article"));
                return board > 0 && article > 0 ? new Target(board, article) : null;
            } catch (NumberFormatException e) {
                return null;
            }
        }
    }
}
