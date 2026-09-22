package com.sellerops.collect;

import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ChannelCapabilityOverview;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
    /**
     * The channels the product has an official pull connector for, each with this deployment's switch for it.
     * A channel is on this list because a connector for it exists in code; the switch says whether this process
     * runs it. Nothing here decides a capability — it only names why a connector did not resolve.
     */
    private final Map<String, Boolean> officialConnectorSwitch;

    public ChannelCapabilityController(CollectControlService service) {
        this(service, false, false, false);
    }

    @Autowired
    public ChannelCapabilityController(
            CollectControlService service,
            @Value("${sellerops.connector.naver.enabled:false}") boolean naverEnabled,
            @Value("${sellerops.connector.coupang.enabled:false}") boolean coupangEnabled,
            @Value("${sellerops.connector.cafe24.enabled:false}") boolean cafe24Enabled) {
        this.service = service;
        this.officialConnectorSwitch = Map.of("NAVER", naverEnabled, "COUPANG", coupangEnabled, "CAFE24", cafe24Enabled);
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
        ChannelCapabilityOverview overview = service.channelCapabilityOverview(code);
        return overview.withDeploymentAvailability(deploymentAvailability(code, overview.autoCollectSupported()));
    }

    /**
     * Why a connector did or did not resolve here. A switched-on official connector that still did not resolve
     * (a misconfigured process) is not called 「off」 — only an explicitly switched-off one is; the rest says the
     * product has no connector, which is the only other thing this reader knows.
     */
    String deploymentAvailability(String code, boolean resolved) {
        if (resolved) return "ON";
        Boolean enabled = officialConnectorSwitch.get(code);
        if (enabled != null && !enabled) return "OFF_IN_THIS_DEPLOYMENT";
        return enabled == null ? "NO_OFFICIAL_CONNECTOR" : null;
    }
}
