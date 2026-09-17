package com.sellerops.knowledge.spine;

import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import java.util.ArrayList;
import java.util.List;

/**
 * <b>What the Knowledge Spine found for one question</b> — the single retrieval result the investigator, the inquiry
 * draft and the review draft all read.
 *
 * @param lanes     the grounding lanes (product knowledge and detail, company rules, one past answer) exactly as the
 *                  draft path has always scored them, after conservative conflict resolution. Whether a draft may be
 *                  written is decided from these and nothing else.
 * @param evidence  the same passages as attributed entries — authority, provenance, freshness, refs — in lane order
 * @param context   seller-confirmed context that informs but never grounds a factual claim alone: guidance the seller
 *                  asked to keep, the seller's review decisions, approved review replies, channel product attributes
 * @param conflicts pairs of entries that state different figures about the same topic, each resolved toward the
 *                  higher authority
 */
public record SpineRetrieval(InquiryEvidenceRetriever.InquiryEvidence lanes, List<KnowledgeEntry> evidence,
                             List<KnowledgeEntry> context, List<KnowledgeConflict> conflicts) {

    public SpineRetrieval {
        evidence = evidence == null ? List.of() : List.copyOf(evidence);
        context = context == null ? List.of() : List.copyOf(context);
        conflicts = conflicts == null ? List.of() : List.copyOf(conflicts);
    }

    /** Evidence first, then context — the order an investigation or a screen should read them in. */
    public List<KnowledgeEntry> all() {
        List<KnowledgeEntry> all = new ArrayList<>(evidence);
        all.addAll(context);
        return all;
    }

    /** The context entries a reply may be written with — the seller's guidance and the channel's stated attributes. */
    public List<KnowledgeEntry> draftContext() {
        return context.stream()
                .filter(e -> e.sourceType() == SpineSourceType.SELLER_GUIDANCE
                        || e.sourceType() == SpineSourceType.PRODUCT_FACT)
                .toList();
    }
}
