package com.sellerops.attention.triage.dto;

/**
 * An operator's decision about one drill-down row.
 *
 * <p>{@code disposition} is a {@link com.sellerops.attention.triage.TriageDisposition} name
 * carried as a String and parsed in the service, so an unknown value answers with the
 * surface's own message instead of a Jackson deserialization error naming a Java type —
 * matching how the drill-down's {@code type} param is handled.
 *
 * <p>{@code commandId} is the client's idempotency key, unique per org. It is required: an
 * absent one is a bad request, never a silently non-idempotent write. Clients should mint
 * one per user intent (not per retry) so a retried request is recognisable as the same
 * decision.
 *
 * <p>The row being decided arrives in the path as an {@code actionRef}, not here — it is
 * the address of the thing being acted on, not part of the decision.
 */
public record TriageDecisionRequest(String commandId, String disposition) {
}
