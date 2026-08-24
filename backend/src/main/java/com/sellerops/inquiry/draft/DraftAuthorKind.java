package com.sellerops.inquiry.draft;

/**
 * Who wrote this draft version. Stored on the draft row because the seller sends it under their own
 * name and the answer to "did a model write this" must not depend on remembering which button was
 * pressed three days ago.
 */
public enum DraftAuthorKind {

    /** The seller typed or edited it. The moment a human edits, authorship is theirs. */
    SELLER,

    /** The draft model wrote it — {@code model_version} says which. */
    MODEL,

    /**
     * The deterministic fallback wrote it, because the model was unavailable: the capability is off
     * for this org, the day's AI budget is spent, or the vendor refused. Never silently labelled
     * MODEL — a seller comparing two drafts must be able to see that one of them had no model behind
     * it at all.
     */
    RULE
}
