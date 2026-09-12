package com.sellerops.collect;

import com.sellerops.collect.dto.CollectionPostureView;
import com.sellerops.proactive.ProactiveScheduler;
import com.sellerops.selfpilot.SelfPilotProperties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Does this deployment collect on its own — read-only, deployment-scoped, no org.
 *
 * <p>The runtime layer of the three a "자동" sentence needs (see {@link CollectionPostureView}). It is
 * deliberately NOT org-scoped: the question is about the process, and the caller that needs it — the
 * Agent's product truth — asks it once per capability turn alongside the channel reads it already
 * makes. Auth-gated like every non-auth endpoint; reference data, so not org-scoped.
 */
@RestController
@RequestMapping("/api/collect")
public class CollectionPostureController {

    private final ObjectProvider<SyncScheduler> scheduler;
    private final ObjectProvider<ProactiveScheduler> proactive;
    private final SelfPilotProperties selfPilot;

    public CollectionPostureController(ObjectProvider<SyncScheduler> scheduler,
                                       ObjectProvider<ProactiveScheduler> proactive,
                                       SelfPilotProperties selfPilot) {
        this.scheduler = scheduler;
        this.proactive = proactive;
        this.selfPilot = selfPilot;
    }

    @GetMapping("/posture")
    public CollectionPostureView posture() {
        // Bean presence, not the property: the bean is what actually ticks, and it is created by the
        // condition rather than by anyone re-reading the flag.
        return new CollectionPostureView(
                scheduler.getIfAvailable() != null,
                selfPilot != null && selfPilot.enabled(),
                proactive.getIfAvailable() != null);
    }
}
