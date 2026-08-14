package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangInquiryReplyClient;
import com.sellerops.connector.coupang.CoupangLiveApprovalRequiredException;
import com.sellerops.connector.coupang.CoupangTransportAmbiguityException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The Coupang adapter maps the neutral {@link ReplyPublishCommand}/{@link ReplyVerificationCommand}
 * onto the official answer endpoint and its re-query verification.
 *
 * <p>What these pin: the {@code onlineInquiry:} namespace is stripped to the bare id the endpoint
 * addresses <b>and required</b>, an ambiguous send is DELIVERY_UNKNOWN rather than a retry, a missing
 * {@code replyBy} refuses without burning the seller's approved draft, and verification says
 * COMPLETED only when Coupang itself lists the inquiry as answered.
 */
class CoupangChannelReplyAdapterTest {

    private final UUID org = UUID.randomUUID();
    private final UUID seller = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final Instant receivedAt = Instant.parse("2026-08-13T05:00:00Z");

    private static final String EXTERNAL_ID = "onlineInquiry:158421449";
    private static final String BARE_ID = "158421449";
    private static final String REPLY_BY = "wing-operator";

    private FakeReplyClient replyClient;
    private CredentialVault vault;
    private CoupangChannelReplyAdapter adapter;

    /** A stand-in for the transport: records what it was asked to send, answers what it is told to. */
    private static final class FakeReplyClient extends CoupangInquiryReplyClient {

        String sentInquiryId;
        String sentContent;
        String sentReplyBy;
        Outcome outcome = Outcome.accepted();
        RuntimeException failure;
        boolean answered;
        RuntimeException verifyFailure;
        String verifiedInquiryId;

        FakeReplyClient() {
            // A loopback base URL: the live-call guard never demands an approval id offline.
            super(null, null, "http://localhost", "", java.time.Clock.systemUTC());
        }

        @Override
        public Outcome postReply(String accessKey, String secretKey, String vendorId,
                                 String inquiryId, String content, String replyBy) {
            sentInquiryId = inquiryId;
            sentContent = content;
            sentReplyBy = replyBy;
            if (failure != null) {
                throw failure;
            }
            return outcome;
        }

        @Override
        public boolean isAnswered(String accessKey, String secretKey, String vendorId,
                                  String inquiryId, Instant inquiredAt) {
            verifiedInquiryId = inquiryId;
            if (verifyFailure != null) {
                throw verifyFailure;
            }
            return answered;
        }
    }

    @BeforeEach
    void setUp() {
        replyClient = new FakeReplyClient();
        vault = mock(CredentialVault.class);
        when(vault.hasCredential(any(), any())).thenReturn(true);
        when(vault.open(any(), any())).thenReturn(new DecryptedCredential(
                "coupang", "HMAC",
                Map.of("access_key", "AK-1", "secret_key", "SK-1", "vendor_id", "A00012345"),
                null, null));
        adapter = new CoupangChannelReplyAdapter(replyClient, vault, REPLY_BY);
    }

    private ReplyPublishCommand publishCommand(String externalId, String body) {
        return new ReplyPublishCommand(org, seller, channel, externalId, receivedAt, null, body);
    }

    private ReplyPublishResult publish(String body) {
        return adapter.publish(publishCommand(EXTERNAL_ID, body));
    }

    @Test
    void serves_the_coupang_channel() {
        assertThat(adapter.channelCode()).isEqualTo(CoupangApiConnector.CHANNEL_CODE);
    }

    @Test
    void strips_the_external_id_namespace_down_to_the_id_the_endpoint_addresses() {
        assertThat(publish("답변 드립니다.").kind()).isEqualTo(ReplyPublishResult.Kind.CONFIRMED);

        assertThat(replyClient.sentInquiryId).isEqualTo(BARE_ID);
        assertThat(replyClient.sentContent).isEqualTo("답변 드립니다.");
        assertThat(replyClient.sentReplyBy).isEqualTo(REPLY_BY);
    }

    @Test
    void the_provider_reference_is_the_inquiry_id_rather_than_an_invented_handle() {
        // Coupang's reply response carries no separate handle. Fabricating one would put a reference
        // in the audit trail that names nothing.
        assertThat(publish("답변").providerRef()).isEqualTo(BARE_ID);
    }

    @Test
    void an_external_id_without_our_namespace_is_NOT_answered() {
        // 고객센터 and 상품별 inquiries number from their own sequences. Accepting a bare id would let
        // this seller's reply be posted against a different inquiry entirely.
        for (String foreign : new String[] {"158421449", "callCenterInquiry:158421449", "", null}) {
            assertThat(adapter.publish(publishCommand(foreign, "답변")).kind())
                    .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        }
        assertThat(replyClient.sentInquiryId).isNull();
    }

    @Test
    void a_transport_ambiguity_is_DELIVERY_UNKNOWN_never_a_retry() {
        replyClient.failure = new CoupangTransportAmbiguityException("no response");

        assertThat(publish("답변").kind()).isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
    }

    @Test
    void every_other_connector_failure_means_nothing_was_sent() {
        replyClient.failure = new CoupangLiveApprovalRequiredException("not armed");

        assertThat(publish("답변").kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
    }

    @Test
    void maps_each_transport_outcome_to_its_neutral_meaning() {
        replyClient.outcome = CoupangInquiryReplyClient.Outcome.rejected(400);
        ReplyPublishResult rejected = publish("답변");
        assertThat(rejected.kind()).isEqualTo(ReplyPublishResult.Kind.PERMANENT_FAILURE);
        assertThat(rejected.resultCode()).isEqualTo(400);

        replyClient.outcome = CoupangInquiryReplyClient.Outcome.retryable();
        assertThat(publish("답변").kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);

        replyClient.outcome = CoupangInquiryReplyClient.Outcome.unknown();
        assertThat(publish("답변").kind()).isEqualTo(ReplyPublishResult.Kind.DELIVERY_UNKNOWN);
    }

    @Test
    void a_missing_replyBy_refuses_WITHOUT_burning_the_sellers_approved_draft() {
        // Retryable, not permanent: nothing was sent, and the same draft becomes sendable the moment
        // the deployment is corrected. Permanent here would throw away an approved reply over config.
        CoupangChannelReplyAdapter unconfigured = new CoupangChannelReplyAdapter(replyClient, vault, "  ");

        assertThat(unconfigured.publish(publishCommand(EXTERNAL_ID, "답변")).kind())
                .isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(replyClient.sentInquiryId).isNull();
    }

    @Test
    void a_reply_over_the_documented_limit_is_permanent_so_the_seller_can_edit_it() {
        String tooLong = "가".repeat(CoupangChannelReplyAdapter.CONTENT_MAX_BYTES); // 3 bytes each in UTF-8

        assertThat(publish(tooLong).kind()).isEqualTo(ReplyPublishResult.Kind.PERMANENT_FAILURE);
        assertThat(replyClient.sentInquiryId).isNull();
    }

    @Test
    void no_credential_means_no_send() {
        when(vault.hasCredential(any(), any())).thenReturn(false);

        assertThat(publish("답변").kind()).isEqualTo(ReplyPublishResult.Kind.RETRYABLE_FAILURE);
        assertThat(replyClient.sentInquiryId).isNull();
    }

    /* ───────────────────────── verification ───────────────────────── */

    @Test
    void verification_is_COMPLETED_only_when_coupang_itself_lists_it_as_answered() {
        replyClient.answered = true;
        ReplyVerificationResult completed = adapter.verify(
                new ReplyVerificationCommand(org, seller, channel, EXTERNAL_ID, receivedAt));
        assertThat(completed.kind()).isEqualTo(ReplyVerificationResult.Kind.COMPLETED);
        assertThat(completed.observedSignal()).isEqualTo("ANSWERED");
        assertThat(replyClient.verifiedInquiryId).isEqualTo(BARE_ID);

        replyClient.answered = false;
        assertThat(adapter.verify(new ReplyVerificationCommand(org, seller, channel, EXTERNAL_ID, receivedAt))
                .kind()).isEqualTo(ReplyVerificationResult.Kind.NOT_COMPLETED);
    }

    @Test
    void a_verification_that_could_not_run_is_NOT_COMPLETED_rather_than_confirmed() {
        // "We could not check" must never round up to "it landed" — that closes a work item on an
        // answer no customer ever received.
        replyClient.verifyFailure = new IllegalStateException("network");

        ReplyVerificationResult result = adapter.verify(
                new ReplyVerificationCommand(org, seller, channel, EXTERNAL_ID, receivedAt));

        assertThat(result.kind()).isEqualTo(ReplyVerificationResult.Kind.NOT_COMPLETED);
        assertThat(result.observedSignal()).isEqualTo("UNVERIFIABLE");
    }

    @Test
    void an_unrecognised_external_id_is_unverifiable_rather_than_completed() {
        assertThat(adapter.verify(new ReplyVerificationCommand(org, seller, channel, "MSG-1", receivedAt))
                .kind()).isEqualTo(ReplyVerificationResult.Kind.NOT_COMPLETED);
    }
}
