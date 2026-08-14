package com.sellerops.inquiry.publish;

import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangInquiryReplyClient;
import com.sellerops.connector.coupang.CoupangTransportAmbiguityException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;

/**
 * The Coupang 상품별 고객문의 reply adapter — the second {@link ChannelReplyAdapter}, and the first one
 * whose channel offers an official answer API.
 *
 * <p>It concentrates every Coupang-specific rule so the channel-neutral core sees none of it:
 *
 * <ul>
 *   <li>the {@code onlineInquiry:} external-id namespace, stripped back to the bare {@code inquiryId}
 *       the answer endpoint addresses;</li>
 *   <li>the CEA-signed {@code POST .../onlineInquiries/{inquiryId}/replies} (via the transport);</li>
 *   <li>the {@code replyBy} operator id, which is configuration rather than a vault secret;</li>
 *   <li>verification by re-query of the ANSWERED bucket — the platform's own answer, not ours.</li>
 * </ul>
 *
 * <p><b>Why this channel needs no browser step.</b> The ESM adapter beside it must resolve a
 * send-time token by re-querying, because that channel has no stable reply handle. Coupang has one:
 * the {@code inquiryId} SellerOps already stored at collection time. So the whole class of "find the
 * right row on a rendered page" problems does not arise here, and the earlier WING targeting work is
 * kept only as a diagnostic.
 *
 * <p><b>Live only.</b> Registered ONLY behind {@code sellerops.inquiry.publish.execution-enabled=true}
 * ({@link PublishExecutionWiring}); with the flag off no Coupang adapter bean exists, the registry
 * resolves empty, and the core fails closed. Nothing here decides to send — the core reaches this
 * class only after an approved draft has been bound to a seller's explicit confirmation.
 *
 * <p><b>Never a resend.</b> A transport ambiguity maps to {@link ReplyPublishResult.Kind#DELIVERY_UNKNOWN}
 * so the core verifies rather than posts again. A second answer to a real customer is not a retry; it
 * is a second answer.
 */
public class CoupangChannelReplyAdapter implements ChannelReplyAdapter {

    /**
     * The external-id namespace the collection client stamps onto every 상품별 고객문의.
     *
     * <p>Duplicated here as a constant rather than imported, because the two mean different things:
     * there it is the id SellerOps stores, here it is the prefix that must come OFF before the number
     * can address the answer endpoint. A shared symbol would hide that a translation happens.
     */
    static final String ONLINE_INQUIRY_PREFIX = "onlineInquiry:";

    /**
     * Coupang's documented answer-length ceiling.
     *
     * <p>Bounded here rather than at the transport so an over-long draft is a PERMANENT failure the
     * seller can see and edit, instead of a rejected write they have to interpret. The value is from
     * the public API reference and has never been exercised live; a real rejection carrying a
     * different limit is the evidence that would correct it.
     */
    static final int CONTENT_MAX_BYTES = 1000;

    private final CoupangInquiryReplyClient replyClient;
    private final CredentialVault vault;
    private final String replyBy;

    public CoupangChannelReplyAdapter(CoupangInquiryReplyClient replyClient, CredentialVault vault,
                                      String replyBy) {
        this.replyClient = replyClient;
        this.vault = vault;
        this.replyBy = replyBy == null ? "" : replyBy.trim();
    }

    @Override
    public String channelCode() {
        return CoupangApiConnector.CHANNEL_CODE; // "COUPANG"
    }

    @Override
    public ReplyPublishResult publish(ReplyPublishCommand command) {
        if (!vault.hasCredential(command.orgId(), command.sellerAccountId())) {
            return ReplyPublishResult.retryableFailure();
        }
        // Configuration, not a credential — and its absence is a deployment fact the seller cannot
        // fix by retrying. It is still RETRYABLE rather than PERMANENT: nothing was sent, and the
        // same draft becomes sendable the moment the deployment is corrected. Marking it permanent
        // would burn a seller's approved reply on a misconfiguration.
        if (replyBy.isEmpty()) {
            return ReplyPublishResult.retryableFailure();
        }
        String inquiryId = bareInquiryId(command.externalId());
        if (inquiryId == null) {
            return ReplyPublishResult.retryableFailure(); // no reply target
        }
        String content = command.body();
        if (content == null || content.isBlank()) {
            return ReplyPublishResult.retryableFailure();
        }
        if (CoupangInquiryReplyClient.utf8Bytes(content) > CONTENT_MAX_BYTES) {
            return ReplyPublishResult.permanentFailure(null); // never sendable as written
        }

        DecryptedCredential credential = vault.open(command.orgId(), command.sellerAccountId());
        String accessKey = credential.secrets().get("access_key");
        String secretKey = credential.secrets().get("secret_key");
        String vendorId = credential.secrets().get("vendor_id");

        CoupangInquiryReplyClient.Outcome outcome;
        try {
            outcome = replyClient.postReply(accessKey, secretKey, vendorId, inquiryId, content, replyBy);
        } catch (CoupangTransportAmbiguityException ambiguous) {
            // The request left and no answer came back. Verify; never resend.
            return ReplyPublishResult.deliveryUnknown();
        } catch (RuntimeException failure) {
            // Every other connector failure means nothing was sent — the guard refusing an unapproved
            // live call, a blank base URL, a credential that will not decrypt.
            return ReplyPublishResult.retryableFailure();
        }

        return switch (outcome.kind()) {
            // The provider reference is the inquiry's own id: Coupang's reply response carries no
            // separate handle, and inventing one would put a fabricated reference in the audit trail.
            case ACCEPTED -> ReplyPublishResult.confirmed(inquiryId);
            case REJECTED -> ReplyPublishResult.permanentFailure(outcome.resultCode());
            case RETRYABLE -> ReplyPublishResult.retryableFailure();
            case UNKNOWN -> ReplyPublishResult.deliveryUnknown();
        };
    }

    @Override
    public ReplyVerificationResult verify(ReplyVerificationCommand command) {
        String inquiryId = bareInquiryId(command.externalId());
        if (inquiryId == null || !vault.hasCredential(command.orgId(), command.sellerAccountId())) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        DecryptedCredential credential = vault.open(command.orgId(), command.sellerAccountId());
        boolean answered;
        try {
            answered = replyClient.isAnswered(
                    credential.secrets().get("access_key"),
                    credential.secrets().get("secret_key"),
                    credential.secrets().get("vendor_id"),
                    inquiryId,
                    command.receivedAt());
        } catch (RuntimeException failure) {
            // A verification that could not run has not disproved anything. NOT_COMPLETED keeps it
            // retryable; the core never resends on the strength of it.
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        // The signal is the platform's own bucket name — a fixed enum, not a provider message.
        return answered ? ReplyVerificationResult.completed("ANSWERED")
                : ReplyVerificationResult.notCompleted("NOANSWER");
    }

    /**
     * The bare numeric id the answer endpoint addresses, or null when the external id is not one of
     * ours.
     *
     * <p>The prefix is REQUIRED, not optional. A 고객센터 inquiry and a 상품별 inquiry number from their
     * own sequences, so an unprefixed id could name a different inquiry entirely — accepting one here
     * would answer a stranger's question with this seller's reply.
     */
    static String bareInquiryId(String externalId) {
        if (externalId == null || !externalId.startsWith(ONLINE_INQUIRY_PREFIX)) {
            return null;
        }
        String bare = externalId.substring(ONLINE_INQUIRY_PREFIX.length());
        return bare.matches("[0-9]{1,24}") ? bare : null;
    }
}
