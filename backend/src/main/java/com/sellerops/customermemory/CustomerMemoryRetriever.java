package com.sellerops.customermemory;

import java.util.List;
import java.util.UUID;

/**
 * The seam between "here is a customer's problem" and "here is when we saw it before".
 *
 * <p>A port, deliberately, and for the same reason {@link com.sellerops.reviewissue.IssueSignatureExtractor}
 * is one: the retrieval STRATEGY is expected to be replaced, and everything built on top of it — the
 * Operator's recall node, the inquiry draft's context, repeated-inquiry detection — must not have to
 * move when it is. The shipped implementation is deterministic and lexical
 * ({@link LexicalCustomerMemoryRetriever}); an embedding-backed one would be another implementation of
 * this interface.
 *
 * <p><b>Why the shipped one is not an embedding.</b> Embedding a corpus of inquiries and reviews means
 * sending customer bodies to a vendor in bulk. That is a data-minimization decision, not a wiring one —
 * the same distinction {@code docs/decisions/agent-runtime-langgraph-llm-split.md} drew for the draft
 * seam — and scope lock v1.12 opened retrieval as CONTEXT while explicitly leaving that decision
 * closed. So v1 retrieves over closed vocabulary that never left this database.
 *
 * <p><b>Provenance is not optional.</b> {@link #kind()} and {@link #version()} are carried on every
 * result, because a different retriever returns different neighbours and a recorded run must be
 * readable back without guessing which one produced it.
 */
public interface CustomerMemoryRetriever {

    /** e.g. {@code LEXICAL}. Stamped on every hit. */
    String kind();

    /** e.g. {@code customer-memory-lexical/v1}. Stamped on every hit. */
    String version();

    /**
     * Entries most like the given cue, best first.
     *
     * <p>Both cue components are optional and a cue with neither returns nothing — "find things like
     * this" with nothing to be like must be an empty answer, never the whole index.
     *
     * @param excludeSourceId a source row to leave out, so recalling context for an inquiry never
     *     returns that inquiry itself as its own precedent
     */
    List<CustomerMemoryEntry> retrieve(UUID orgId, RetrievalCue cue, UUID excludeSourceId, int limit);

    /**
     * What we are looking for, in closed vocabulary only.
     *
     * @param signatureKey {@code aspect:problem} from {@link com.sellerops.reviewissue.IssueSignature}
     * @param topic an {@code item_analyses.category} value
     * @param productId narrow to one product when known; null means any
     */
    record RetrievalCue(String signatureKey, String topic, UUID productId) {

        public boolean isEmpty() {
            return (signatureKey == null || signatureKey.isBlank())
                    && (topic == null || topic.isBlank());
        }
    }
}
