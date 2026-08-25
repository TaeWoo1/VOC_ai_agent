package com.sellerops.proactive;

import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
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
 * <p><b>Two switches, both required.</b> {@code sellerops.proactive.enabled} arms this package;
 * {@code SELLEROPS_SELF_PILOT_*} decides which orgs a background loop may act for at all, and it
 * already carries the multi-tenant fence for that question (Self-Pilot Runtime v1). Fail closed on
 * either.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "sellerops.proactive.enabled", havingValue = "true")
public class ProactiveScheduler {

    private static final Logger log = LoggerFactory.getLogger(ProactiveScheduler.class);

    private final ProactiveCaseReconciler reconciler;
    private final SelfPilotProperties selfPilot;
    private final OrganizationRepository organizations;

    public ProactiveScheduler(ProactiveCaseReconciler reconciler, SelfPilotProperties selfPilot,
                              OrganizationRepository organizations) {
        this.reconciler = reconciler;
        this.selfPilot = selfPilot;
        this.organizations = organizations;
    }

    @Scheduled(fixedDelayString = "${sellerops.proactive.interval-ms:600000}",
            initialDelayString = "${sellerops.proactive.initial-delay-ms:45000}")
    public void tick() {
        if (!selfPilot.enabled()) {
            return;   // A background loop acts for nobody until the runtime's own scope says so.
        }
        for (UUID orgId : targetOrgs()) {
            try {
                reconciler.tick(orgId);
            } catch (RuntimeException e) {
                // One org's failure is not another's. The next tick retries from current truth.
                log.warn("proactive: tick 실패 org={} 사유={}", orgId, e.toString());
            }
        }
    }

    private List<UUID> targetOrgs() {
        if (selfPilot.actsForAllOrgs()) {
            return organizations == null ? List.of()
                    : organizations.findAll().stream().map(Organization::getId).toList();
        }
        return selfPilot.orgIds();
    }
}
