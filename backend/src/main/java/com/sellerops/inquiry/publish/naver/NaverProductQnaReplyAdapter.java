package com.sellerops.inquiry.publish.naver;

import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.naver.NaverInquiryCursor;
import com.sellerops.connector.naver.NaverProductQnaClient;
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

/**
 * The NAVER 상품 문의 reply adapter — one subtype, one endpoint, and nothing that could serve the
 * other.
 *
 * <p><b>It refuses the sibling subtype by construction.</b> {@link #servesSubtype} answers only
 * {@code NAVER_PRODUCT_QNA}, so an approval granted for a 고객 문의 can never be spent here. That is
 * not defensive coding: the two identifier spaces are both bare int64s from different sequences, so a
 * {@code questionId} handed to the 고객 문의 endpoint is not an error — it is a valid handle for
 * somebody else's inquiry.
 *
 * <p><b>The overwrite hazard lives on this subtype.</b> {@code PUT /v1/contents/qnas/{questionId}} is
 * an upsert with no duplicate protection, so the whole safety of this path is the check that runs
 * immediately before it ({@code PreSendCheck#ALREADY_ANSWERED}) and the rule that a transport
 * ambiguity verifies rather than retries.
 */
public class NaverProductQnaReplyAdapter implements ChannelReplyAdapter {

    /** The external-id namespace collection stamps onto every 상품 문의. */
    static final String QNA_PREFIX = "naver-qna:";

    private final NaverProductQnaAnswerClient answerClient;
    private final NaverProductQnaClient readClient;
    private final NaverTokenClient tokens;
    private final CredentialVault vault;
    private final Clock clock;

    public NaverProductQnaReplyAdapter(NaverProductQnaAnswerClient answerClient,
                                       NaverProductQnaClient readClient, NaverTokenClient tokens,
                                       CredentialVault vault, Clock clock) {
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
        return InquirySourceSubtype.NAVER_PRODUCT_QNA.equals(sourceSubtype);
    }

    @Override
    public ReplyPublishResult publish(ReplyPublishCommand command) {
        String questionId = bareId(command.externalId());
        if (questionId == null) {
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
            // Nothing was sent — a credential that will not open, or a token mint that failed.
            return ReplyPublishResult.retryableFailure();
        }

        NaverAnswerOutcome outcome;
        try {
            outcome = answerClient.postAnswer(token, questionId, content);
        } catch (NaverAnswerTransportAmbiguity ambiguous) {
            return ReplyPublishResult.deliveryUnknown();
        } catch (RuntimeException failure) {
            // Includes the live-approval interlock: nothing left the process.
            return ReplyPublishResult.retryableFailure();
        }
        return switch (outcome.kind()) {
            case ACCEPTED -> ReplyPublishResult.confirmed(outcome.providerRef());
            case REJECTED -> ReplyPublishResult.permanentFailure(null);
            case RETRYABLE -> ReplyPublishResult.retryableFailure();
            // This endpoint has no duplicate refusal of its own, so the kind is unreachable here;
            // it is mapped rather than ignored so a future contract change cannot fall through.
            case ALREADY_ANSWERED -> ReplyPublishResult.permanentFailure(null);
            case UNKNOWN -> ReplyPublishResult.deliveryUnknown();
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
                readClient::fetchPage, token, NaverInquiryCursor.SOURCE_PRODUCT_QNA,
                externalId, command.receivedAt(), clock.instant());
        return state == NaverAnsweredStateReader.State.ANSWERED
                ? ReplyVerificationResult.completed("ANSWERED")
                : ReplyVerificationResult.notCompleted(state.name());
    }

    private String accessToken(java.util.UUID orgId, java.util.UUID sellerAccountId) {
        DecryptedCredential credential = vault.open(orgId, sellerAccountId);
        return tokens.accessToken(credential.secrets().get("client_id"),
                credential.secrets().get("client_secret"));
    }

    /**
     * The bare {@code questionId} the answer endpoint addresses, or null when the external id is not
     * a 상품 문의 handle.
     *
     * <p>The prefix is REQUIRED. 상품 문의 and 고객 문의 numbers come from different sequences, so an
     * unprefixed id could name either — and answering the wrong one publishes this seller's reply
     * under a stranger's question.
     */
    static String bareId(String externalId) {
        if (externalId == null || !externalId.startsWith(QNA_PREFIX)) {
            return null;
        }
        String bare = externalId.substring(QNA_PREFIX.length());
        return bare.matches("[0-9]{1,19}") ? bare : null;
    }
}
