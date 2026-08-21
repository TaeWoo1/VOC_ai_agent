package com.sellerops.channelknowledge;

/** What shape a knowledge entry is — read alongside its topic. */
public enum ChannelKnowledgeKind {
    /** A statement about how the channel behaves. */
    FACT,
    /** Ordered steps a seller or operator performs. */
    PROCEDURE,
    /** Something the channel does NOT allow or provide. The most load-bearing kind here. */
    LIMITATION,
    /** A term or identifier and its meaning. */
    TERM,
    /** Advice about what to do, which is a judgement and is labelled as one. */
    GUIDANCE
}
