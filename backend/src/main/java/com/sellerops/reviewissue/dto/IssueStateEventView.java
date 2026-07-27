package com.sellerops.reviewissue.dto;

import java.time.Instant;

/**
 * One lifecycle transition.
 *
 * @param actor SYSTEM or OPERATOR — surfaced because "SellerOps raised this" and "you decided this"
 *     are different facts and an operator should be able to tell them apart
 * @param note the operator's own record of what they did; null for system transitions
 */
public record IssueStateEventView(String fromState, String toState, String toStateLabelKo,
                                  String actor, String reason, String note, Instant at) {
}
