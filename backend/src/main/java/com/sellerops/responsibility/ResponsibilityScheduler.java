package com.sellerops.responsibility;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * The wall-clock entry point of the responsibility runtime. Deliberately thin — every decision lives in
 * {@link ResponsibilityRunCoordinator}, which reads its state from the database each tick.
 *
 * <p><b>Off by default.</b> The bean exists only when {@code sellerops.responsibility.scheduler-enabled=true}.
 * The poll interval is how often the runtime looks, not the cadence of the job — the cadence is the fixed 2-hour
 * window of the template, and a restart does not move it.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "sellerops.responsibility.scheduler-enabled", havingValue = "true")
public class ResponsibilityScheduler {

    private static final Logger log = LoggerFactory.getLogger(ResponsibilityScheduler.class);

    private final ResponsibilityRunCoordinator coordinator;

    public ResponsibilityScheduler(ResponsibilityRunCoordinator coordinator) {
        this.coordinator = coordinator;
        log.info("responsibility: scheduler 켜짐 owner={}", coordinator.owner());
    }

    @Scheduled(fixedDelayString = "${sellerops.responsibility.poll-interval-ms:30000}",
            initialDelayString = "${sellerops.responsibility.initial-delay-ms:10000}")
    public void tick() {
        try {
            coordinator.tick();
        } catch (RuntimeException e) {
            // A failed tick changes nothing that the next tick cannot re-derive.
            log.warn("responsibility: tick 실패 {}", e.getClass().getSimpleName());
        }
    }
}
