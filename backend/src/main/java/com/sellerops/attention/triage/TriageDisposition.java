package com.sellerops.attention.triage;

import com.sellerops.common.ApiException;

/**
 * The operator's recorded judgement about one collected review they drilled into from an
 * attention signal.
 *
 * <p><b>A decision, not a workflow phase.</b> These values say what the operator concluded;
 * they say nothing about what the system will do next, because it does nothing next. There
 * is no scheduler, no dispatcher, and no outbound path behind any of them — recording
 * {@link #RESPONSE_NEEDED} does not draft, queue, send, or promise a reply. That
 * separation is the point: an operator can finish triaging a window today, without a
 * publish capability existing, and the record stays true whatever gets built later.
 *
 * <p>Deliberately NOT modelled on {@code InquiryWorkItemPhase}. That enum tracks an item's
 * position in a machine-driven lifecycle (OPEN → PROPOSED → ACTION_PENDING → EXECUTED …),
 * where the state names a stage the system advances through. These name a human's
 * conclusion, which the system never advances on its own. Borrowing the phase vocabulary
 * would imply a pipeline that does not exist for reviews, and would make the first real
 * review pipeline inherit a state machine chosen before anyone knew its shape.
 *
 * <p>The three are exhaustive over what an operator can conclude at triage time — this
 * needs a response / keep an eye on it / nothing to do — and are mutually exclusive: a
 * review has exactly one current disposition, replaceable by a later decision. There is no
 * terminal value; nothing here is irreversible.
 */
public enum TriageDisposition {

    /** This review warrants a reply. Records the judgement only — nothing is drafted or sent. */
    RESPONSE_NEEDED,

    /** Not actionable on its own, but worth watching (e.g. a possible pattern). */
    MONITOR,

    /** Reviewed and consciously closed out — distinct from never having been looked at. */
    NO_ACTION;

    /**
     * Parse an operator-supplied disposition; unknown → bad request.
     *
     * <p>Parsed here rather than bound by Jackson as an enum so the caller gets this
     * message instead of a deserialization error naming the Java type, matching how
     * {@code OperatorAttentionService.parseType} handles the signal-type param.
     */
    public static TriageDisposition parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("기록할 처리 상태(disposition)를 지정해 주세요.");
        }
        try {
            return TriageDisposition.valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("지원되지 않는 처리 상태입니다.");
        }
    }
}
