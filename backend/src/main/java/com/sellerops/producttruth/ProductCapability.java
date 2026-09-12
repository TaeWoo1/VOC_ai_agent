package com.sellerops.producttruth;

import java.time.LocalDate;
import java.util.List;

/**
 * One CURRENT_PRODUCT_TRUTH row: what reviewnary provides for a channel × object × axis, as a
 * product — independent of any flag, any deployment and any seller's connection.
 *
 * <p>This is the authority for a seller-facing capability sentence. A runtime switch being off is
 * not a reason to demote a row: that is what the runtime overlay says, in its own sentence, beside
 * this one.
 */
public record ProductCapability(
        String id,
        String channel,
        String object,
        ProductCapabilityAxis axis,
        ProductCapabilityStatus status,
        ProductCapabilityMode mode,
        ProductEvidence evidence,
        /** Where the evidence lives — a doc path, an approval id, a class name. Never blank. */
        String evidenceRef,
        /** Sentences a seller may hear. Product truth, not deployment state. */
        List<String> sellerFacingNotes,
        /** What must never be claimed for this row. Read these before widening a sentence. */
        List<String> limitations,
        List<String> sourceRefs,
        /**
         * Preconditions on running this path. Only ever on an EXECUTION row: "the product can post
         * this" and "this deployment and this seller can post it right now" are different facts, and
         * this field is the second one's shape. It never demotes {@link #status()}.
         */
        List<ProductExecutionRequirement> requirements,
        /**
         * Refinements, for a channel whose object is really several contracts. Empty on most rows.
         * A subtype is not a fifth operating object — see {@link ProductCapabilitySubtype}.
         */
        List<ProductCapabilitySubtype> subtypes,
        ProductReviewState review,
        LocalDate lastReviewed) {
}
