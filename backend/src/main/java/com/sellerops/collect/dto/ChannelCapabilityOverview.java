package com.sellerops.collect.dto;

import java.util.List;

/**
 * Operator-facing capability read model for a channel, combining the in-code
 * connector capabilities (the source of truth for API connectors, which are not
 * all seeded into {@code connector_capabilities}) with the connector's honest
 * unsupported-scope boundaries. Channel-generic by design: every API channel
 * answers the same shape, so the UI renders one component for all of them.
 *
 * <p>{@code connectorClass}/{@code dataTypes}/{@code unsupportedScopes} reflect the
 * connector actually wired for the channel (e.g. CAFE24 → the Cafe24 connector when
 * its feature flag is on), so the badges never claim more than what is resolved.
 */
public record ChannelCapabilityOverview(
        String channelCode,
        String channelNameKo,
        String connectorClass,
        boolean autoCollectSupported,
        List<DataTypeCapability> dataTypes,
        List<ScopeNote> unsupportedScopes) {

    /** One collectable data type with its honest verification status. */
    public record DataTypeCapability(
            String dataType,
            String label,
            boolean supported,
            String verificationStatus) {
    }

    /** A deliberate boundary the connector does not cover (board, write action, …). */
    public record ScopeNote(String code, String label) {
    }
}
