package com.sellerops.producttruth;

/**
 * How strongly the product claims this axis. A statement about the PRODUCT, never about one
 * deployment's flags or one seller's connection — those are the runtime overlay
 * ({@code CURRENT_STATE}) and are computed, not written down here.
 */
public enum ProductCapabilityStatus {
    /** The product provides this. */
    SUPPORTED,
    /** The product provides part of this, and {@code limitations} says which part. */
    PARTIAL,
    /** The product does not provide this — usually because the channel does not offer it. */
    NOT_SUPPORTED,
    /** Nobody has established the answer. Never rendered as either of the other three. */
    UNKNOWN,
}
