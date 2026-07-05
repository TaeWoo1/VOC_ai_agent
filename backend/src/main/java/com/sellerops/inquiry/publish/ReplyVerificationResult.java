package com.sellerops.inquiry.publish;

/**
 * Channel-neutral outcome of a verification re-query by a {@link ChannelReplyAdapter}.
 * {@link Kind#COMPLETED} means the adapter confirmed — by its own channel rule — that
 * the reply landed; {@link Kind#NOT_COMPLETED} means not yet (verification stays
 * retryable, the core never resends). {@code observedSignal} is an opaque,
 * adapter-provided status label retained only for the verification audit trail — it is
 * never a provider free-text error message.
 */
public record ReplyVerificationResult(Kind kind, String observedSignal) {

    public enum Kind { COMPLETED, NOT_COMPLETED }

    public static ReplyVerificationResult completed(String observedSignal) {
        return new ReplyVerificationResult(Kind.COMPLETED, observedSignal);
    }

    public static ReplyVerificationResult notCompleted(String observedSignal) {
        return new ReplyVerificationResult(Kind.NOT_COMPLETED, observedSignal);
    }
}
