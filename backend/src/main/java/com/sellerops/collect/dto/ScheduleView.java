package com.sellerops.collect.dto;

import com.sellerops.sync.SyncSchedule;
import java.time.Instant;
import java.util.UUID;

/** Read view of one (seller account x data type) collection schedule. */
public record ScheduleView(
        UUID id,
        String dataType,
        String cadenceKind,
        Integer intervalMinutes,
        boolean enabled,
        Instant nextRunAt,
        Instant lastRunAt,
        String pausedReason) {

    public static ScheduleView from(SyncSchedule s) {
        return new ScheduleView(s.getId(), s.getDataType(), s.getCadenceKind(), s.getIntervalMinutes(),
                s.isEnabled(), s.getNextRunAt(), s.getLastRunAt(), s.getPausedReason());
    }
}
