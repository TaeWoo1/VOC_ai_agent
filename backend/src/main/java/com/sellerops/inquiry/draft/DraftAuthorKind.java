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
     *
     * <p><b>No producer since 2026-08-26.</b> The template it used to emit — 「확인한 뒤 정확한 안내를
     * 드리겠습니다」 — was a promise SellerOps made on the seller's behalf with nothing behind it, and
     * it was deleted rather than reworded. The constant stays because rows carrying it exist.
     */
    RULE,

    /**
     * The seller's own pre-approved sentence for "we do not know yet", used verbatim.
     *
     * <p>Distinct from {@link #SELLER} because nobody typed it into THIS reply — it was written once,
     * in the settings screen, and a machine chose to put it here. Distinct from {@link #RULE} and
     * {@link #MODEL} because no template and no model composed it: the words are the company's own
     * and are reproduced without a character changed. That is the only reason a deferral is allowed
     * to appear where {@code NO_ANSWER_BASIS} otherwise writes nothing at all.
     */
    SELLER_APPROVED_FALLBACK
}
