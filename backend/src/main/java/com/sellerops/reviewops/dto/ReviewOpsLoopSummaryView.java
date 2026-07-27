package com.sellerops.reviewops.dto;

import com.sellerops.reviewimport.dto.DateRangeView;
import java.time.LocalDate;
import java.util.List;

/**
 * The repeated review-operations loop's "완료 결과 + 변화 요약", assembled at READ time from what already
 * exists — the account's import-health projection and the issue-memory change judgements. It owns no
 * durable state of its own (product-scope §1.7 carve-out, 2026-07-27: no new {@code OperationRun} body);
 * it is a projection, so it is always consistent with the two sources it composes.
 *
 * <p>Honesty carries through both halves. The collection half ({@code newCount}/{@code duplicateCount}/
 * {@code failedCount}, coverage) never claims every review is present — {@code coveredRows} elsewhere is
 * "scope exported", not "all rows reconciled". The change half is unvalidated candidate signals (see
 * {@link IssueChangeCountsView}).
 *
 * @param referenceDate the day this summary was computed for (UTC), so it is reproducible
 * @param lastCoveredDate the forward edge of coverage across the account's plans, or null if nothing covered
 * @param missingRanges date ranges concluded uncoverable (fail-closed MISSING), never silently dropped
 * @param nextRecommendedImport the next date to pull from, or null when nothing is outstanding
 * @param upToDate true when coverage reaches the reference date and nothing is outstanding
 * @param newCount rows newly added by the account's latest attempts
 * @param duplicateCount rows already present (overlap-safe dedup), reported not hidden
 * @param failedCount rows that failed to ingest
 * @param issueChange counts of change judgements over the working issues (candidate signals)
 */
public record ReviewOpsLoopSummaryView(LocalDate referenceDate, LocalDate lastCoveredDate,
                                       List<DateRangeView> missingRanges, LocalDate nextRecommendedImport,
                                       boolean upToDate, int newCount, int duplicateCount, int failedCount,
                                       IssueChangeCountsView issueChange) {
}
