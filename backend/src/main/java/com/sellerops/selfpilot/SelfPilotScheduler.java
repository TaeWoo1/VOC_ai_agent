package com.sellerops.selfpilot;

import java.time.Instant;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Wall-clock entry point for {@link SelfPilotReconciler}: a fixed-delay tick that exists only when
 * {@code sellerops.self-pilot.enabled=true}. Deliberately thin, like {@code SyncScheduler} — every
 * decision lives in the reconciler so it is testable without real time.
 *
 * <p>The self-pilot reconciler creates schedules; the <em>collect</em> scheduler runs them. Both flags
 * must be on for routine collection to happen (the runbook lists them together).
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "sellerops.self-pilot.enabled", havingValue = "true")
public class SelfPilotScheduler {

    private final SelfPilotReconciler reconciler;

    public SelfPilotScheduler(SelfPilotReconciler reconciler) {
        this.reconciler = reconciler;
    }

    @Scheduled(fixedDelayString = "${sellerops.self-pilot.reconcile-interval-ms:300000}",
            initialDelayString = "${sellerops.self-pilot.reconcile-initial-delay-ms:15000}")
    public void tick() {
        reconciler.tick(Instant.now());
    }
}
