package com.sellerops.connector.cafe24.spike;

/**
 * The terminal phase of one spike run — a closed vocabulary safe to log and report.
 * Every value is either a fail-closed refusal (no comment was posted), a dry-run
 * plan, a defensive HALT, or the one success phase where exactly one comment was
 * created. There is no partial/ambiguous success token.
 */
public enum SpikeReplyOutcome {

    /** Dry-run only: the plan was produced with zero external calls. */
    DRY_RUN_PLANNED,

    /** Write scope {@code mall.write_community} was not granted → cannot post. */
    REFUSED_WRITE_SCOPE_NOT_GRANTED,

    /** Target board is not the product-inquiry board (6). */
    REFUSED_WRONG_BOARD,

    /** Operator did not confirm the article is an operator-owned test inquiry. */
    REFUSED_NOT_TEST_ARTICLE,

    /** Operator comment text failed the fail-closed PII/shape check. */
    REFUSED_CONTENT_REJECTED,

    /** Pre-existing reply_status was not raw {@code N} — refuse rather than post. */
    REFUSED_PRECONDITION_STATUS_NOT_N,

    /** A prior spike comment already exists on this article — refuse the duplicate. */
    REFUSED_DUPLICATE_EXISTING_COMMENT,

    /** No valid single-use approval value was supplied — the POST is not executed. */
    REFUSED_MISSING_APPROVAL,

    /** Same commandId already used with a different payload — reject the conflict. */
    REFUSED_COMMAND_CONFLICT,

    /** The comment POST was rejected by Cafe24 (4xx / field mismatch) — verdict C. */
    COMMENT_CREATE_REJECTED,

    /** The read/observe or post transport failed unexpectedly — stop, no retry/PUT. */
    HALT_TRANSPORT_ERROR,

    /** Post appeared to succeed but the comment count delta was not exactly 1 — stop. */
    HALT_UNEXPECTED_COMMENT_COUNT,

    /** Exactly one comment was created (the only success phase). */
    COMMENT_CREATED;

    /** True for the refusal/halt states where no comment was posted. */
    public boolean isNoWrite() {
        return this != COMMENT_CREATED;
    }
}
