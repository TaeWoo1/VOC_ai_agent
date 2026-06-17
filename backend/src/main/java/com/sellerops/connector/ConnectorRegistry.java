package com.sellerops.connector;

import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Resolves which connector serves a given channel. Spring injects every
 * {@link ChannelConnector} bean; the registry separates the pull connectors
 * (API-style, schedulable) from the operator-initiated file-upload connector.
 *
 * <p>Resolution is channel-aware (Phase 3C Slice 1a): a pull connector that
 * {@linkplain PullConnector#dedicatedChannels() declares itself dedicated} to a
 * channel wins for that channel; every other channel falls back to the generic
 * connector (the mock, which declares no dedication). With no dedicated
 * connector bean present — the real-connector feature flags are off by
 * default — resolution is identical to the original single-mock mapping. The
 * file-upload channel ({@code FILE_UPLOAD}) never resolves to a pull connector.
 */
@Component
public class ConnectorRegistry {

    /** The manual file-upload channel code — never served by a pull connector. */
    public static final String FILE_CHANNEL_CODE = "FILE_UPLOAD";
    private static final String MANUAL_CONNECTOR_CLASS = "MANUAL";

    private final List<ChannelConnector> connectors;
    private final List<PullConnector> pullConnectors;

    public ConnectorRegistry(List<ChannelConnector> connectors) {
        this.connectors = List.copyOf(connectors);
        this.pullConnectors = this.connectors.stream()
                .filter(PullConnector.class::isInstance)
                .map(PullConnector.class::cast)
                .toList();
    }

    /** True for the manual file-upload channel, which has no pull connector. */
    public boolean isFileChannel(String channelCode) {
        return FILE_CHANNEL_CODE.equals(channelCode);
    }

    /**
     * The pull connector that serves this channel, if any: the connector
     * dedicated to the channel when one exists, otherwise the generic fallback.
     * Empty for the file-upload channel (manual fallback only).
     */
    public Optional<PullConnector> resolvePullConnector(String channelCode) {
        if (isFileChannel(channelCode)) {
            return Optional.empty();
        }
        return pullConnectors.stream()
                .filter(p -> p.dedicatedChannels().contains(channelCode))
                .findFirst()
                .or(() -> pullConnectors.stream()
                        .filter(p -> p.dedicatedChannels().isEmpty())
                        .findFirst());
    }

    /**
     * Resolve a connector by channel and connector class. The file channel maps to
     * the manual (file-upload) connector under class {@code MANUAL}; other channels
     * map to the channel's pull connector when its
     * {@link ConnectorCapabilities#connectorClass()} matches.
     */
    public Optional<ChannelConnector> resolve(String channelCode, String connectorClass) {
        if (isFileChannel(channelCode)) {
            return MANUAL_CONNECTOR_CLASS.equals(connectorClass) ? fileConnector() : Optional.empty();
        }
        return resolvePullConnector(channelCode)
                .filter(p -> p.capabilities(channelCode).connectorClass().equals(connectorClass))
                .map(p -> (ChannelConnector) p);
    }

    private Optional<ChannelConnector> fileConnector() {
        return connectors.stream()
                .filter(c -> ConnectorRegistry.FILE_CHANNEL_CODE.equals(c.kind()))
                .findFirst();
    }
}
