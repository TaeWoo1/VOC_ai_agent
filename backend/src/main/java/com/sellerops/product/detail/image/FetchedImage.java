package com.sellerops.product.detail.image;

/**
 * One 상세페이지 picture, reduced to what a census or an extraction budget needs to know.
 *
 * <p><b>It does not carry the URL, and that is deliberate.</b> A record that holds the address is a
 * record that puts the address in every log line and every report built from it. What identifies a
 * picture here is its {@link #sha256} — the byte content — which is also the only identity that
 * survives a CDN changing its query string. Position on the page ({@link #ordinal}) is enough to
 * correlate back to the reference list in the one place that still holds it.
 *
 * <p>It does not carry the bytes either. They are hashed and measured and dropped; storing a copy of
 * the seller's picture is a different decision that nothing here has made.
 *
 * @param ordinal     position among the page's fetchable references, 0-based
 * @param outcome     what happened; only {@link Outcome#OK} guarantees the other fields
 * @param sha256      lowercase hex of the content hash, or null
 * @param byteSize    bytes received, or 0
 * @param contentType the type the server declared, or null
 * @param width       header-read pixel width, or 0 when unreadable
 * @param height      header-read pixel height, or 0 when unreadable
 */
public record FetchedImage(int ordinal, Outcome outcome, String sha256, int byteSize,
                           String contentType, int width, int height) {

    /** Every way this ends. Closed, so a census can report without prose. */
    public enum Outcome {
        OK,
        REFUSED_SCHEME,
        REFUSED_HOST,
        REFUSED_PRIVATE_ADDRESS,
        UNRESOLVABLE,
        TOO_MANY_REDIRECTS,
        HTTP_ERROR,
        NOT_AN_IMAGE,
        TOO_LARGE,
        BUDGET_EXHAUSTED,
        TRANSPORT_FAILED
    }

    static FetchedImage failed(int ordinal, Outcome outcome) {
        return new FetchedImage(ordinal, outcome, null, 0, null, 0, 0);
    }

    public boolean ok() {
        return outcome == Outcome.OK;
    }

    /** Whether the size is known. Unknown dimensions are normal, not an error. */
    public boolean hasDimensions() {
        return width > 0 && height > 0;
    }
}
