package com.sellerops.proactive.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One card on 「AI가 먼저 확인한 일」.
 *
 * <p><b>Everything a seller needs to decide whether to open it, and nothing more.</b> The snippet is
 * the same PII-masked preview the inbox feed shows (one implementation, shared); the buyer's name,
 * the raw body, any order identifier and every internal id beyond the two the CTA needs are absent by
 * construction rather than by filtering.
 *
 * @param subjectKind      INQUIRY / REVIEW — which existing flow the CTA opens
 * @param workItemId       the inquiry's work item, so the card can deep-link into the response flow
 * @param reasonNote       why this is on screen now, in the seller's language — one or two sentences
 * @param evidenceState    the four-value library state for a prepared draft; null for a review
 * @param knowledgeGap     what the seller could add so the next draft is grounded, or null
 * @param preparedAction   how far the preparation got
 * @param draftVersion     the append-only draft version prepared, or null
 * @param recommendation   the next action, or the reason the preparation stopped short
 */
public record ProactiveCaseView(
        UUID id,
        String subjectKind,
        UUID subjectId,
        UUID workItemId,
        UUID channelId,
        String channelNameKo,
        UUID productId,
        String productName,
        String snippet,
        Integer rating,
        String priority,
        String reason,
        String reasonNote,
        String evidenceState,
        int evidenceCount,
        String knowledgeGap,
        String preparedAction,
        Integer draftVersion,
        String recommendation,
        Instant subjectReceivedAt,
        Instant preparedAt) {
}
