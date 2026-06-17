package com.sellerops.collect.dto;

import com.sellerops.connector.ConnectorCapability;

/** Honest capability badge data: supported + verification status, per data type. */
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
