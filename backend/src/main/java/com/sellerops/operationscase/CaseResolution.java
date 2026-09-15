package com.sellerops.operationscase;

/** Why a case is no longer open. Written by the rules at creation or by the reconciler — never by an API. */
public enum CaseResolution {
    /** A rule concluded there is nothing to do (routine review, thread reply, already answered at first sight). */
    RULE_NO_ACTION,
    /** The investigator concluded there is nothing to do, and no human authority was needed for that. */
    AGENT_NO_ACTION,
    /** The work item moved past waiting-for-seller, or the seller recorded a review decision. */
    SELLER_ACTED,
    /** The review got a reply on the channel after the case opened. */
    ANSWERED_ON_CHANNEL,
    /** The inquiry now reads as answered on the channel. */
    ANSWERED_ELSEWHERE,
    /** The seller excluded the inquiry, or its thread structure did. */
    NOT_OPERATIONAL,
    /** The subject row is gone from this organisation. */
    SUBJECT_GONE,
    /** A watched case's window passed without it becoming the seller's move. */
    MONITORING_ENDED,
    /** A gap's source was read completely again. */
    OBSERVED_AGAIN,
    /** A gap's failure changed kind; the new gap replaces it. */
    SUPERSEDED,
    /** The seller stopped the responsibility. */
    RESPONSIBILITY_STOPPED
}
