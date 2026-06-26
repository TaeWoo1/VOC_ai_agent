package com.sellerops.collect;

import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ChannelCapabilityOverview;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Honest per-channel capability badges (CONFIRMED / NEEDS_VERIFICATION /
 * UNSUPPORTED) from the V3-seeded reference data. Auth-gated like every
 * non-auth endpoint; reference data, so not org-scoped.
 */
@RestController
@RequestMapping("/api/channels/{code}/capabilities")
public class ChannelCapabilityController {

    private final CollectControlService service;

    public ChannelCapabilityController(CollectControlService service) {
        this.service = service;
    }

    @GetMapping
    public List<CapabilityView> capabilities(@PathVariable String code) {
        return service.channelCapabilities(code);
    }

    /**
     * Channel-generic capability overview combining the in-code connector
     * capabilities (source of truth for API connectors) with honest
     * unsupported-scope boundaries — what the operator dashboard renders as
     * capability badges. Reference data, so not org-scoped.
     */
    @GetMapping("/overview")
    public ChannelCapabilityOverview overview(@PathVariable String code) {
        return service.channelCapabilityOverview(code);
    }
}
