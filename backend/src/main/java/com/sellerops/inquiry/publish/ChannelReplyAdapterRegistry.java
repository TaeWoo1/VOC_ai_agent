package com.sellerops.inquiry.publish;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Resolves the {@link ChannelReplyAdapter} for a work item's exact channel AND source subtype.
 * Spring injects every adapter bean; the registry groups them by {@link
 * ChannelReplyAdapter#channelCode()} — <b>grouped, not keyed</b>.
 *
 * <p><b>Why a list per code.</b> One channel can have more than one reply adapter, because one
 * channel can have more than one inquiry resource: NAVER's product Q&amp;A and customer inquiries are
 * different endpoints with different identifier spaces, and each has its own adapter. Indexing by
 * code alone made those two collide — and the collision was not a misroute but a refusal to start:
 * the registry threw {@code Duplicate key NAVER} in its constructor, so the FIRST deployment to set
 * {@code execution-enabled=true} with both NAVER connectors on would fail to boot entirely. It was
 * invisible until then because the default leaves the adapter list empty.
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
    private final Map<String, List<ChannelReplyAdapter>> byCode;

    public ChannelReplyAdapterRegistry(ChannelRepository channels, List<ChannelReplyAdapter> adapters) {
        this.channels = channels;
        this.byCode = adapters.stream().collect(Collectors.groupingBy(
                ChannelReplyAdapter::channelCode,
                Collectors.collectingAndThen(Collectors.toList(), List::copyOf)));
    }

    /**
     * The adapter serving the given channel AND source subtype, or empty when none is registered.
     *
     * <p>Empty covers every fail-closed case with one answer: an unknown channel id, a channel with no
     * adapter, live execution disabled, and — the case this signature exists for — an adapter that
     * serves the channel but not this resource of it. The last one used to be indistinguishable from a
     * match, because resolution stopped at the channel code.
     */
    public Optional<ChannelReplyAdapter> resolve(UUID channelId, String sourceSubtype) {
        if (channelId == null) {
            return Optional.empty();
        }
        return channels.findById(channelId)
                .map(Channel::getCode)
                .map(code -> byCode.getOrDefault(code, List.of()))
                .stream()
                .flatMap(List::stream)
                .filter(adapter -> adapter.servesSubtype(sourceSubtype))
                .findFirst();
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
