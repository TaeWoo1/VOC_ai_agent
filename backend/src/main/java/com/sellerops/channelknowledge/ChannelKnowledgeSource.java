package com.sellerops.channelknowledge;

/**
 * Where a knowledge entry's claim comes from — ranked, loosely, by how much weight it can bear.
 *
 * <p>Kept explicit because the failure mode of a knowledge base is uniform confidence: a menu name
 * someone half-remembered reads exactly like a scope requirement proven by a live run. An Agent
 * quoting a {@link #LIVE_OBSERVATION} and an Agent quoting a {@link #VENDOR_DOC} are making claims of
 * very different strength, and the reader should be able to tell.
 */
public enum ChannelKnowledgeSource {

    /** Observed on a real live run against a real seller account, with evidence recorded. */
    LIVE_OBSERVATION,

    /** Declared by SellerOps code or a canonical repo document — verifiable in this repository. */
    SELLEROPS_EVIDENCE,

    /** The channel's own official seller or developer documentation. */
    VENDOR_DOC,

    /** A product-owner decision about how SellerOps behaves here. Not a fact about the channel. */
    PRODUCT_DECISION,

    /**
     * Believed true but not verified against anything citable. Entries carrying this must be hedged in
     * their own wording; an Agent should present them as "화면 버전에 따라 다를 수 있다", never as fact.
     */
    UNVERIFIED
}
