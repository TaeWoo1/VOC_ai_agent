package com.sellerops.reviewissue.dto;

import java.time.Instant;

/**
 * One lifecycle transition, stripped of the operator's free-text note.
 *
 * <p>{@link IssueStateEventView} carries a {@code note} — the operator's own words about what they
 * did. That is the one free-text field in the issue-memory read surface, so it is deliberately
 * absent here: this projection backs the agent-facing {@code /context} read, and an agent brief has
 * no need for free text and must never carry it into a graph state, a durable snapshot, or a log.
 * The human-facing detail surface ({@link ReviewIssueDetailView}) keeps the note; this one does not.
 */
public record IssueTransitionView(String fromState, String toState, String toStateLabelKo,
                                  String actor, String reason, Instant at) {
}
