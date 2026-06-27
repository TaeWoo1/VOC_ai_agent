package com.sellerops.attention.source;

import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Resolves which {@link VocItemSource} serves a given channel. Spring injects every
 * source bean; the first one that {@linkplain VocItemSource#supports(String) declares
 * support} for the channel wins. A channel with no source resolves to
 * {@link Optional#empty()} — the attention layer then renders a safe empty state
 * rather than fabricating data (e.g. GMARKET, which has no real source adapter yet).
 *
 * <p>Mirrors the channel-keyed resolution style of
 * {@link com.sellerops.connector.ConnectorRegistry}.
 */
@Component
public class VocItemSourceRegistry {

    private final List<VocItemSource> sources;

    public VocItemSourceRegistry(List<VocItemSource> sources) {
        this.sources = List.copyOf(sources);
    }

    /** The source serving this channel, if any; empty for a null or unsupported channel. */
    public Optional<VocItemSource> forChannel(String channelCode) {
        if (channelCode == null) {
            return Optional.empty();
        }
        return sources.stream().filter(s -> s.supports(channelCode)).findFirst();
    }
}
