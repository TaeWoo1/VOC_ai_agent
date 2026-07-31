package com.sellerops.connector.cafe24.spike;

import com.sellerops.community.CommunityReplyStatus;

/**
 * The sanitized result of one spike run — <b>counts, booleans, and closed-vocabulary
 * status tokens only</b>. It deliberately carries no comment content, no password,
 * no writer value, no mall id, no access token, and no article title/body. Every
 * field here is safe to log and to copy into the (sanitized) proof.
 *
 * @param outcome            terminal phase (closed vocabulary)
 * @param verdict            capability judgment A/B/C or NONE
 * @param commandId          idempotency key echoed back
 * @param idempotentReplay   true when this run returned a prior result unchanged
 * @param writeScopeGranted  was mall.write_community granted?
 * @param boardOk            was the target board 6?
 * @param testArticleConfirmed did the operator confirm an owned test inquiry?
 * @param approvalPresent    was a valid single-use approval supplied?
 * @param preStatus          normalized reply state observed before posting (null if not observed)
 * @param preStatusToken     raw token CLASS before posting: N/P/C/OTHER (null if not observed)
 * @param existingSpikeCommentFound was a prior spike comment already present?
 * @param commentsBefore     comment count before posting (-1 if not observed)
 * @param commentsAfter      comment count after posting (-1 if not observed)
 * @param spikeCommentsCreated number of spike-marker comments this run created (0 or 1)
 * @param postStatus         normalized reply state observed after posting (null if not posted)
 * @param postStatusToken    raw token CLASS after posting: N/P/C/OTHER (null if not posted)
 */
public record SpikeReplyResult(
        SpikeReplyOutcome outcome,
        SpikeVerdict verdict,
        String commandId,
        boolean idempotentReplay,
        boolean writeScopeGranted,
        boolean boardOk,
        boolean testArticleConfirmed,
        boolean approvalPresent,
        CommunityReplyStatus preStatus,
        String preStatusToken,
        boolean existingSpikeCommentFound,
        int commentsBefore,
        int commentsAfter,
        int spikeCommentsCreated,
        CommunityReplyStatus postStatus,
        String postStatusToken) {

    /** A copy of this result flagged as an idempotent replay of a prior run. */
    public SpikeReplyResult withReplay() {
        return new SpikeReplyResult(outcome, verdict, commandId, true,
                writeScopeGranted, boardOk, testArticleConfirmed, approvalPresent,
                preStatus, preStatusToken, existingSpikeCommentFound,
                commentsBefore, commentsAfter, spikeCommentsCreated,
                postStatus, postStatusToken);
    }

    /**
     * Classify a raw reply_status token into a closed vocabulary safe to surface:
     * only the three official single-letter tokens are echoed; anything else → OTHER.
     * This guarantees no arbitrary raw string ever leaves the connector via a result.
     */
    public static String tokenClass(String rawReplyStatus) {
        if (rawReplyStatus == null) {
            return "OTHER";
        }
        return switch (rawReplyStatus.strip().toUpperCase(java.util.Locale.ROOT)) {
            case "N" -> "N";
            case "P" -> "P";
            case "C" -> "C";
            default -> "OTHER";
        };
    }
}
