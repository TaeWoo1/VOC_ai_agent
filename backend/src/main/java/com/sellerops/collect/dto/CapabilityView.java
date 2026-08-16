package com.sellerops.collect.dto;

import com.sellerops.connector.ConnectorCapability;

/**
 * One {@code connector_capabilities} row, per channel and data type.
 *
 * <p><b>Not the badge data.</b> This is the reference TABLE, served by
 * {@code GET /api/channels/{code}/capabilities} and read by the 수집 설정 section, where it decides
 * whether an auto-collect cadence may be switched on. The capability badges read a different endpoint
 * — {@link ChannelCapabilityOverview}, computed from the connector actually resolved — and the two
 * disagree by design: several API connectors are never seeded here at all. Naming this one "badge
 * data" is how the two got confused for each other while they were being changed.
 */
public record CapabilityView(
        String channelCode,
        String connectorClass,
        String dataType,
        boolean supported,
        String verificationStatus,
        String notes) {

    public static CapabilityView from(ConnectorCapability c) {
        return new CapabilityView(c.getChannelCode(), c.getConnectorClass(), c.getDataType(),
                c.isSupported(), c.getVerificationStatus(), c.getNotes());
    }
}
