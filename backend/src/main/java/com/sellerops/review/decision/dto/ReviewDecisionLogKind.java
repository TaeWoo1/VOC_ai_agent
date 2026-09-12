package com.sellerops.review.decision.dto;

/**
 * The closed set of things a Decision Workspace entry can be.
 *
 * <p>One value per <b>source trail</b>, not one per source table: {@code SELLER_JUDGMENT_SET} and
 * {@code SELLER_JUDGMENT_WITHDRAWN} both come from the correction audit and are two different
 * statements, while a reply approval and its withdrawal are likewise two. The screen maps each to a
 * sentence; nothing downstream parses the Korean back out.
 */
public enum ReviewDecisionLogKind {

    /** The seller stated their own tier for this review (T-07). */
    SELLER_JUDGMENT_SET,

    /** The seller took that judgment back. The review reads as the system's alone again. */
    SELLER_JUDGMENT_WITHDRAWN,

    /** The seller chose what to do — the response decision ({@code TriageDisposition}). */
    ACTION_CHOSEN,

    /** The seller recorded an act they performed off this screen ({@code TriageActionKind}). */
    ACTION_RECORDED,

    /** A reply version was approved, or an approval was withdrawn ({@code ReviewReplyApprovalState}). */
    REPLY_APPROVAL,

    /** The seller reported what happened to the approved reply ({@code OperatorOutcome}). */
    REPLY_OUTCOME
}
