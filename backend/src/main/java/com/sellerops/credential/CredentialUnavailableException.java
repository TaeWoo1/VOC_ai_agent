package com.sellerops.credential;

/**
 * A stored credential could not be opened, and this says which of the several very different
 * reasons it was.
 *
 * <p>Extends {@link IllegalStateException} deliberately: every existing caller of
 * {@link CredentialVault#open} already handles that type, and a connector that only wants to fail
 * the run keeps working unchanged. Callers that can act on the distinction — the connection
 * troubleshooting surface, the sync failure record — read {@link #status()}.
 *
 * <p>The message names the key id and, when known, the two disagreeing key fingerprints. All three
 * are non-secret by construction: a fingerprint is a one-way HMAC of the master key under a fixed
 * label, so it identifies a key without carrying any part of it. Nothing here ever carries secret
 * material — that is what made the original opaque message tempting, and it was not a good trade.
 */
public class CredentialUnavailableException extends IllegalStateException {

    private final CredentialKeyStatus status;
    private final String keyId;

    public CredentialUnavailableException(CredentialKeyStatus status, String keyId, String message) {
        super(message);
        this.status = status;
        this.keyId = keyId;
    }

    public CredentialKeyStatus status() {
        return status;
    }

    /** The key id the row was sealed under, or null when the row named none. */
    public String keyId() {
        return keyId;
    }
}
