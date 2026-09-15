package com.sellerops.responsibility.dto;

import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunSource;
import com.sellerops.responsibility.ResponsibilityTemplate;
import com.sellerops.responsibility.ResponsibilityWindows;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A responsibility and its recent windows. {@code status} is null when the organisation never took the job on.
 *
 * <p>Counts are nullable on purpose: a source with {@code completeness = NONE} has {@code observedCount = null},
 * and a reader must not render that as 0.
 *
 * <p>{@code available}: this deployment runs the job for this organisation (rollout). {@code eligible}: at least one
 * required source is on a connected account — without one the job cannot start (NO_ELIGIBLE_SOURCE).
 */
public record ResponsibilityView(
        String templateCode,
        String displayName,
        boolean available,
        boolean eligible,
        String status,
        int cadenceMinutes,
        String timezone,
        List<String> sourcesInScope,
        Instant nextRunAt,
        Instant activatedAt,
        Instant pausedAt,
        Instant stoppedAt,
        List<RunView> runs) {

    public record RunView(
            UUID id,
            Instant windowStart,
            Instant windowEnd,
            String trigger,
            String status,
            int attempt,
            Instant startedAt,
            Instant finishedAt,
            String failureReason,
            Instant nextAttemptAt,
            List<SourceView> sources) {
    }

    public record SourceView(
            int attempt,
            UUID sellerAccountId,
            String channelCode,
            String dataType,
            String method,
            String recipeVersion,
            Instant windowFrom,
            Instant windowTo,
            String cursorFrom,
            String cursorTo,
            Instant startedAt,
            Instant observedAt,
            String completeness,
            Integer observedCount,
            Integer newCount,
            Integer changedCount,
            String failureReason,
            String identityVerdict,
            UUID syncJobId) {
    }

    public static ResponsibilityView notActivated(ResponsibilityTemplate template, boolean available,
                                                  boolean eligible) {
        return new ResponsibilityView(template.name(), template.displayName(), available, eligible, null,
                windowMinutes(), ResponsibilityWindows.ZONE.getId(), scope(template), null, null, null, null,
                List.of());
    }

    public static ResponsibilityView of(ResponsibilityTemplate template, Responsibility r,
                                        List<ResponsibilityRun> runs,
                                        Map<UUID, List<ResponsibilityRunSource>> sourcesByRun,
                                        boolean available, boolean eligible) {
        List<RunView> views = runs.stream().map(run -> new RunView(
                run.getId(), run.getWindowStart(), run.getWindowEnd(), run.getRunTrigger().name(),
                run.getStatus().name(), run.getAttempt(), run.getStartedAt(), run.getFinishedAt(),
                run.getFailureReason() == null ? null : run.getFailureReason().name(), run.getNextAttemptAt(),
                sourcesByRun.getOrDefault(run.getId(), List.of()).stream().map(ResponsibilityView::source).toList()))
                .toList();
        return new ResponsibilityView(template.name(), template.displayName(), available, eligible,
                r.getStatus().name(), windowMinutes(), ResponsibilityWindows.ZONE.getId(), scope(template),
                r.getNextRunAt(), r.getActivatedAt(), r.getPausedAt(), r.getStoppedAt(), views);
    }

    private static List<String> scope(ResponsibilityTemplate template) {
        return template.sources().stream().map(s -> s.channelCode() + ":" + s.dataType().name()).toList();
    }

    private static SourceView source(ResponsibilityRunSource s) {
        return new SourceView(s.getAttempt(), s.getSellerAccountId(), s.getChannelCode(), s.getDataType(),
                s.getMethod(), s.getRecipeVersion(), s.getWindowFrom(), s.getWindowTo(), s.getCursorFrom(),
                s.getCursorTo(), s.getStartedAt(), s.getObservedAt(),
                s.getCompleteness() == null ? null : s.getCompleteness().name(),
                s.getObservedCount(), s.getNewCount(), s.getChangedCount(),
                s.getFailureReason() == null ? null : s.getFailureReason().name(),
                s.getIdentityVerdict().name(), s.getSyncJobId());
    }

    private static int windowMinutes() {
        return (int) ResponsibilityWindows.LENGTH.toMinutes();
    }
}
