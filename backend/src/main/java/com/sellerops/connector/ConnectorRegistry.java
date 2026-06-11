package com.sellerops.connector;

import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Resolves which connector serves a given channel. Spring injects every
 * {@link ChannelConnector} bean; the registry separates the pull connectors
 * (API-style, schedulable) from the operator-initiated file-upload connector.
 *
 * <p>Slice 2 mapping: the file-upload channel ({@code FILE_UPLOAD}) has no pull
 * connector (it is a manual fallback); every other channel resolves to the single
 * {@link MockApiConnector}. Keyed by connector class so real Coupang/Naver
 * connectors slot in later without changing callers.
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
     * The pull connector that serves this channel, if any. Empty for the
     * file-upload channel (manual fallback only).
     */
    public Optional<PullConnector> resolvePullConnector(String channelCode) {
        if (isFileChannel(channelCode)) {
            return Optional.empty();
        }
        // Slice 2: a single mock pull connector serves all non-file channels.
        return pullConnectors.stream().findFirst();
    }

    /**
     * Resolve a connector by channel and connector class. The file channel maps to
     * the manual (file-upload) connector under class {@code MANUAL}; other channels
     * map to a pull connector whose {@link ConnectorCapabilities#connectorClass()}
     * matches.
     */
    public Optional<ChannelConnector> resolve(String channelCode, String connectorClass) {
        if (isFileChannel(channelCode)) {
            return MANUAL_CONNECTOR_CLASS.equals(connectorClass) ? fileConnector() : Optional.empty();
        }
        return pullConnectors.stream()
                .filter(p -> p.capabilities(channelCode).connectorClass().equals(connectorClass))
                .map(p -> (ChannelConnector) p)
                .findFirst();
    }

    private Optional<ChannelConnector> fileConnector() {
        return connectors.stream()
                .filter(c -> ConnectorRegistry.FILE_CHANNEL_CODE.equals(c.kind()))
                .findFirst();
    }
}
