package com.sellerops.collect;

import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ChannelCapabilityOverview;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Two per-channel capability reads that answer different questions, and must not be described as
 * one:
 *
 * <ul>
 *   <li>{@code GET .../capabilities} — the V3-seeded {@code connector_capabilities} reference rows.
 *       This is what gates the 수집 설정 schedule controls.
 *   <li>{@code GET .../capabilities/overview} — computed live from the connector actually resolved,
 *       plus the channel's own official-API gaps. This is what the capability BADGES render.
 * </ul>
 *
 * <p>They disagree by design — several API connectors are never seeded into the table at all — so
 * calling either one "the capability badges" is how a change to one gets reasoned about as if it
 * moved the other. Auth-gated like every non-auth endpoint; reference data, so not org-scoped.
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
