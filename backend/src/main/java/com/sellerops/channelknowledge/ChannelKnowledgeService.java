package com.sellerops.channelknowledge;

import com.sellerops.collect.AcquisitionPathRegistry;
import com.sellerops.connector.ChannelApiGapRegistry;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.PullConnector;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Reads of channel knowledge: search, the composed capability answer, and connection guidance.
 *
 * <p>Everything here is a read of static content plus code registries. It touches no seller data, no
 * credential and no channel, so it is safe for the Agent to consult freely and needs no approval of
 * any kind.
 */
@Service
public class ChannelKnowledgeService {

    private final ChannelKnowledgePack pack;
    private final ChannelKnowledgeSearch search;
    private final ConnectorRegistry connectors;

    public ChannelKnowledgeService(ChannelKnowledgePack pack, ChannelKnowledgeSearch search,
                                   ConnectorRegistry connectors) {
        this.pack = pack;
        this.search = search;
        this.connectors = connectors;
    }

    public List<ChannelKnowledgeSearch.Hit> search(String query, String channel, String topic,
                                                   String capability, int limit) {
        ChannelKnowledgeTopic parsed = null;
        if (topic != null && !topic.isBlank()) {
            try {
                parsed = ChannelKnowledgeTopic.valueOf(topic.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                // An unknown topic filter returns nothing rather than silently returning everything —
                // a caller that mistypes a filter should see an empty answer, not an unfiltered one.
                return List.of();
            }
        }
        return search.search(query, channel, parsed, capability, Math.max(1, Math.min(limit, 25)));
    }

    /**
     * The capability answer for one channel × data type, composed from code and explained by the pack.
     *
     * <p>Resolution order matters: the connector's own answer first (it is the authority on what it
     * can serve), then the acquisition registry for routes outside it, then the channel-level API gaps
     * — which are facts about the CHANNEL and must survive even when the connector is disabled and a
     * mock is answering. That last point is a correction: the Coupang review-API note originally lived
     * only on the Coupang connector, which is off by default, so in an ordinary environment the note
     * vanished and left an acquisition badge standing alone.
     */
    public ChannelCapabilityAnswer capability(String channelCode, DataType dataType) {
        String channel = channelCode == null ? "" : channelCode.trim().toUpperCase();
        ConnectorCapabilities caps = connectors.resolvePullConnector(channel)
                .map(c -> c.capabilities(channel))
                .orElse(null);
        boolean supported = caps != null && caps.supports(dataType);
        String verification = supported ? caps.verificationStatus().get(dataType) : null;

        List<ChannelCapabilityAnswer.AcquisitionPathView> paths = new ArrayList<>();
        AcquisitionPathRegistry.pathsFor(channel, dataType).forEach(p ->
                paths.add(new ChannelCapabilityAnswer.AcquisitionPathView(
                        p.method(), p.verificationStatus(), p.recurrence())));

        List<String> gaps = ChannelApiGapRegistry.gapsFor(channel).stream()
                .map(g -> g.label()).toList();

        // Entries scoped to this data type, plus the channel-wide ones that apply to everything.
        List<ChannelKnowledgeEntry> knowledge = pack.entriesFor(channel).stream()
                .filter(e -> e.capabilities().isEmpty() || e.capabilities().contains(dataType.name()))
                .toList();

        return new ChannelCapabilityAnswer(channel, dataType.name(), supported, verification,
                List.copyOf(paths), gaps, knowledge);
    }

    /**
     * What connecting this channel actually requires — credential kinds, scopes, IP rules — and what
     * to check when it fails.
     *
     * <p>Serves both the Agent and the connection tutorials, which is the point: "mall.read_product가
     * 필요하다" is one fact, and it should not be able to say different things in a tutorial, a
     * troubleshooting panel and an Agent answer.
     */
    public List<ChannelKnowledgeEntry> connectionGuidance(String channelCode) {
        return pack.entriesFor(channelCode).stream()
                .filter(e -> e.topic() == ChannelKnowledgeTopic.CONNECTION
                        || e.topic() == ChannelKnowledgeTopic.NAVIGATION
                        || e.topic() == ChannelKnowledgeTopic.TROUBLESHOOTING)
                .toList();
    }

    public ChannelKnowledgePack.ChannelPack packFor(String channelCode) {
        return pack.packFor(channelCode);
    }
}
