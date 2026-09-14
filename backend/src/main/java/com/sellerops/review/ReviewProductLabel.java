package com.sellerops.review;

/**
 * What to call the product a review is about — one rule, so every surface calls it the same thing.
 *
 * <p><b>Two facts, and they are not the same fact.</b> {@code productId} says which catalogue product
 * this review is bound to; this says what to PRINT. A review the ingest linked prints the seller's own
 * catalogue name. A review the ingest could not link — because this org holds no such product yet, which
 * is the ordinary state of a seller who connected a browser and no product API — prints the name the
 * CHANNEL published beside it ({@code reviews.source_product_name}, V105).
 *
 * <p><b>It is a label and never an attribution.</b> Nothing resolves by it, nothing counts by it, and no
 * denominator reads it: every per-product figure in this repository keys on {@code product_id} and
 * therefore keeps excluding these rows, which is the correct arithmetic — an unlinked review is not
 * evidence about a product we cannot name. The one thing the label changes is that the seller sees which
 * product their own review is about instead of a blank.
 *
 * <p><b>How a surface tells the two apart, without a third field:</b> a null {@code productId} with a
 * non-null name IS the unlinked state, because the only producer of a name without an id is this
 * fallback. That is what lets a screen drop the product doorway (there is nothing to open) and say so,
 * from data it already holds.
 */
public final class ReviewProductLabel {

    private ReviewProductLabel() {
    }

    /** The linked catalogue name if the review has one, else what the channel called it, else nothing. */
    public static String displayName(Review review, String linkedProductName) {
        if (linkedProductName != null && !linkedProductName.isBlank()) {
            return linkedProductName;
        }
        if (review == null) {
            return null;
        }
        String source = review.getSourceProductName();
        return source == null || source.isBlank() ? null : source;
    }
}
