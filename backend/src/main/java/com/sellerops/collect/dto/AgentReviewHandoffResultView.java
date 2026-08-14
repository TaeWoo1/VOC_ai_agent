package com.sellerops.collect.dto;

/**
 * What the review handoff did, in counts.
 *
 * <p>{@code stored} is the number of reviews that were genuinely new; {@code skipped} is the number that
 * dedup already held. A re-sync of an unchanged list is {@code stored=0, skipped=N} — which is the
 * idempotence proof, readable straight off the response.
 *
 * <p>{@code complete} is the AGENT's coverage claim, echoed back rather than derived here: the backend cannot
 * know whether the operator paged to the end of the list. A false value means reviews were stored and the
 * list was not covered, which is a valid outcome and a different one from success.
 *
 * <p>Carries no review text, no product ids, and no row identities — the surface that asks "did the import
 * work" does not need to be handed the reviews back to answer it.
 */
public record AgentReviewHandoffResultView(
        int received,
        int stored,
        int skipped,
        int failed,
        boolean complete,
        String importId) {
}
