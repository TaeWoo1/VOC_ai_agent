package com.sellerops.responsibility.aside;

/**
 * What a helper reported about one unattended job. A closed vocabulary: the helper never sends free text, a
 * page's words, or an error message — those are its own to log, and none of them belong in this backend.
 *
 * <p>The distinction that matters is between {@link #OBSERVED} and everything else. Only an observation may
 * carry a count; every other outcome means no number exists, which the schema enforces rather than trusts.
 */
public enum AsideJobOutcome {

    /** The owned surface was read. This is the only outcome that may carry a count, including a count of zero. */
    OBSERVED,

    /** The surface did not identify itself, or could not be read. Not «nothing there» — nothing was established. */
    SURFACE_UNREADABLE,

    /** The executor was absent, refused, or never answered within its own bound. */
    EXECUTOR_UNAVAILABLE,

    /** The helper refused the job: the recipe resolved to a target its local screen would not allow. */
    REFUSED,

    /**
     * A marketplace recipe reached the channel's sign-in wall. Nothing was read and nobody typed anything: the
     * seller has to sign in on their own browser. Distinct from {@link #EXECUTOR_UNAVAILABLE} because the repair
     * is different, and a run that said «the helper is offline» when the store was signed out would send someone
     * to fix the wrong machine.
     */
    AUTH_REQUIRED,

    /**
     * The page was read and its store could not be proved to be this account's. The backend refused the reading
     * and stored none of it. Not «no reviews» — no claim about any store was established.
     */
    STORE_UNRESOLVED
}
