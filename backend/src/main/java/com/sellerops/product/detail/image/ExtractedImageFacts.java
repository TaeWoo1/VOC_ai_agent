package com.sellerops.product.detail.image;

import java.util.List;

/**
 * What one picture said, as a closed list of triples — and the whole vocabulary this lane has.
 *
 * <p><b>An extraction is not an authority.</b> A triple here means "these words are printed on this
 * image"; whether SellerOps may state it to a customer is decided later and elsewhere
 * ({@link ImageFactAuthority}), after every image in the product has been read. Keeping the two apart
 * is what lets the extraction be stored durably — so a crash after the model call does not buy the
 * same call twice — without anything downstream treating a stored triple as a fact it may quote.
 *
 * <p>{@code facts} may be empty, and empty is a real answer rather than a failure.
 */
public record ExtractedImageFacts(List<Fact> facts) {

    /** The upper bound on triples from a single image. A spec table larger than this is not a table. */
    public static final int MAX_FACTS = 60;

    /** The upper bound on any one field. Long enough for a 규격 row, short enough to refuse prose. */
    public static final int MAX_FIELD_CHARS = 120;

    public ExtractedImageFacts {
        facts = facts == null ? List.of() : List.copyOf(facts);
    }

    public static ExtractedImageFacts empty() {
        return new ExtractedImageFacts(List.of());
    }

    public boolean isEmpty() {
        return facts.isEmpty();
    }

    /**
     * One printed statement: which 규격 it is about, what is being stated, and the stated value.
     *
     * <p>No confidence, no bounding box, no page coordinates, no raw line. Each of those would be a
     * thing to store, a thing to show, and eventually a thing to reason about — and none of them
     * changes whether the words are printed on the seller's own page.
     */
    public record Fact(String specLabel, String attribute, String value) {
    }
}
