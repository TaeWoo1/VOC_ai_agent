package com.sellerops.channelknowledge;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Lexical retrieval over the knowledge packs.
 *
 * <p>Lexical rather than embedding-based, and that is a decision rather than a shortcut. This corpus
 * is small (tens of entries per channel), written in the same vocabulary the seller and the Agent
 * already use, and shipped in the repository — an embedding index would add a build step, a model
 * dependency and a drift surface to a problem that term overlap solves. It would also put channel
 * documentation through a vendor, which the data-minimization posture has no reason to accept for
 * content that is not seller data.
 *
 * <p>Scoring is deliberately blunt: term hits in the title count most, then tags and capabilities,
 * then summary, then body. What matters far more than the ranking function is that every result
 * carries its source and its verification date, so a caller can weigh a live-proven fact differently
 * from an unverified menu label.
 */
@Component
public class ChannelKnowledgeSearch {

    private static final int TITLE_WEIGHT = 8;
    private static final int TAG_WEIGHT = 5;
    private static final int SUMMARY_WEIGHT = 3;
    private static final int BODY_WEIGHT = 1;
    /** Below this, a "match" is one incidental term and returning it is noise dressed as an answer. */
    private static final int MIN_SCORE = 3;

    private final ChannelKnowledgePack pack;

    public ChannelKnowledgeSearch(ChannelKnowledgePack pack) {
        this.pack = pack;
    }

    /** One scored hit. */
    public record Hit(ChannelKnowledgeEntry entry, int score) {
    }

    /**
     * Entries matching {@code query}, optionally narrowed to one channel, topic, or capability.
     *
     * <p>An empty query with a filter is a legitimate request — "everything Cafe24 knows about
     * connection" — and returns the filtered set rather than nothing.
     */
    public List<Hit> search(String query, String channel, ChannelKnowledgeTopic topic,
                            String capability, int limit) {
        List<ChannelKnowledgeEntry> candidates =
                channel == null || channel.isBlank() ? pack.all() : pack.entriesFor(channel);

        List<Hit> hits = new ArrayList<>();
        Set<String> terms = terms(query);
        for (ChannelKnowledgeEntry e : candidates) {
            if (topic != null && e.topic() != topic) {
                continue;
            }
            if (capability != null && !capability.isBlank()
                    && !e.capabilities().contains(capability.trim().toUpperCase())) {
                continue;
            }
            if (terms.isEmpty()) {
                hits.add(new Hit(e, 0));
                continue;
            }
            int score = score(e, terms);
            if (score >= MIN_SCORE) {
                hits.add(new Hit(e, score));
            }
        }
        hits.sort(Comparator.comparingInt(Hit::score).reversed()
                // Stable secondary ordering so identical scores do not shuffle between calls; an Agent
                // that asks the same question twice should not get a different first answer.
                .thenComparing(h -> h.entry().id()));
        return hits.size() > limit ? List.copyOf(hits.subList(0, limit)) : List.copyOf(hits);
    }

    private static int score(ChannelKnowledgeEntry e, Set<String> terms) {
        int score = 0;
        String title = lower(e.title());
        String summary = lower(e.summary());
        String body = lower(e.body());
        String tags = (String.join(" ", e.tags()) + " " + String.join(" ", e.capabilities())).toLowerCase(Locale.ROOT);
        for (String t : terms) {
            if (title.contains(t)) score += TITLE_WEIGHT;
            if (tags.contains(t)) score += TAG_WEIGHT;
            if (summary.contains(t)) score += SUMMARY_WEIGHT;
            if (body.contains(t)) score += BODY_WEIGHT;
        }
        return score;
    }

    /**
     * Query terms, lower-cased, one-character tokens dropped.
     *
     * <p>Substring matching rather than word matching, because Korean is agglutinative: "리뷰가",
     * "리뷰를" and "리뷰는" are the same term with different particles attached, and a word-boundary
     * match would find none of them. The cost is occasional over-matching on short English tokens,
     * which the minimum score absorbs.
     */
    private static Set<String> terms(String query) {
        if (query == null || query.isBlank()) {
            return Set.of();
        }
        Set<String> out = new java.util.LinkedHashSet<>();
        for (String raw : query.toLowerCase(Locale.ROOT).split("[\\s,.·/()\\[\\]?!\"']+")) {
            String t = raw.trim();
            if (t.length() >= 2) {
                out.add(t);
            }
        }
        return out;
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
