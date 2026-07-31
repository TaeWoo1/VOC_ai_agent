package com.sellerops.inquiry.guidedhandoff.dto;

/**
 * The outcome of recording an operator-reported Guided Handoff result.
 *
 * <p>{@code recorded} is true whenever the report now stands (a fresh append or a replay
 * of one); {@code replayed} distinguishes an idempotent replay from a fresh write (both
 * 200). {@code verified} is <b>always false</b> — an operator self-report is never a
 * verified completion; {@code note} states that the work item completes only when the
 * answer is re-collected as 처리완료.
 *
 * <p>Deliberately carries no body and no channel claim.
 */
public record InquiryGuidedHandoffOutcomeResponse(
        String workItemId,
        boolean recorded,
        boolean replayed,
        boolean verified,
        String note) {
}
