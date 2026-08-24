package com.sellerops.inquiry.publish.naver;

/**
 * What NAVER said about one answer registration, reduced to what the publish core can act on.
 *
 * @param kind        the channel-neutral verdict
 * @param providerRef the platform's own handle for what was registered, when it gives one
 * @param errorCode   NAVER's own code — {@code ERR-NC-101010} and friends on 고객 문의, the bare HTTP
 *                    status name on 상품 문의. Kept because the codes are how the two subtypes differ
 *                    where it matters, and never rendered to a seller as-is
 */
public record NaverAnswerOutcome(Kind kind, String providerRef, String errorCode) {

    public enum Kind {
        /** NAVER accepted and registered the answer. */
        ACCEPTED,
        /** NAVER refused, and the same request will be refused again. */
        REJECTED,
        /** A transient condition — nothing was registered and the same draft may be sent later. */
        RETRYABLE,
        /** The request left and the result is unknown. Verify; never resend. */
        UNKNOWN,
        /**
         * NAVER says this inquiry already carries an answer.
         *
         * <p>Its own kind rather than a rejection, because it is the one refusal that means the
         * customer HAS been answered — the work is done, by someone, and the seller must be told
         * that rather than told their reply failed.
         */
        ALREADY_ANSWERED
    }

    public static NaverAnswerOutcome accepted(String providerRef) {
        return new NaverAnswerOutcome(Kind.ACCEPTED, providerRef, null);
    }

    public static NaverAnswerOutcome rejected(String errorCode) {
        return new NaverAnswerOutcome(Kind.REJECTED, null, errorCode);
    }

    public static NaverAnswerOutcome retryable(String errorCode) {
        return new NaverAnswerOutcome(Kind.RETRYABLE, null, errorCode);
    }

    public static NaverAnswerOutcome unknown() {
        return new NaverAnswerOutcome(Kind.UNKNOWN, null, null);
    }

    public static NaverAnswerOutcome alreadyAnswered(String errorCode) {
        return new NaverAnswerOutcome(Kind.ALREADY_ANSWERED, null, errorCode);
    }
}
