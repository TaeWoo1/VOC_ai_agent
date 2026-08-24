package com.sellerops.inquiry.publish.naver;

import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverCustomerInquiriesClient;
import com.sellerops.connector.naver.NaverInquiryCursor;
import com.sellerops.connector.naver.NaverTokenClient;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.inquiry.publish.ChannelReplyAdapter;
import com.sellerops.inquiry.publish.ReplyPublishCommand;
import com.sellerops.inquiry.publish.ReplyPublishResult;
import com.sellerops.inquiry.publish.ReplyVerificationCommand;
import com.sellerops.inquiry.publish.ReplyVerificationResult;
import java.time.Clock;
import java.util.UUID;

/**
 * The NAVER 고객 문의 reply adapter — the other subtype, and a genuinely different contract.
 *
 * <p>Everything that differs from its 상품 문의 sibling is a reason the two cannot share an adapter:
 *
 * <ul>
 *   <li>a different endpoint ({@code POST .../pay-merchant/inquiries/&#123;inquiryNo&#125;/answer});</li>
 *   <li>a different required body field ({@code answerComment}, not {@code commentContent});</li>
 *   <li>a different identifier space ({@code inquiryNo}, from its own sequence);</li>
 *   <li>and a different answer to "what if it is already answered": this one REFUSES, with
 *       {@code ERR-NC-101010}, where the sibling silently overwrites.</li>
 * </ul>
 *
 * <p><b>That refusal is reported as success, deliberately.</b> {@code ERR-NC-101010} means the
 * customer has an answer. Mapping it to a failure would tell the seller their reply did not land and
 * invite them to send it again; mapping it to CONFIRMED would claim SellerOps wrote something it did
 * not. It maps to {@link ReplyPublishResult#deliveryUnknown()}, which sends the core to VERIFY — and
 * verification will find the answer and complete the work item on the platform's own evidence.
 */
public class NaverCustomerInquiryReplyAdapter implements ChannelReplyAdapter {

    /** The external-id namespace collection stamps onto every 고객 문의. */
    static final String INQUIRY_PREFIX = "naver-payinq:";

    private final NaverCustomerInquiryAnswerClient answerClient;
    private final NaverCustomerInquiriesClient readClient;
    private final NaverTokenClient tokens;
    private final CredentialVault vault;
    private final Clock clock;

    public NaverCustomerInquiryReplyAdapter(NaverCustomerInquiryAnswerClient answerClient,
                                            NaverCustomerInquiriesClient readClient,
                                            NaverTokenClient tokens, CredentialVault vault,
                                            Clock clock) {
        this.answerClient = answerClient;
        this.readClient = readClient;
        this.tokens = tokens;
        this.vault = vault;
        this.clock = clock;
    }

    @Override
    public String channelCode() {
        return NaverApiConnector.CHANNEL_CODE;
    }

    @Override
    public boolean servesSubtype(String sourceSubtype) {
        return InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY.equals(sourceSubtype);
    }

    @Override
    public ReplyPublishResult publish(ReplyPublishCommand command) {
        String inquiryNo = bareId(command.externalId());
        if (inquiryNo == null) {
            return ReplyPublishResult.retryableFailure();
        }
        String content = command.body();
        if (content == null || content.isBlank()) {
            return ReplyPublishResult.retryableFailure();
        }
        if (!vault.hasCredential(command.orgId(), command.sellerAccountId())) {
            return ReplyPublishResult.retryableFailure();
        }
        String token;
        try {
            token = accessToken(command.orgId(), command.sellerAccountId());
        } catch (RuntimeException noToken) {
            return ReplyPublishResult.retryableFailure();
        }

        NaverAnswerOutcome outcome;
        try {
            outcome = answerClient.postAnswer(token, inquiryNo, content);
        } catch (NaverAnswerTransportAmbiguity ambiguous) {
            return ReplyPublishResult.deliveryUnknown();
        } catch (RuntimeException failure) {
            return ReplyPublishResult.retryableFailure();
        }
        return switch (outcome.kind()) {
            case ACCEPTED -> ReplyPublishResult.confirmed(outcome.providerRef());
            case REJECTED -> ReplyPublishResult.permanentFailure(null);
            case RETRYABLE -> ReplyPublishResult.retryableFailure();
            // Someone answered — possibly this seller, in the NAVER console, between the approval and
            // the send. Verify and let the platform's own state close the work item.
            case ALREADY_ANSWERED, UNKNOWN -> ReplyPublishResult.deliveryUnknown();
        };
    }

    @Override
    public ReplyVerificationResult verify(ReplyVerificationCommand command) {
        String externalId = command.externalId();
        if (bareId(externalId) == null || !vault.hasCredential(command.orgId(), command.sellerAccountId())) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        String token;
        try {
            token = accessToken(command.orgId(), command.sellerAccountId());
        } catch (RuntimeException noToken) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        NaverAnsweredStateReader.State state = NaverAnsweredStateReader.read(
                readClient::fetchPage, token, NaverInquiryCursor.SOURCE_CUSTOMER,
                externalId, command.receivedAt(), clock.instant());
        return state == NaverAnsweredStateReader.State.ANSWERED
                ? ReplyVerificationResult.completed("ANSWERED")
                : ReplyVerificationResult.notCompleted(state.name());
    }

    private String accessToken(UUID orgId, UUID sellerAccountId) {
        DecryptedCredential credential = vault.open(orgId, sellerAccountId);
        return tokens.accessToken(credential.secrets().get("client_id"),
                credential.secrets().get("client_secret"));
    }

    /** The bare {@code inquiryNo}, or null when the external id is not a 고객 문의 handle. */
    static String bareId(String externalId) {
        if (externalId == null || !externalId.startsWith(INQUIRY_PREFIX)) {
            return null;
        }
        String bare = externalId.substring(INQUIRY_PREFIX.length());
        return bare.matches("[0-9]{1,19}") ? bare : null;
    }
}
