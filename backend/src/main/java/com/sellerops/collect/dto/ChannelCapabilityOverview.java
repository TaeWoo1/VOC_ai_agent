package com.sellerops.collect.dto;

import java.util.List;

/**
 * Operator-facing capability read model for a channel, combining the in-code
 * connector capabilities (the source of truth for API connectors, which are not
 * all seeded into {@code connector_capabilities}) with the connector's honest
 * unsupported-scope boundaries. Channel-generic by design: every API channel
 * answers the same shape, so the UI renders one component for all of them.
 *
 * <p>{@code connectorClass} and each data type's {@code supported}/{@code verificationStatus}
 * reflect the connector actually wired for the channel (e.g. CAFE24 → the Cafe24 connector when its
 * feature flag is on), so the badges never claim more than that connector can serve.
 *
 * <p><b>Two fields deliberately outlive the connector</b>, because the facts they carry are about
 * the CHANNEL and stay true whichever connector answered — both keyed by channel, neither derived
 * from {@code supported}:
 *
 * <ul>
 *   <li>{@code dataTypes[].acquisitionPaths}, from {@code AcquisitionPathRegistry} — how SellerOps
 *       really collects a type when that is not through the connector.
 *   <li>{@code unsupportedScopes}, which merges the connector's own boundaries with the channel-level
 *       gaps in {@code ChannelApiGapRegistry} — what the marketplace never offered.
 * </ul>
 *
 * <p>They are the two halves of one answer, and both have to survive a flagged-off connector. The
 * first arrived without the second, and the badge overclaimed for exactly as long as that lasted.
 */
public record ChannelCapabilityOverview(
        String channelCode,
        String channelNameKo,
        String connectorClass,
        boolean autoCollectSupported,
        List<DataTypeCapability> dataTypes,
        List<ScopeNote> unsupportedScopes) {

    /**
     * One data type, with the pull connector's answer and — separately — how SellerOps actually
     * acquires it when that is not through the connector.
     *
     * <p>{@code supported} / {@code verificationStatus} are unchanged and still mean exactly one
     * thing: what the resolved pull connector can serve. {@code acquisitionPaths} is the additive
     * axis, empty for every type whose only route is that connector. Read them together — a type can
     * be {@code supported=false} and still be collected, which is precisely the Coupang 상품평 case
     * that a single boolean reported as 미지원.
     */
    public record DataTypeCapability(
            String dataType,
            String label,
            boolean supported,
            String verificationStatus,
            List<AcquisitionPath> acquisitionPaths) {
    }

    /**
     * One way a data type reaches SellerOps outside the pull connector, with the evidence for it.
     *
     * <p>The status rides on the path rather than beside a list of methods: several paths can serve
     * one data type at once, and each is proven on its own. {@code method} is an
     * {@code AcquisitionPathRegistry.Method} name, {@code verificationStatus} a
     * {@code Verification} name.
     */
    public record AcquisitionPath(String method, String verificationStatus) {
    }

    /** A deliberate boundary the connector does not cover (board, write action, …). */
    public record ScopeNote(String code, String label) {
    }
}
