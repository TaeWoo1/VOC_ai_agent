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

    /** Publish the approved reply; returns a channel-neutral {@link ReplyPublishResult}. */
    ReplyPublishResult publish(ReplyPublishCommand command);

    /** Re-query the external result; COMPLETED only when the channel confirms it landed. */
    ReplyVerificationResult verify(ReplyVerificationCommand command);
}
