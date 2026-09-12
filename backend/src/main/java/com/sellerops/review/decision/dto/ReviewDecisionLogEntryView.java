package com.sellerops.review.decision.dto;

import java.time.Instant;

/**
 * One thing that was decided or recorded about this review, in a closed vocabulary.
 *
 * <p><b>No new table stands behind this.</b> Every entry is read from a trail this repository already
 * keeps and already treats as append-only: the seller's triage corrections
 * ({@code review_triage_correction_audit}), the response decision
 * ({@code review_triage_audit}), the explicit acts ({@code review_triage_actions}), the reply
 * approval ({@code review_reply_approval_audit}) and the reported outcome
 * ({@code review_reply_outcomes}). A fourth "decision" store would be a second copy of facts that
 * are already answerable, and the copy is what drifts.
 *
 * <p><b>Closed vocabulary, no prose, no actor name.</b> {@code kind}, {@code from} and {@code to} are
 * enum names; the Korean is chosen on the screen. Nothing here carries who pressed it beyond what the
 * source rows already record internally, and nothing carries customer text — a decision log that
 * quoted a review would be a second copy of the customer's sentence with its own masking to remember.
 *
 * @param kind  what happened — {@link ReviewDecisionLogKind}
 * @param from  the value left behind, or null when there was none to leave
 * @param to    the value arrived at, or null where the event has no target (a withdrawal)
 * @param at    when it happened
 */
public record ReviewDecisionLogEntryView(String kind, String from, String to, Instant at) {
}
