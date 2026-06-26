package com.sellerops.collect.dto;

/**
 * A single collected community article for the operator drill-down list —
 * <b>metadata only, deliberately no free-text body</b>. Title, content, the source
 * article/product numbers, and any writer identity are intentionally excluded: they
 * can carry customer PII, so they never enter this view. Operators get the shape of
 * what was collected (type, rating, reply state, dates); rendering sanitized content
 * is a separate, PII-reviewed follow-up.
 *
 * <p>{@code type} is the operator-facing kind (REVIEW / INQUIRY). Dates are KST
 * calendar dates with no time-of-day or elapsed duration; {@code sourceCreatedDate}
 * is null when the source value was timezone-less (unknown), never an assumed date.
 */
public record CommunityArticleView(
        String type,
        String channelNameKo,
        Integer rating,
        String replyStatus,
        String sourceCreatedDate,
        String collectedDate) {
}
