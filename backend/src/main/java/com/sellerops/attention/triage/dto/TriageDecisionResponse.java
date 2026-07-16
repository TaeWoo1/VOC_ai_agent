package com.sellerops.attention.triage.dto;

/**
 * The outcome of a triage decision.
 *
 * <p>{@code actionRef} echoes the row that was decided, so a client batching decisions can
 * match a response to its request without relying on ordering.
 *
 * <p>{@code disposition} is the review's CURRENT decision after the call — not necessarily
 * the one this request asked for. On a replay of a command that a later command has since
 * superseded, this reports where things actually stand rather than replaying a stale value.
 *
 * <p>{@code replayed} distinguishes "this command had already been applied; nothing was
 * written" from a fresh write. Both are 200: a replay is a success, not a conflict — the
 * caller's intent is satisfied either way. A command id reused for a DIFFERENT decision is
 * the conflict, and it never reaches this record.
 *
 * <p>Deliberately carries no timestamp and no actor. The trail
 * ({@code review_triage_audit}) owns the history; this is the acknowledgement of one write,
 * and every field it does not carry is a field that cannot leak.
 */
public record TriageDecisionResponse(String actionRef, String disposition, boolean replayed) {
}
