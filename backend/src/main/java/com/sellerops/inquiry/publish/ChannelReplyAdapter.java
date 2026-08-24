package com.sellerops.inquiry.publish;

/**
 * The seam between the channel-neutral publish core and one specific commerce channel.
 *
 * <p>The core ({@link InquiryPublishService}) owns everything channel-independent:
 * draft binding and seller confirmation, the ActionIntent, the execution and
 * verification lifecycle, idempotency, audit, retry, and recovery, and the
 * Seller-visible outcome categories. An adapter owns only two channel-specific things:
 * how to <b>publish</b> the approved reply to its channel and how to <b>verify</b> the
 * external result.
 *
 * <p>Adapters are selected by {@link #channelCode()} (matched against the work item's
 * {@code Channel.code}) via {@link ChannelReplyAdapterRegistry}. When no adapter serves
 * a channel — an unsupported channel, or any channel while live execution is disabled —
 * the core <b>fails closed</b> and never dispatches.
 *
 * <p>Contract: {@code publish}/{@code verify} map every <i>expected</i> failure to a
 * channel-neutral result and do not throw for them; a transport ambiguity must map to
 * {@link ReplyPublishResult.Kind#DELIVERY_UNKNOWN} (never a silent success or resend).
 * Neither a reply token nor any provider free-text message ever crosses back to the core.
 */
public interface ChannelReplyAdapter {

    /** The {@code Channel.code} this adapter serves (e.g. the ESM catalog channel). */
    String channelCode();

    /**
     * Whether this adapter serves the given {@code source_subtype} — the exact channel RESOURCE the
     * inquiry came from.
     *
     * <p>A channel code is not specific enough to send with. NAVER carries two inquiry resources whose
     * identifier spaces do not overlap ({@code questionId} for 상품 문의, {@code inquiryNo} for
     * 고객 문의) and whose answer endpoints are different calls. One adapter claiming "NAVER" would let
     * an approval granted for one resource be spent by an implementation written for the other, and
     * the identifier would be accepted by neither — or, worse, be a valid handle for something else.
     *
     * <p>The default serves the {@code null} subtype only: a channel with exactly one inquiry
     * resource. Any adapter for a multi-resource channel must override and name its resource, which
     * makes the omission impossible to write by accident.
     */
    default boolean servesSubtype(String sourceSubtype) {
        return sourceSubtype == null;
    }

    /** Publish the approved reply; returns a channel-neutral {@link ReplyPublishResult}. */
    ReplyPublishResult publish(ReplyPublishCommand command);

    /** Re-query the external result; COMPLETED only when the channel confirms it landed. */
    ReplyVerificationResult verify(ReplyVerificationCommand command);
}
