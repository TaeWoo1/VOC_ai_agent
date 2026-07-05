package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.connector.esm.EsmApiConnector;
import com.sellerops.credential.CredentialVault;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The ESM adapter maps the neutral {@link ReplyPublishCommand}/{@link
 * ReplyVerificationCommand} onto the ESM answer request and {@code informStatus}
 * verification: it fixes {@code answerStatus = 2}, forwards the send-time token then
 * discards it, enforces the 1000-byte comments limit, gates on a credential, and reads
 * {@code informStatus == 처리완료} (never {@code answerDate}). Every ESM outcome maps to
 * a channel-neutral {@link ReplyPublishResult}/{@link ReplyVerificationResult}.
 */
class EsmChannelReplyAdapterTest {

    private final UUID org = UUID.randomUUID();
    private final UUID seller = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final Instant receivedAt = Instant.parse("2026-06-27T00:00:00Z");

    private FakeAnswerClient answerClient;
    private FakeTokenResolver tokenResolver;
    private FakeInformProbe informProbe;
    private CredentialVault vault;
    private EsmChannelReplyAdapter adapter;

    @BeforeEach
    void setUp() {
        answerClient = new FakeAnswerClient();
        tokenResolver = new FakeTokenResolver();
        informProbe = new FakeInformProbe();
        vault = mock(CredentialVault.class);
        when(vault.hasCredential(any(), any())).thenReturn(true);
        adapter = new EsmChannelReplyAdapter(answerClient, tokenResolver, informProbe, vault);
    }

    private ReplyPublishCommand publishCommand(String body) {
        return new ReplyPublishCommand(org, seller, channel, "MSG-1", receivedAt, "제목", body);
    }

    // ---- fakes ----
    static final class FakeAnswerClient implements EsmAnswerClient {
        Outcome outcome = Outcome.success("PROV-1");
        final List<AnswerCommand> commands = new ArrayList<>();

        @Override
        public Outcome post(AnswerCommand command) {
            commands.add(command);
            return outcome;
        }
    }

    static final class FakeTokenResolver implements EsmReplyTokenResolver {
        String token = "SECRET-TOKEN";
        boolean fail = false;

        @Override
        public String resolve(UUID orgId, UUID sellerAccountId, String messageNo, Instant receivedAt) {
            if (fail) {
                throw new IllegalStateException("token unavailable");
            }
            return token;
        }
    }

    static final class FakeInformProbe implements EsmInformStatusProbe {
        String status = "미처리";

        @Override
        public String currentInformStatus(UUID orgId, UUID sellerAccountId, String messageNo, Instant receivedAt) {
            return status;
        }
    }

    @Test
    void channelCodeIsTheEsmCatalogChannel() {
        assertThat(adapter.channelCode()).isEqualTo(EsmApiConnector.CHANNEL_CODE);
    }

    @Test
    void publishSendsFixedAnswerStatusWithTheSendTimeTokenAndMapsSuccess() {
        answerClient.outcome = EsmAnswerClient.Outcome.success("PROV-9");
        ReplyPublishResult r = adapter.publish(publishCommand("내용"));

        assertThat(answerClient.commands).hasSize(1);
        EsmAnswerClient.AnswerCommand c = answerClient.commands.get(0);
        assertThat(c.messageNo()).isEqualTo("MSG-1");
        assertThat(c.answerStatus()).isEqualTo(2);
        assertThat(c.title()).isEqualTo("제목");
        assertThat(c.comments()).isEqualTo("내용");
        assertThat(c.token()).isEqualTo("SECRET-TOKEN"); // the token WAS used at send time

        assertThat(r.kind()).isEqualTo(ReplyPublishResult.Kind.CONFIRMED);
        assertThat(r.providerRef()).isEqualTo("PROV-9");
    }

    @Test
    void providerRejectionMapsToPermanentFailureWithResultCode() {
        answerClient.outcome = EsmAnswerClient.Outcome.failure(9001);
        ReplyPublishResult r = adapter.publish(publishCommand("내용"));
        assertThat(r.kind()).isEqualTo(ReplyPublishResult.Kind.PERMANENT_FAILURE);
        assertThat(r.resultCode()).isEqualTo(9001);
    }

    @Test
    void transportAmbiguityMapsToDeliveryUnknown() {
        answerClient.outcome = EsmAnswerClient.Outcome.deliveryUnknown();
        ReplyPublishResult r = adapter.publish(publishCommand("내용"));
        assertThat(r.kind()).isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
    }

    @Test
    void missingCredentialIsRetryableAndSendsNothing() {
        when(vault.hasCredential(any(), any())).thenReturn(false);
        ReplyPublishResult r = adapter.publish(publishCommand("내용"));
        assertThat(r.kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(answerClient.commands).isEmpty();
    }

    @Test
    void tokenResolveFailureIsRetryableAndSendsNothing() {
        tokenResolver.fail = true;
        ReplyPublishResult r = adapter.publish(publishCommand("내용"));
        assertThat(r.kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(answerClient.commands).isEmpty();
    }

    @Test
    void overLengthCommentsIsPermanentAndSendsNothing() {
        String tooLong = "a".repeat(1001); // > official 1000-byte comments limit
        ReplyPublishResult r = adapter.publish(publishCommand(tooLong));
        assertThat(r.kind()).isEqualTo(ReplyPublishResult.Kind.PERMANENT_FAILURE);
        assertThat(answerClient.commands).isEmpty();
    }

    @Test
    void verifyIsCompletedOnlyWhenInformStatusIsProcessed() {
        informProbe.status = "처리완료";
        ReplyVerificationResult r = adapter.verify(new ReplyVerificationCommand(org, seller, channel, "MSG-1", receivedAt));
        assertThat(r.kind()).isEqualTo(ReplyVerificationResult.Kind.COMPLETED);
        assertThat(r.observedSignal()).isEqualTo("처리완료");
    }

    @Test
    void verifyIsNotCompletedWhenInformStatusIsNotProcessed() {
        informProbe.status = "미처리";
        ReplyVerificationResult r = adapter.verify(new ReplyVerificationCommand(org, seller, channel, "MSG-1", receivedAt));
        assertThat(r.kind()).isEqualTo(ReplyVerificationResult.Kind.NOT_COMPLETED);
    }
}
