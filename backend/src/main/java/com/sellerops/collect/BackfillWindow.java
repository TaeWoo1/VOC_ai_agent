package com.sellerops.collect;

import com.sellerops.common.ApiException;
import java.time.LocalDate;

/**
 * An operator-selected, bounded date window [{@code startDate}, {@code endDate}]
 * for an initial backfill run. The dates are interpreted in the connector's own
 * platform zone (Cafe24 = KST) and reach the provider's date filter unchanged;
 * this is a collection window, not a recency signal, so it carries no time-of-day
 * and never feeds the {@code eventTimeMs} chain.
 *
 * <p>{@link #of} is the only constructor — it fails closed on a missing or
 * inverted window so an unbounded or empty sweep can never be requested by
 * mistake.
 */
public record BackfillWindow(LocalDate startDate, LocalDate endDate) {

    public static BackfillWindow of(LocalDate startDate, LocalDate endDate) {
        if (startDate == null || endDate == null) {
            throw ApiException.badRequest("백필 기간의 시작일과 종료일을 모두 입력해 주세요.");
        }
        if (startDate.isAfter(endDate)) {
            throw ApiException.badRequest("백필 시작일은 종료일보다 늦을 수 없습니다.");
        }
        return new BackfillWindow(startDate, endDate);
    }
}
