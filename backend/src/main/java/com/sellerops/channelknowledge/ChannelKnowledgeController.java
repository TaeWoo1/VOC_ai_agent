package com.sellerops.channelknowledge;

import com.sellerops.connector.DataType;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Channel Knowledge reads — one source for the Agent, the connection tutorials, and the
 * troubleshooting surfaces.
 *
 * <p>Serving all three from here is the anti-drift measure. "Cafe24 상품 조회에는 mall.read_product가
 * 필요하다" is a single fact; when a tutorial, a help panel and an Agent each keep their own copy, one
 * of them is eventually wrong and nothing detects it. That is not hypothetical — the Cafe24 scope list
 * existed in three places in this repository, and the one that actually won dropped the product scope
 * while a code comment beside it promised the opposite.
 *
 * <p>No org scoping, no seller data, no channel call: this is platform documentation. It is still
 * behind authentication because it describes what SellerOps can do, which is not public.
 */
@RestController
@RequestMapping("/api/channel-knowledge")
public class ChannelKnowledgeController {

    private final ChannelKnowledgeService service;

    public ChannelKnowledgeController(ChannelKnowledgeService service) {
        this.service = service;
    }

    /** A retrieved entry, with its score. */
    public record SearchHit(String id, String channel, String topic, String kind, String title,
                            String summary, String body, List<String> capabilities,
                            String source, String sourceRef, String verifiedAt, int score) {
    }

    /**
     * Search the packs. Every filter is optional; an empty query with a filter returns the filtered
     * set, because "everything Cafe24 knows about connection" is a real question.
     */
    @GetMapping("/search")
    public List<SearchHit> search(@RequestParam(required = false) String q,
                                  @RequestParam(required = false) String channel,
                                  @RequestParam(required = false) String topic,
                                  @RequestParam(required = false) String capability,
                                  @RequestParam(defaultValue = "8") int limit) {
        return service.search(q, channel, topic, capability, limit).stream()
                .map(h -> toHit(h.entry(), h.score()))
                .toList();
    }

    /**
     * What SellerOps can do with one data type on one channel, composed from the code registries with
     * the pack attached as explanation. An unknown data type answers 400 rather than an empty
     * capability, which would read as "cannot do it".
     */
    @GetMapping("/channels/{channel}/capabilities/{dataType}")
    public ChannelCapabilityAnswer capability(@PathVariable String channel,
                                              @PathVariable String dataType) {
        DataType parsed;
        try {
            parsed = DataType.valueOf(dataType.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw com.sellerops.common.ApiException.badRequest("알 수 없는 데이터 종류입니다: " + dataType);
        }
        return service.capability(channel, parsed);
    }

    /** What connecting this channel requires, and what to check when it fails. */
    @GetMapping("/channels/{channel}/connection")
    public List<SearchHit> connection(@PathVariable String channel) {
        return service.connectionGuidance(channel).stream().map(e -> toHit(e, 0)).toList();
    }

    private static SearchHit toHit(ChannelKnowledgeEntry e, int score) {
        return new SearchHit(e.id(), e.channel(), e.topic().name(), e.kind().name(), e.title(),
                e.summary(), e.body(), e.capabilities(), e.source().name(), e.sourceRef(),
                e.verifiedAt() == null ? null : e.verifiedAt().toString(), score);
    }
}
