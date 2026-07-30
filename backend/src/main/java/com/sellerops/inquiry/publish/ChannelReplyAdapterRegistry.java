package com.sellerops.inquiry.publish;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Resolves the {@link ChannelReplyAdapter} for a work item's exact channel. Spring
 * injects every adapter bean; the registry indexes them by {@link
 * ChannelReplyAdapter#channelCode()}.
 *
 * <p><b>Fail-closed by construction.</b> Live channel adapters are registered only
 * behind the execution flag (e.g. the ESM adapter exists only when {@code
 * sellerops.inquiry.publish.execution-enabled=true}). So when execution is disabled the
 * adapter list is empty and every channel resolves empty; and a channel that simply has
 * no adapter (an unsupported channel) also resolves empty. In both cases the core does
 * not dispatch.
 */
@Component
public class ChannelReplyAdapterRegistry {

    private final ChannelRepository channels;
    private final Map<String, ChannelReplyAdapter> byCode;

    public ChannelReplyAdapterRegistry(ChannelRepository channels, List<ChannelReplyAdapter> adapters) {
        this.channels = channels;
        this.byCode = adapters.stream()
                .collect(Collectors.toUnmodifiableMap(ChannelReplyAdapter::channelCode, Function.identity()));
    }

    /**
     * The adapter serving the given channel, or empty when none is registered
     * (unknown channel id, or a channel with no adapter — both fail closed).
     */
    public Optional<ChannelReplyAdapter> resolve(UUID channelId) {
        if (channelId == null) {
            return Optional.empty();
        }
        return channels.findById(channelId)
                .map(Channel::getCode)
                .map(byCode::get);
    }

    /**
     * The channel codes that currently have a reply adapter registered. Empty on the
     * fail-closed default (execution disabled). Read-only, sanitized (codes are static
     * channel identifiers, not secrets) — exposed for the publish-capability surface so
     * an orchestration client can verify the send path is disabled before acting.
     */
    public java.util.Set<String> registeredChannelCodes() {
        return byCode.keySet();
    }
}
