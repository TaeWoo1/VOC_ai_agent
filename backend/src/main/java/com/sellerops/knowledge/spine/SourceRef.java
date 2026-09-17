package com.sellerops.knowledge.spine;

import java.util.UUID;

/**
 * <b>A pointer to one raw row</b> — the thing a knowledge entry was read from, addressable again.
 *
 * <p>An entry carries every row it stands on: a policy passage points at its document AND the passage within
 * it; a remembered answer points at the memory row AND the inquiry it answered. Following a ref is a read of
 * the owning table in the caller's organisation ({@link SourceRefResolver}); a ref into another organisation
 * resolves to nothing.
 *
 * @param locator where inside the row, or which revision — {@code v3}, {@code #2}. Never text.
 */
public record SourceRef(Kind kind, UUID id, String locator) {

    /** The tables a ref may point into. Closed, so a ref is never a free-form path. */
    public enum Kind {
        ORG_KNOWLEDGE_SOURCE,
        ORG_KNOWLEDGE_CHUNK,
        PRODUCT_KNOWLEDGE_SOURCE,
        PRODUCT_KNOWLEDGE_CHUNK,
        PRODUCT_FACT,
        ANSWER_MEMORY,
        INQUIRY,
        INQUIRY_WORK_ITEM,
        REVIEW,
        REVIEW_REPLY_APPROVAL,
        REVIEW_REPLY_DRAFT,
        REVIEW_TRIAGE,
        TRIAGE_CORRECTION,
        SELLER_GUIDANCE
    }

    public static SourceRef of(Kind kind, UUID id) {
        return new SourceRef(kind, id, null);
    }
}
