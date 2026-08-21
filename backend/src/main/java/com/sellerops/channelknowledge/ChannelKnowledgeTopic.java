package com.sellerops.channelknowledge;

/**
 * The knowledge areas a channel pack covers. Fixed rather than free-text so retrieval can be filtered
 * and so a pack that is missing an area is visibly missing it rather than quietly thin.
 */
public enum ChannelKnowledgeTopic {

    /** What SellerOps can and cannot do here per data type, and by which acquisition method. */
    CAPABILITY,

    /** How the seller's real work actually flows in this channel's own seller center. */
    WORKFLOW,

    /** What the channel's own status values mean — the ones an Agent will otherwise guess at. */
    STATUS_SEMANTICS,

    /** Credential kinds, OAuth scopes, IP restrictions — what connecting actually requires. */
    CONNECTION,

    /** Where in the seller center a thing is found. Shared with the connection tutorials. */
    NAVIGATION,

    /** Named failures and what each one actually means to do about it. */
    TROUBLESHOOTING,

    /** Identifiers and vocabulary — what {@code vendorItemId} is, and what it is not. */
    GLOSSARY,

    /**
     * Judgement rather than reference: what to check first, what the API cannot tell you and where to
     * look instead. The part an API document does not contain.
     */
    OPERATIONS
}
