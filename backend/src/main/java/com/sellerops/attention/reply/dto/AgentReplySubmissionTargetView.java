package com.sellerops.attention.reply.dto;

/**
 * What a guided NAVER reply run needs, resolved ONCE from a {@code submissionRef} by the Local Agent
 * under its own JWT — exactly the fields {@code reply-submission-target-client.ts} parses, nothing more.
 *
 * <p>The review's identity leaves as fingerprints (body, channel review id), the reply text leaves as the
 * approved body the agent must place into the composer, and the draft version names which approved head
 * that body is. No buyer, no raw review body, no timestamps beyond the KST as-of date the recency bucket
 * was computed against. {@code executionMode} and {@code operation} restate the intent the ref binds.
 */
public record AgentReplySubmissionTargetView(
        String accountId,
        String actionRef,
        ReviewReplyTargetHintView targetHint,
        String asOfDate,
        String channelReviewIdFingerprint,
        String draftBody,
        Integer draftVersion,
        String draftFingerprint,
        String operation,
        String executionMode) {
}
