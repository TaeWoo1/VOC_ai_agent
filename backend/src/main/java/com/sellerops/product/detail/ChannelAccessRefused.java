package com.sellerops.product.detail;

/**
 * The channel refused THIS CALLER, not this listing — the caller's IP, the application's API permission or the
 * credential. Thrown by a {@link ProductDetailSource} so a caller that is about to ask for many listings can stop at
 * the first refusal: every later request would be refused the same way, and each one is still a request.
 */
public class ChannelAccessRefused extends RuntimeException {

    /** Why, as a closed set. None of them is about the listing. */
    public enum Reason {
        /** The gateway does not allow calls from this environment (NAVER {@code GW.IP_NOT_ALLOWED}). */
        ENVIRONMENT_NOT_ALLOWED,
        /** The application does not hold the product API permission. */
        PERMISSION,
        /** The stored credential no longer mints a token. */
        CREDENTIAL
    }

    private final Reason reason;

    public ChannelAccessRefused(Reason reason, Throwable cause) {
        super(reason.name(), cause);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
