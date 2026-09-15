package com.sellerops.operationscase.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 「고객 운영 관리」 on the Operations Home: the responsibility's own state and its three exception areas.
 *
 * <p><b>Three populations, never added.</b> {@code decisions} counts open customer cases waiting for the seller
 * (and still waiting on the canonical record); {@code handled} counts what Reviewnary closed or is watching; {@code gaps}
 * counts sources the seller has to fix. {@code sources} is the latest finished run's observation facts — a source
 * with {@code completeness = NONE} carries {@code observedCount = null}, which is «could not observe», never 0.
 *
 * <p>{@code available = false}: this deployment does not run the job for this organisation; the screen draws nothing.
 */
public record CustomerOperationsHomeView(
        boolean available,
        boolean eligible,
        String status,
        int cadenceMinutes,
        Instant lastCheckedAt,
        String lastRunStatus,
        Instant nextCheckAt,
        List<SourceHealth> sources,
        Decisions decisions,
        Handled handled,
        Gaps gaps) {

    public record SourceHealth(String channelCode, String channelNameKo, String dataType, String completeness,
                               Integer observedCount, Integer newCount, String failureReason, Instant observedAt,
                               boolean sellerActionRequired) {
    }

    public record Decisions(long total, List<DecisionRow> rows) {
    }

    public record DecisionRow(UUID caseId, String subjectKind, String channelNameKo, String title, Integer rating,
                              String reasonNote, String summary, String recommendedActionType,
                              String recommendedAction, List<String> missingInformation, boolean draftPrepared,
                              String decidedBy, Instant openedAt, String to) {
    }

    public record Handled(Instant since, long autoResolved, long monitoring, long draftsPrepared,
                          List<HandledRow> rows) {
    }

    public record HandledRow(UUID caseId, String subjectKind, String channelNameKo, String title, Integer rating,
                             String disposition, String decidedBy, String reasonNote, String summary, String to) {
    }

    public record Gaps(long total, List<GapRow> rows) {
    }

    public record GapRow(UUID caseId, String channelCode, String channelNameKo, String reason,
                         List<String> dataTypes, Instant since, Instant lastSeenAt, String to) {
    }

    public static CustomerOperationsHomeView unavailable(int cadenceMinutes) {
        return new CustomerOperationsHomeView(false, false, null, cadenceMinutes, null, null, null, List.of(),
                new Decisions(0, List.of()), new Handled(null, 0, 0, 0, List.of()), new Gaps(0, List.of()));
    }
}
