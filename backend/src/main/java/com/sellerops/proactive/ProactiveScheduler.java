package com.sellerops.proactive;

import com.sellerops.selfpilot.SelfPilotProperties;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * The wall clock behind {@link ProactiveCaseReconciler} — thin on purpose, like
 * {@code SelfPilotScheduler}: every decision lives in the reconciler so it is testable without real
 * time, and this class only decides WHEN and FOR WHOM.
 *
 * <p><b>It is a scheduler, not an ingest hook, and that is the whole of the execution boundary.</b>
 * An investigation calls a model; a model call inside the transaction that is inserting collected
 * rows would make a slow or unavailable model into a collection failure. Nothing about the proactive
 * loop is reachable from the ingest path, so the two cannot fail together — the loop simply reads
 * whatever the last collection left behind, which is also what makes it correct after a restart.
 *
 * <p><b>Three switches, all required.</b> {@code sellerops.proactive.enabled} arms this package;
 * {@code sellerops.proactive.org-ids} names the orgs this loop may investigate; and
 * {@code SELLEROPS_SELF_PILOT_*} decides whether a background loop may act for that org at all,
 * carrying the multi-tenant fence for that question (Self-Pilot Runtime v1). Fail closed on any of
 * them. The org's activation baseline is a fourth gate, but it lives on the org row and is checked
 * inside the reconciler, because reconcile must still run for an org that has not been activated.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "sellerops.proactive.enabled", havingValue = "true")
public class ProactiveScheduler {

    private static final Logger log = LoggerFactory.getLogger(ProactiveScheduler.class);

    private final ProactiveCaseReconciler reconciler;
    private final ProactiveProperties properties;
    private final SelfPilotProperties selfPilot;

    public ProactiveScheduler(ProactiveCaseReconciler reconciler, ProactiveProperties properties,
                              SelfPilotProperties selfPilot) {
        this.reconciler = reconciler;
        this.properties = properties;
        this.selfPilot = selfPilot;
    }

    @Scheduled(fixedDelayString = "${sellerops.proactive.interval-ms:600000}",
            initialDelayString = "${sellerops.proactive.initial-delay-ms:45000}")
    public void tick() {
        if (!selfPilot.enabled()) {
            return;   // A background loop acts for nobody until the runtime's own scope says so.
        }
        List<UUID> targets = targetOrgs();
        log.info("proactive: tick 시작 대상org수={}", targets.size());
        for (UUID orgId : targets) {
            try {
                reconciler.tick(orgId);
            } catch (RuntimeException e) {
                // One org's failure is not another's. The next tick retries from current truth.
                log.warn("proactive: tick 실패 org={} 사유={}", orgId, e.toString());
            }
        }
    }

    /**
     * The intersection: an org this loop was named for, that Self-Pilot also allows a background loop
     * to act for.
     *
     * <p>The named list is the SOURCE, never the other way round. Enumerating every organisation in
     * the database and filtering afterwards would make {@code LOCAL_SINGLE_USER} — "every org here",
     * 35 of them locally — the starting set, and one forgotten filter downstream would be a proactive
     * loop running for someone else's shop.
     */
    private List<UUID> targetOrgs() {
        return properties.orgIds().stream().filter(selfPilot::isEnabledFor).toList();
    }
}
