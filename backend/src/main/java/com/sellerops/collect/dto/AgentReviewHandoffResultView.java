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
 * <p>{@code failed} is what the ingestion spine could not WRITE — and nothing else. A row whose 노출상품ID
 * matched no listing this org holds used to be counted here; since V105 it is STORED, with the channel's own
 * product identity beside it and no product link, and it is reported as {@code unlinked}.
 *
 * <p>{@code unlinked} is therefore a fact about the seller's catalogue, not about the import: these reviews
 * arrived, are readable, and can be decided on, and the one thing not yet known about them is which product of
 * this org they belong to. A browser-only seller — no OpenAPI product sync, zero products — sees every row
 * land here, which is the honest reading and not a failure. Which of the three catalogue reasons applied is in
 * the server log, by reason name and count.
 *
 * <p>Carries no review text, no product ids, and no row identities — the surface that asks "did the import
 * work" does not need to be handed the reviews back to answer it.
 */
public record AgentReviewHandoffResultView(
        int received,
        int stored,
        int skipped,
        int failed,
        int unlinked,
        boolean complete,
        String importId) {
}
