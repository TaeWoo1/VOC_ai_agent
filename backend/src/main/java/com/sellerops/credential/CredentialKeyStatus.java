package com.sellerops.credential;

/**
 * Why a stored credential can — or cannot — be opened right now.
 *
 * <p>Before this existed, every one of these failed identically: {@code EnvelopeCipher.open} threw
 * "자격 증명 복호화에 실패했습니다" whether the key was absent, the wrong one, or the payload corrupt.
 * That single message cost a full audit to unpick, and it pointed at the wrong answer — the demo org's
 * Cafe24 credential looked like it needed a marketplace re-consent when the key material was sitting
 * on the same machine under a different name.
 *
 * <p>The distinction each value carries is <b>operationally different work</b>, which is the whole
 * reason to separate them: {@link #KEY_NOT_AVAILABLE} is a configuration fix, {@link #KEY_MISMATCH}
 * is a key-recovery or re-key decision, and {@link #INVALID_CREDENTIAL} is the only one that means
 * the stored bytes themselves are unusable.
 */
public enum CredentialKeyStatus {

    /** The credential opens under the key material currently available. */
    OK,

    /** No credential row for this account (org-scoped: another org's row reads as absent). */
    NO_CREDENTIAL,

    /** The vault has no key material configured at all — {@code SELLEROPS_VAULT_MASTER_KEY} is unset. */
    NO_KEY_CONFIGURED,

    /**
     * The row was sealed under a key id this runtime holds no material for. A configuration
     * problem: name the id in the key ring and the credential opens untouched.
     */
    KEY_NOT_AVAILABLE,

    /**
     * Material IS available for the row's key id, but it is provably not the key that sealed the row —
     * the stored key fingerprint and the available key's fingerprint disagree. Proven, not inferred:
     * no decryption is attempted to reach this verdict.
     */
    KEY_MISMATCH,

    /**
     * Decryption failed and the cause cannot be narrowed, because the row predates key fingerprinting.
     * Either the wrong key or a damaged payload. Every row written from V53 onward can be classified
     * exactly; this value exists for the ones written before it.
     */
    KEY_UNVERIFIABLE,

    /**
     * The right key is present and demonstrably correct, and decryption still failed — the stored
     * envelope is damaged. Nothing but re-entering the credential can fix it (as with
     * {@link #KEY_UNVERIFIABLE}, whose cause cannot be narrowed); every other status is a key
     * question, not a credential one.
     */
    INVALID_CREDENTIAL;

    /**
     * Whether the seller is the one who can fix this — the single place that answer is decided.
     *
     * <p>Getting it wrong is expensive in both directions. Telling a seller to reconnect for a
     * server-side key problem spends their time on something that cannot work: the demo org's Cafe24
     * credential was fixed by naming a key in a config file, and a reconnect prompt would have sent
     * the seller to a marketplace for nothing. Telling them to wait for an operator when their own
     * credential is the problem leaves the connection dead and nobody looking at it.
     *
     * <p>{@link #KEY_UNVERIFIABLE} counts as the seller's: the cause genuinely cannot be narrowed,
     * and re-entering the credential reseals it under the active key, which resolves it either way.
     */
    public boolean sellerActionable() {
        return this == KEY_UNVERIFIABLE || this == INVALID_CREDENTIAL;
    }
}
