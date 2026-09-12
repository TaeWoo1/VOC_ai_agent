package com.sellerops.producttruth;

/**
 * The kinds of precondition an execution path can carry.
 *
 * <p>A closed vocabulary, because "supported" and "runnable right now" are different sentences and
 * the second one has a shape. Cafe24's inquiry answer is a product capability whether or not this
 * seller has granted the write permission — but the grant is a real precondition, and the honest way
 * to carry it is as structured data rather than as prose that a later sentence has to re-parse.
 *
 * <p>The description that accompanies a requirement is seller-facing, so it names the thing a seller
 * can act on — never an internal configuration key. {@code ProductTruthValidator} enforces that.
 */
public enum ProductRequirementKind {

    /** The seller must grant the channel a write permission that the read-only connection lacks. */
    WRITE_PERMISSION,

    /** Something the deployment must be configured with before any seller can run this. */
    DEPLOYMENT_PREREQUISITE,

    /** A standing, single-use approval bound to this exact target. */
    VALID_APPROVAL,

    /** The seller must be present at the channel's own screen for a guided lane to complete. */
    GUIDED_EXECUTION_PREREQUISITE,

    /** A condition on the channel side — the target's own state, or what the channel accepts. */
    CHANNEL_PRECONDITION
}
