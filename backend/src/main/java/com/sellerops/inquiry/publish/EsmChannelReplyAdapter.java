package com.sellerops.inquiry.publish;

import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.connector.esm.inquiry.EsmInquiryStatus;
import com.sellerops.credential.CredentialVault;
import com.sellerops.inquiry.reply.EsmAnswerValidation;

/**
 * The ESM+ (G마켓/옥션) channel reply adapter — the first {@link ChannelReplyAdapter}.
 * It concentrates every ESM-specific rule so the channel-neutral core sees none of it:
 *
 * <ul>
 *   <li>the {@code messageNo} reply target (the neutral {@code externalId});</li>
 *   <li>send-time reply-token re-query (with the SellerId cross-check inside the
 *       resolver) and immediate in-memory discard;</li>
 *   <li>JWT credentials (via the transport) and the credential gate;</li>
 *   <li>the official ESM answer request mapping and {@code answerStatus = 2};</li>
 *   <li>the 1000-byte comments limit;</li>
 *   <li>{@code informStatus == 처리완료} verification (never {@code answerDate}).</li>
 * </ul>
 *
 * <p><b>Live only.</b> This adapter is registered ONLY behind {@code
 * sellerops.inquiry.publish.execution-enabled=true} ({@link PublishExecutionWiring});
 * with the flag off no ESM adapter exists and the core fails closed. The transient
 * token is used in memory and discarded; neither it nor any provider free-text message
 * is returned to the core (only a neutral provider reference / numeric result code).
 */
public class EsmChannelReplyAdapter implements ChannelReplyAdapter {

    private final EsmAnswerClient answerClient;
    private final EsmReplyTokenResolver tokenResolver;
    private final EsmInformStatusProbe informProbe;
    private final CredentialVault vault;

    public EsmChannelReplyAdapter(EsmAnswerClient answerClient, EsmReplyTokenResolver tokenResolver,
                                  EsmInformStatusProbe informProbe, CredentialVault vault) {
        this.answerClient = answerClient;
        this.tokenResolver = tokenResolver;
        this.informProbe = informProbe;
        this.vault = vault;
    }

    @Override
    public String channelCode() {
        return EsmApiConnector.CHANNEL_CODE; // "GMARKET" — the ESM catalog channel
    }

    @Override
    public ReplyPublishResult publish(ReplyPublishCommand command) {
        if (!vault.hasCredential(command.orgId(), command.sellerAccountId())) {
            return ReplyPublishResult.retryableFailure(); // enabling requires a real credential
        }
        String messageNo = command.externalId();
        if (messageNo == null || messageNo.isBlank()) {
            return ReplyPublishResult.retryableFailure(); // no reply target
        }
        String comments = command.body();
        if (comments != null
                && EsmAnswerValidation.utf8Bytes(comments) > EsmAnswerValidation.COMMENTS_MAX_BYTES) {
            return ReplyPublishResult.permanentFailure(null); // over the official 1000-byte limit — never sendable
        }

        String token;
        try {
            token = tokenResolver.resolve(command.orgId(), command.sellerAccountId(), messageNo,
                    command.receivedAt());
        } catch (RuntimeException tokenFailure) {
            return ReplyPublishResult.retryableFailure(); // nothing sent — retryable
        }

        EsmAnswerClient.Outcome outcome;
        try {
            outcome = answerClient.post(new EsmAnswerClient.AnswerCommand(
                    command.orgId(), command.sellerAccountId(), messageNo, token,
                    EsmAnswerValidation.ANSWER_STATUS, command.subject(), comments));
        } finally {
            token = null; // discard the transient token immediately after the POST
        }

        return switch (outcome.kind()) {
            case SUCCESS -> ReplyPublishResult.confirmed(outcome.providerMessageNo());
            case FAILURE -> ReplyPublishResult.permanentFailure(outcome.resultCode());
            case DELIVERY_UNKNOWN -> ReplyPublishResult.deliveryUnknown();
        };
    }

    @Override
    public ReplyVerificationResult verify(ReplyVerificationCommand command) {
        String observed = informProbe.currentInformStatus(
                command.orgId(), command.sellerAccountId(), command.externalId(), command.receivedAt());
        boolean processed = observed != null && EsmInquiryStatus.from(observed) == EsmInquiryStatus.PROCESSED;
        return processed ? ReplyVerificationResult.completed(observed)
                : ReplyVerificationResult.notCompleted(observed);
    }
}
