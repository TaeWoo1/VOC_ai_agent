package com.sellerops.responsibility;

/**
 * Whether the store that was read is the store the account represents. An official-API source is bound to its
 * store by the credential itself, so its verdict is {@link #NOT_APPLICABLE}; browser sources must assert it.
 */
public enum IdentityVerdict {
    MATCH,
    MISMATCH,
    UNRESOLVED,
    NOT_APPLICABLE
}
