package com.sellerops.connector.cafe24.spike;

/**
 * The dry-run plan: what the spike WOULD do, computed from the command alone with
 * <b>zero external calls</b>. Carries no content, writer, password, token, or mall
 * id — only the target board/article, the intended content source, and a coarse
 * preflight note derived from the command fields.
 *
 * @param boardNo         target board
 * @param articleNo       target article
 * @param contentSource   FIXED phrase or OPERATOR override
 * @param writerMarker    the fixed non-identifying writer marker that would be used
 * @param approvalWouldBeRequired always true — a live run needs a single-use approval
 * @param preflightNote   BOARD_OK / WRONG_BOARD / NOT_TEST_ARTICLE (command-only check)
 */
public record SpikeReplyPlan(
        int boardNo,
        long articleNo,
        SpikeReplyCommand.ContentSource contentSource,
        String writerMarker,
        boolean approvalWouldBeRequired,
        String preflightNote) {
}
