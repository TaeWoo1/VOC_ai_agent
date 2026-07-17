package com.sellerops.attention.reply.dto;

/**
 * The outcome of an approval decision.
 *
 * <p>{@code actionRef} echoes the row that was decided, so a client batching decisions can
 * match a response to its request without relying on ordering.
 *
 * <p>{@code state} is the review's CURRENT approval state after the call — not necessarily the
 * one this request asked for. On a replay of a command a later command has since superseded,
 * this reports where things actually stand rather than replaying a stale value.
 *
 * <p>{@code replayed} distinguishes "this command had already been applied; nothing was
 * written" from a fresh write. Both are 200: a replay is a success, not a conflict — the
 * caller's intent is satisfied either way. A command id reused for a DIFFERENT decision is the
 * conflict, and it never reaches this record.
 *
 * <p>Deliberately minimal, mirroring {@code TriageDecisionResponse} on this same surface — and
 * notably it does NOT carry the approved body. A client that has just approved re-reads the
 * prep view to obtain it, which is the same path it uses on load, so there is exactly one way
 * to get copyable text rather than two that could disagree.
 */
public record ReviewReplyApprovalResponse(String actionRef, String state, boolean replayed) {
}
