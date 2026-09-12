package com.sellerops.producttruth;

import java.time.LocalDate;
import java.util.List;

/**
 * CURRENT_PRODUCT_TRUTH for something that is not a channel × object capability.
 *
 * <p>{@link ProductCapability} requires a channel and an object, so it structurally cannot hold what
 * the product does across all of them: taking a file the seller uploads, holding the company's own
 * knowledge, remembering past answers, writing a report, surfacing an improvement opportunity. Those
 * were invisible to the ledger — mentioned only inside an invariant's {@code notThis} list, with no
 * status and no evidence — and something invisible to the ledger is something an answer can neither
 * claim nor honestly decline.
 *
 * <p><b>No mode.</b> {@link ProductCapabilityMode} is an axis vocabulary, and a feature has no axis;
 * carrying one would make a feature look like a channel row that forgot its channel.
 *
 * <p>Existing code is not evidence that something is a product capability. A feature whose only
 * support is "the package compiles" carries {@link ProductEvidence#IMPLEMENTED} and says so.
 */
public record ProductFeature(
        String id,
        String title,
        ProductCapabilityStatus status,
        ProductEvidence evidence,
        String evidenceRef,
        List<String> sellerFacingNotes,
        List<String> limitations,
        List<String> sourceRefs,
        ProductReviewState review,
        LocalDate lastReviewed) {
}
