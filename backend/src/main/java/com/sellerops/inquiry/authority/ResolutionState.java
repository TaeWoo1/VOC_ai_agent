package com.sellerops.inquiry.authority;

/**
 * Where one resolution step ended. The two «not answered» states are deliberately distinct:
 * <ul>
 *   <li>{@link #NEEDS_SELLER} — the authority exists and the seller's knowledge or judgment is what is missing (Teach
 *       can close it next time);</li>
 *   <li>{@link #CAPABILITY_GAP} — the system cannot reach the authority at all (no connector field, no binding, no
 *       executor, never acquired). Teaching the seller's words cannot close it; building or acquiring can.</li>
 * </ul>
 * Both route the Case to the seller today; only one of them is the seller's knowledge being short.
 */
public enum ResolutionState {
    RESOLVED,
    /** Resolved for a value the customer still has to name (an option, a size) — asked, never assumed. */
    RESOLVED_CONDITIONAL,
    NEEDS_CUSTOMER_INPUT,
    NEEDS_SELLER,
    CAPABILITY_GAP,
    /** A model or schema failure upstream — nothing may be completed. */
    FAILED;

    public boolean closesTheNeed() {
        return this == RESOLVED || this == RESOLVED_CONDITIONAL;
    }
}
