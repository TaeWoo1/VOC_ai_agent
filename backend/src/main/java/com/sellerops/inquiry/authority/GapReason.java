package com.sellerops.inquiry.authority;

/** Why a capability could not act. A reason, never a guess about the answer. */
public enum GapReason {
    /**
     * The source exists and was never read (a listing's detail page); a reader exists — SYSTEM_ACQUIRE. Like
     * {@link #UNREADABLE_SOURCE} it is a POSSIBLE gap: the next step, not a verdict on where the need ends.
     */
    ACQUIRABLE,
    /** The capability is switched off here. */
    DISABLED,
    /** This channel, surface or listing does not provide the field or the capability — a definite limit. */
    NOT_SUPPORTED,
    /**
     * A source exists that no reader here can read — a detail page that is pictures, a Cafe24 detail never collected. The
     * answer may or may not be in it: this is a POSSIBLE gap, and it is kept apart from {@link #NOT_SUPPORTED} so the
     * seller's own knowledge being short is never silently counted as the system's limit, or the reverse.
     */
    UNREADABLE_SOURCE,
    /** A PROCEDURE with no executor (v3.0: every procedure). */
    NOT_EXECUTABLE,
    /** The instance is not bound — the channel named no order. Identity is never asked of the customer in v3.0. */
    UNBOUND,
    /** Observed, and not provably current. Cited with its date at most; never stated as now. */
    STALE,
    /** The source answered and did not prove this field (a status code whose meaning is not confirmed). */
    UNPROVEN,
    /** The source could not be reached or did not find the instance this time. */
    UNAVAILABLE
}
