package com.sellerops.collect;

import java.time.Instant;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * The wall-clock entry point for scheduled collection: a fixed-delay tick that
 * hands off to {@link SyncScheduleRunner#runDueSchedules}. Deliberately thin —
 * all behavior lives in the runner so it is testable without real time.
 *
 * <p><b>Off by default.</b> The bean only exists when
 * {@code sellerops.collect.scheduler-enabled=true}; until ops flips that flag,
 * nothing polls and the file-upload path is unaffected.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "sellerops.collect.scheduler-enabled", havingValue = "true")
public class SyncScheduler {

    /** Bounded claim batch per tick — backpressure, not throughput tuning. */
    static final int BATCH_LIMIT = 20;

    private final SyncScheduleRunner runner;

    public SyncScheduler(SyncScheduleRunner runner) {
        this.runner = runner;
    }

    @Scheduled(fixedDelayString = "${sellerops.collect.poll-interval-ms:60000}")
    public void tick() {
        runner.runDueSchedules(Instant.now(), BATCH_LIMIT);
    }
}
