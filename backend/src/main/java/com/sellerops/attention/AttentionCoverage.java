package com.sellerops.attention;

/**
 * Whether the operator attention surface can SAFELY determine the review-attention state for a
 * given account scope — the guard against a "false calm": an empty signal list rendered as
 * "nothing needs attention" when the truth is that SellerOps could not attribute the reviews at all.
 *
 * <p>Two scopes cannot be safely attributed today, and both previously collapsed into an unlabeled
 * empty summary indistinguishable from a genuine zero:
 *
 * <ul>
 *   <li>{@link #UNCERTAIN_MULTI_ACCOUNT} — the org holds more than one seller account on the
 *       channel, and ingested reviews carry no {@code seller_account_id}, so a per-account read
 *       cannot say which account a low-rating review belongs to. Closing this needs account-scoped
 *       ingest; until then the surface must decline to answer rather than report calm.</li>
 *   <li>{@link #UNCERTAIN_UNSUPPORTED_CHANNEL} — the channel has no attention source adapter (e.g.
 *       ESM+/GMARKET, whose reviews land in the store but raise no signals). "No source" is a
 *       capability gap, not evidence that nothing needs a look.</li>
 *   <li>{@link #UNCERTAIN_PRODUCT_UNLINKED} — the scope is a PRODUCT, and the rows that would answer
 *       for it carry no product link, so they cannot be attributed to this product or to any other.
 *       Added 2026-08-21 for the Operator Graph's product specialist, which faces the same shape of
 *       false calm one level down: Cafe24 reviews are promoted with {@code productId = null} by
 *       {@code Cafe24ReviewPromoter} and Coupang review rows sit on an option-id axis, so "this
 *       product has no issues" and "this product's channel data was never linked to a product" would
 *       otherwise be the same empty answer.</li>
 * </ul>
 *
 * <p>{@link #COVERED} is the ONLY value on which an empty signal list may honestly mean "nothing
 * needs attention" — the single-account, supported-channel case (today: NAVER) whose zero is a
 * measured zero. This enum is a sanitized read-time verdict: it names the scope's coverage, never
 * any org / account / channel identity.
 */
public enum AttentionCoverage {
    /** The attention state is safely determinable; an empty list is a measured "nothing needs a look". */
    COVERED,
    /** More than one seller account shares this channel — reviews cannot be attributed per account. */
    UNCERTAIN_MULTI_ACCOUNT,
    /** No attention source serves this channel — review attention is not supported here yet. */
    UNCERTAIN_UNSUPPORTED_CHANNEL,
    /** The rows that would answer for this product carry no product link — nothing can be attributed. */
    UNCERTAIN_PRODUCT_UNLINKED;

    /** True when the surface must decline to answer instead of rendering a (false) calm empty state. */
    public boolean isUncertain() {
        return this != COVERED;
    }
}
