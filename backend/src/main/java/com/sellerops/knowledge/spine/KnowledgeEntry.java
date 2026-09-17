package com.sellerops.knowledge.spine;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * <b>One piece of company knowledge, as the spine reads it from a raw source.</b>
 *
 * <p>Not stored. An entry is assembled from the owning row every time it is read, so it cannot drift from that
 * row: editing a policy changes the entry, retiring it removes the entry, and there is no second copy to forget.
 *
 * <p><b>What the text is.</b> Only words the seller authored or the channel stated about the seller's own
 * product — a policy, a product note, a detail page, an attribute, an answer the seller sent — or a closed
 * sentence of ours describing a seller decision. <b>Never a customer's words.</b> An inquiry or a review is
 * where a past answer or decision came from, and it is reachable through {@link #sourceRefs()}, but its text
 * does not travel in the entry.
 *
 * @param entryId    stable within the raw row's identity: {@code <sourceType>:<uuid>[:<n>]}
 * @param scope      ORG for knowledge that holds for the whole company, PRODUCT for one product
 * @param productId  the product for PRODUCT scope, null for ORG
 * @param capturedAt when the raw source last changed or was decided — the entry's freshness
 * @param provenance the seller-facing sentence of how it came to exist (「판매자가 승인한 리뷰 답글」)
 */
public record KnowledgeEntry(String entryId, SpineSourceType sourceType, KnowledgeSpineScope scope, UUID productId,
                             String channelCode, KnowledgeAuthority authority, String title, String text,
                             Instant capturedAt, String provenance, List<SourceRef> sourceRefs) {

    public KnowledgeEntry {
        sourceRefs = sourceRefs == null ? List.of() : List.copyOf(sourceRefs);
    }
}
