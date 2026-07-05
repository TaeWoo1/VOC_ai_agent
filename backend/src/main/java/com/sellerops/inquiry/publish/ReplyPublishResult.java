package com.sellerops.inquiry.publish;

/**
 * Channel-neutral outcome of a single publish attempt by a {@link ChannelReplyAdapter}.
 * The core maps each {@link Kind} to an {@link InquiryExecutionStatus} without any
 * channel knowledge:
 *
 * <ul>
 *   <li>{@link Kind#CONFIRMED} &rarr; EXECUTED (the channel accepted the reply; verify next)</li>
 *   <li>{@link Kind#DELIVERY_UNKNOWN} &rarr; DELIVERY_UNKNOWN (ambiguous — verify, never resend)</li>
 *   <li>{@link Kind#RETRYABLE_FAILURE} &rarr; back to ACTION_PENDING (nothing was sent)</li>
 *   <li>{@link Kind#PERMANENT_FAILURE} &rarr; FAILED (the channel rejected the reply)</li>
 * </ul>
 *
 * <p>Carries only a neutral provider reference (on confirmation) or a numeric result
 * code (on permanent rejection) — never a reply token or provider free-text message.
 */
public record ReplyPublishResult(Kind kind, String providerRef, Integer resultCode) {

    public enum Kind { CONFIRMED, DELIVERY_UNKNOWN, RETRYABLE_FAILURE, PERMANENT_FAILURE }

    public static ReplyPublishResult confirmed(String providerRef) {
        return new ReplyPublishResult(Kind.CONFIRMED, providerRef, null);
    }

    public static ReplyPublishResult deliveryUnknown() {
        return new ReplyPublishResult(Kind.DELIVERY_UNKNOWN, null, null);
    }

    public static ReplyPublishResult retryableFailure() {
        return new ReplyPublishResult(Kind.RETRYABLE_FAILURE, null, null);
    }

    public static ReplyPublishResult permanentFailure(Integer resultCode) {
        return new ReplyPublishResult(Kind.PERMANENT_FAILURE, null, resultCode);
    }
}
