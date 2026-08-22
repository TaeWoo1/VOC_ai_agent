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
 * <p>{@code failed} covers two different things and deliberately does not distinguish them here: a row the
 * ingestion spine could not write, and a row whose 노출상품ID matched no listing this org holds. Both mean
 * "handed over and not stored", which is what the operator's next action turns on; which of the two it was is
 * in the server log, by reason name and count.
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
