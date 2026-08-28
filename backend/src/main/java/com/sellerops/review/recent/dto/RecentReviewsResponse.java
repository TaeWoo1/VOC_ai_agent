package com.sellerops.review.recent.dto;

import com.sellerops.coverage.dto.ChannelCoverageRow;
import java.time.LocalDate;
import java.util.List;

/**
 * The window's rows, their total, and — beside them — whether each channel's review record is
 * current enough for the rows to mean "what came in".
 *
 * <p><b>Rows and coverage travel together on purpose.</b> A list of seven reviews for 「오늘」 looks
 * identical whether the channel was read an hour ago or a week ago; only the coverage rows can say
 * which. The caller that turns this into a sentence needs both in one response, or it will say
 * 「0건」 about a channel it has not actually read.
 *
 * @param total the sum of per-channel counts under the same predicate as {@code items} — the
 *     number the rows were cut from, never the number shown
 */
public record RecentReviewsResponse(
        LocalDate from,
        LocalDate to,
        boolean negativeOnly,
        long total,
        List<RecentReviewItemView> items,
        List<ChannelCoverageRow> coverage) {
}
