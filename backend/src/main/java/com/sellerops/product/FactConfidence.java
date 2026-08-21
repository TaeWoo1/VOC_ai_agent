package com.sellerops.product;

/**
 * How a stored product fact came to be.
 *
 * <p><b>{@link #INFERRED} has no producer anywhere in {@code main}, and that is the point</b> — the
 * same technique {@code ActionClass.WRITE} uses. A class that cannot be spelled is a class nobody can
 * check for; a class that is spelled and never produced is one a structural test can prove absent
 * ({@code ProductFactConfidenceTest}). Filling a missing spec by reasoning over other specs is exactly
 * what invariant I3 forbids, so the name exists to make its absence assertable.
 */
public enum FactConfidence {

    /** A channel or a seller-provided source stated this value verbatim. */
    SOURCE_STATED,

    /**
     * Extracted losslessly from something a source stated — e.g. the quantity token in a listing
     * title. Derivation is a parse, never a guess: if the token is not there, no fact is written.
     */
    DERIVED,

    /** Reserved. Never produced. See the class javadoc. */
    INFERRED
}
