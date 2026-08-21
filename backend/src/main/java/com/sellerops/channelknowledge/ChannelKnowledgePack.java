package com.sellerops.channelknowledge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * The loaded knowledge packs, one per channel, read from {@code channel-knowledge/*.yaml} at boot.
 *
 * <p>Resource files rather than database rows: this is versioned editorial content that ships with a
 * release and is reviewed in a pull request beside the code whose behaviour it describes. A table
 * would let it drift from that code silently between deploys, which is the exact failure this axis
 * exists to prevent — {@code ChannelKnowledgeConsistencyTest} pins several entries against the code
 * registries and fails the build when they disagree.
 *
 * <p>Fails closed at boot on a malformed or duplicate-id pack. A knowledge base that half-loads is
 * worse than one that is absent: the Agent would answer confidently from whatever survived.
 */
@Component
public class ChannelKnowledgePack {

    private static final List<String> CHANNELS = List.of("NAVER", "COUPANG", "CAFE24");

    private final Map<String, ChannelPack> packs;

    public ChannelKnowledgePack() {
        this.packs = load();
    }

    /** One channel's pack: its version and its entries. */
    public record ChannelPack(String channel, String version, LocalDate updatedAt,
                              List<ChannelKnowledgeEntry> entries) {
    }

    public List<String> channels() {
        return CHANNELS;
    }

    /** Entries for one channel, or empty for a channel with no pack. */
    public List<ChannelKnowledgeEntry> entriesFor(String channelCode) {
        ChannelPack pack = packs.get(normalize(channelCode));
        return pack == null ? List.of() : pack.entries();
    }

    public ChannelPack packFor(String channelCode) {
        return packs.get(normalize(channelCode));
    }

    /** Every entry across every channel — the corpus a cross-channel search walks. */
    public List<ChannelKnowledgeEntry> all() {
        List<ChannelKnowledgeEntry> out = new ArrayList<>();
        for (String channel : CHANNELS) {
            out.addAll(entriesFor(channel));
        }
        return out;
    }

    private static String normalize(String channelCode) {
        return channelCode == null ? "" : channelCode.trim().toUpperCase();
    }

    private static Map<String, ChannelPack> load() {
        ObjectMapper yaml = new ObjectMapper(new YAMLFactory()).registerModule(new JavaTimeModule());
        Map<String, ChannelPack> loaded = new java.util.LinkedHashMap<>();
        Set<String> seenIds = new HashSet<>();
        for (String channel : CHANNELS) {
            String path = "channel-knowledge/" + channel.toLowerCase() + ".yaml";
            try (InputStream in = new ClassPathResource(path).getInputStream()) {
                RawPack raw = yaml.readValue(in, RawPack.class);
                List<ChannelKnowledgeEntry> entries = new ArrayList<>();
                for (RawEntry e : raw.entries == null ? List.<RawEntry>of() : raw.entries) {
                    // An id collision would make one entry unreachable through every id-based path
                    // while search still returned both — the kind of half-presence that reads as a
                    // content problem for weeks. Refuse to boot instead.
                    if (!seenIds.add(e.id)) {
                        throw new IllegalStateException("중복된 채널 지식 항목 id: " + e.id);
                    }
                    entries.add(new ChannelKnowledgeEntry(
                            e.id, channel,
                            ChannelKnowledgeTopic.valueOf(e.topic),
                            ChannelKnowledgeKind.valueOf(e.kind),
                            e.title, e.summary, e.body,
                            e.capabilities == null ? List.of() : e.capabilities,
                            e.tags == null ? List.of() : e.tags,
                            ChannelKnowledgeSource.valueOf(e.source),
                            e.sourceRef,
                            e.verifiedAt == null || e.verifiedAt.isBlank() ? null : LocalDate.parse(e.verifiedAt)));
                }
                loaded.put(channel, new ChannelPack(channel, raw.version,
                        raw.updatedAt == null ? null : LocalDate.parse(raw.updatedAt), List.copyOf(entries)));
            } catch (Exception ex) {
                throw new IllegalStateException("채널 지식 팩을 읽을 수 없습니다: " + path, ex);
            }
        }
        return Map.copyOf(loaded);
    }

    /** YAML shapes. Package-private mutable holders; the public surface is the immutable record. */
    static class RawPack {
        public String version;
        public String updatedAt;
        public List<RawEntry> entries;
    }

    static class RawEntry {
        public String id;
        public String topic;
        public String kind;
        public String title;
        public String summary;
        public String body;
        public List<String> capabilities;
        public List<String> tags;
        public String source;
        public String sourceRef;
        public String verifiedAt;
    }
}
