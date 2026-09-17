package com.sellerops.knowledge.spine.dto;

import com.sellerops.knowledge.spine.KnowledgeAuthority;
import com.sellerops.knowledge.spine.KnowledgeSpineScope;
import com.sellerops.knowledge.spine.SourceRef;
import com.sellerops.knowledge.spine.SpineSourceType;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * <b>The concise compiled read of what the company knows about one product (or about itself).</b>
 *
 * <p>A derived view, never a source. It is assembled from the raw sources at read time and not stored, so it
 * cannot be stale against them. The view as a whole has {@link KnowledgeAuthority#COMPILED_KNOWLEDGE}; each claim
 * keeps the authority of the raw source it came from and names that source in {@code sourceRefs}, so compiling
 * never lends a past answer the weight of a policy.
 *
 * @param newestSourceAt the freshest raw source behind the view — what "up to date" means for it
 */
public record CompiledKnowledgeView(UUID productId, String productName, KnowledgeAuthority authority,
                                    Instant compiledAt, int sourceEntries, Instant newestSourceAt,
                                    List<Section> sections) {

    /**
     * One topic. Claims are ordered by authority and then recency, at most a few; {@code onRecord} says how many
     * entries stand behind the section so a short list is never read as the whole record.
     */
    public record Section(String key, String label, KnowledgeAuthority governingAuthority, int onRecord,
                          List<Claim> claims) {
    }

    /** One compiled claim: an excerpt of one raw entry, traceable to it. */
    public record Claim(String entryId, SpineSourceType sourceType, KnowledgeSpineScope scope,
                        KnowledgeAuthority authority, String title, String excerpt, Instant capturedAt,
                        String provenance, List<SourceRef> sourceRefs) {
    }
}
