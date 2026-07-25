package com.sellerops.reviewissue;

/**
 * Why an opinion unit produced no signature. Stored on {@code review_issue_unknown_units.reason}.
 *
 * <p>This enum is the honest destination for "we could not tell", and its existence is the point:
 * the alternative — attaching a low-confidence unit to the nearest issue — would inflate every
 * count with guesses and make the change judgements measure the extractor's optimism rather than
 * the customers. The pipeline design calls this UNKNOWN, and UNKNOWN is a real, stored state.
 *
 * <p>Phase A WRITES these rows and reports the count. It does not cluster them into new issue
 * candidates: clustering needs semantic capability that scope lock v1.6 ② has not opened. The
 * reasons are separated so that when it does, the pen can be triaged rather than swept.
 */
public enum UnknownReason {

    /** Neither an aspect nor a problem was recognised. Most units — including all praise. */
    NO_SIGNATURE,
    /** An aspect was recognised but nothing was wrong with it. Praise about a known aspect lands here. */
    NO_PROBLEM,
    /**
     * A problem was recognised but not what it is about ("불량이에요"). A real complaint that cannot
     * be attributed — the most interesting rows in the pen, and the first thing a clustering pass
     * should be pointed at.
     */
    NO_ASPECT
}
