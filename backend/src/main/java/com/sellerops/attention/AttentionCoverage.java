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
    UNCERTAIN_UNSUPPORTED_CHANNEL;

    /** True when the surface must decline to answer instead of rendering a (false) calm empty state. */
    public boolean isUncertain() {
        return this != COVERED;
    }
}
