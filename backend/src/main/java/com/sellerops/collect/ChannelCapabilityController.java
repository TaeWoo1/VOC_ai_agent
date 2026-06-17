package com.sellerops.collect;

import com.sellerops.collect.dto.CapabilityView;
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
}
