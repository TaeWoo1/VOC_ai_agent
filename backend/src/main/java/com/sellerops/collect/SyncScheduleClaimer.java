package com.sellerops.collect;

import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Claims due sync schedules inside one short transaction so concurrent poller
 * ticks never double-run the same schedule: rows are read with
 * {@code FOR UPDATE SKIP LOCKED} and their {@code next_run_at} is advanced to a
 * provisional next slot before the claim transaction commits. Execution happens
 * outside this transaction (in {@link SyncScheduleRunner}), which then overwrites
 * the provisional {@code next_run_at} with the outcome-aware value.
 *
 * <p>Known trade-off: the claim commits before execution, so a crash between
 * claim and run skips that occurrence until the provisional {@code next_run_at}
 * — at-most-once per tick by design. A lease/reclaim path needs a durable queue,
 * which is explicitly deferred.
 *
 * <p>Only {@code INTERVAL} cadence is supported in this slice. A claimed
 * {@code CRON} (or invalid-interval) schedule is deferred explicitly: it is
 * disabled with a {@code paused_reason} instead of being executed, so it cannot
 * spin as permanently-due.
 */
@Component
public class SyncScheduleClaimer {

    static final String CADENCE_INTERVAL = "INTERVAL";

    private final SyncScheduleRepository schedules;

    public SyncScheduleClaimer(SyncScheduleRepository schedules) {
        this.schedules = schedules;
    }

    /** Claim up to {@code limit} due enabled schedules; returns only executable ones. */
    @Transactional
    public List<SyncSchedule> claimDue(Instant now, int limit) {
        List<SyncSchedule> due = schedules.lockDue(now, limit);
        List<SyncSchedule> claimed = new ArrayList<>();
        for (SyncSchedule schedule : due) {
            if (!isRunnableInterval(schedule)) {
                schedule.setEnabled(false);
                schedule.setPausedReason(CADENCE_INTERVAL.equals(schedule.getCadenceKind())
                        ? "수집 주기(분) 설정이 올바르지 않아 일시 중지되었습니다."
                        : "CRON 주기는 아직 지원되지 않아 일시 중지되었습니다.");
                schedules.save(schedule);
                continue;
            }
            // Provisional claim: move the schedule out of the due window so another
            // tick skips it. The runner sets the final next_run_at after the run.
            schedule.setNextRunAt(now.plus(Duration.ofMinutes(schedule.getIntervalMinutes())));
            schedules.save(schedule);
            claimed.add(schedule);
        }
        return claimed;
    }

    private boolean isRunnableInterval(SyncSchedule schedule) {
        return CADENCE_INTERVAL.equals(schedule.getCadenceKind())
                && schedule.getIntervalMinutes() != null
                && schedule.getIntervalMinutes() > 0;
    }
}
