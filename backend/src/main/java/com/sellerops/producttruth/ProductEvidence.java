package com.sellerops.producttruth;

/**
 * What backs a capability claim. Deliberately ordered weakest-last so a rule can say "at least
 * IMPLEMENTED" without a second table.
 *
 * <p>Evidence is NOT status. A capability can be {@code SUPPORTED} on {@code IMPLEMENTED} evidence
 * (the product provides it; nobody has run it against a real store yet) and it can be
 * {@code NOT_SUPPORTED} on {@code DECLARED} evidence (an audited vendor document says the feature
 * does not exist). Writing a row down does not promote its evidence.
 */
public enum ProductEvidence {
    /** A live run on a real seller account, on merged code, recorded in {@code docs/evidence/INDEX.md}. */
    LIVE_PROVEN,
    /** Proven end to end by automated tests against a contract fake or fixture. No live run. */
    TEST_PROVEN,
    /** The code exists and is wired. Never exercised end to end. */
    IMPLEMENTED,
    /** Asserted from an audited vendor contract or a recorded product decision. No implementation claim. */
    DECLARED,
    /** Nobody has looked. */
    UNKNOWN,
}
