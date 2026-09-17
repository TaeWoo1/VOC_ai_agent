package com.sellerops.knowledge.spine.dto;

import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.spine.KnowledgeConflict;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import java.util.List;
import java.util.UUID;

/**
 * One scoped search over every raw source the company's knowledge is read from.
 *
 * @param matchedBy  the form of the question that found the hits (the same bounded ladder the draft lanes use)
 * @param corpusSize how many entries were in scope — ORG plus the product's own — before matching
 * @param outcome    ABSENT when there was nothing in scope at all; NOT_APPLICABLE when matches were all about a
 *                   different declared topic; NO_RELEVANT_EVIDENCE otherwise when nothing matched
 */
public record KnowledgeSpineSearchResponse(String query, String matchedBy, UUID productId, int corpusSize,
                                           RetrievalOutcome outcome, List<Hit> hits,
                                           List<KnowledgeConflict> conflicts) {

    /** An entry and how much of the question it covers. Authority breaks ties; it never outranks coverage. */
    public record Hit(KnowledgeEntry entry, double score) {
    }
}
