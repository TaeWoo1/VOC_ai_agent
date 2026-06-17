package com.sellerops.connector;

import java.util.Map;
import java.util.Set;

/**
 * Connector-level capability descriptor: which connector priority class this
 * connector fills (e.g. "API"), which {@link DataType}s it can serve, and an
 * optional per-type verification status / note. This is the connector's generic
 * descriptor — channel-specific exceptions (e.g. reviews unavailable on a given
 * marketplace) are decided at fetch time, not encoded here.
 */
public record ConnectorCapabilities(
        String connectorClass,
        Set<DataType> supportedDataTypes,
        Map<DataType, String> verificationStatus,
        String notes) {

    public boolean supports(DataType dataType) {
        return supportedDataTypes.contains(dataType);
    }
}
