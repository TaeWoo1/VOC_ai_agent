package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.test.context.ActiveProfiles;

/**
 * Slice 1a: the connector's fail-closed ordering (credential gate before any
 * HTTP), unsupported-type behavior, rate-limit mapping, and the deliberate
 * schema-pending stop after a proven token mint — all against the real vault
 * over H2 and the fake HTTP boundary.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class NaverApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final String clientSecret = BCrypt.gensalt();
    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final Clock clock = Clock.fixed(Instant.parse("2026-06-12T00:00:00Z"), ZoneOffset.UTC);
    private final String masterKey = randomKeyBase64();

    private CredentialVault vault;
    private NaverApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = connectorWith(vault);
    }

    private NaverApiConnector connectorWith(CredentialVault vault) {
        return new NaverApiConnector(
                new NaverTokenClient(http, clock, "https://fake.naver.test"),
                new NaverOrdersClient(http, clock, "https://fake.naver.test", 100),
                vault);
    }

    /**
     * A connector whose single HTTP boundary is wrapped in the pacing decorator,
     * sharing one pacer across token + order calls. The recording sleeper never
     * really blocks; its {@code waits} prove pacing happened.
     */
    private NaverApiConnector pacedConnectorWith(CredentialVault vault, RecordingSleeper sleeper,
                                                 MutableTestClock pacerClock) {
        NaverHttpClient paced = new PacingNaverHttpClient(
                http, new NaverRequestPacer(pacerClock, sleeper,
                        java.time.Duration.ofSeconds(1), java.time.Duration.ofSeconds(1)));
        return new NaverApiConnector(
                new NaverTokenClient(paced, clock, "https://fake.naver.test"),
                new NaverOrdersClient(paced, clock, "https://fake.naver.test", 100),
                vault);
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32]; // CredentialVault.MASTER_KEY_LENGTH (not public)
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private void storeNaverCredential() {
        vault.store(org, account, "API", "OAUTH2",
                Map.of("client_id", "test-client-id", "client_secret", clientSecret), null, null, null);
    }

    private FetchRequest request(DataType dataType, String cursor) {
        return new FetchRequest(org, account, "NAVER", dataType, cursor, 50);
    }

    private VerifyContext verifyContext() {
        return new VerifyContext(org, account, "NAVER");
    }

    // --- test-connection: auth-only verifyConnection (no orders, no collection) ---

    @Test
    void verifyConnectionSucceedsWhenTokenMintSucceeds() {
        storeNaverCredential();
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));

        VerifyOutcome outcome = connector.verifyConnection(verifyContext());

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.SUCCESS);
        assertThat(outcome.reasonCode()).isNull();
        // Auth-only: a single token mint, no order calls.
        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).method()).isEqualTo("POST_FORM");
    }

    @Test
    void verifyConnectionInvalidCredentialOn401() {
        storeNaverCredential();
        http.enqueue(new NaverHttpClient.Response(401, "{\"code\":\"UNAUTHORIZED\"}", Map.of()));

        VerifyOutcome outcome = connector.verifyConnection(verifyContext());

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_INVALID_CREDENTIAL);
    }

    @Test
    void verifyConnectionTemporaryOn429() {
        storeNaverCredential();
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        VerifyOutcome outcome = connector.verifyConnection(verifyContext());

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_TEMPORARY_PROVIDER_ERROR);
    }

    @Test
    void verifyConnectionUnavailableOnNetworkError() {
        storeNaverCredential();
        http.enqueueNetworkFailure();

        VerifyOutcome outcome = connector.verifyConnection(verifyContext());

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
    }

    @Test
    void verifyConnectionMissingClientKeysIsInvalidWithZeroHttp() {
        // A credential row exists but lacks the Naver keys → fail closed, no HTTP.
        vault.store(org, account, "API", "OAUTH2",
                Map.of("accessKey", "AK-1", "secretKey", "SK-1"), null, null, null);

        VerifyOutcome outcome = connector.verifyConnection(verifyContext());

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void unsupportedDataTypesThrowWithZeroHttp() {
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThatThrownBy(() -> connector.fetch(request(dataType, null)))
                    .isInstanceOf(UnsupportedDataTypeException.class);
        }
        // A request mis-routed to another channel is refused, ORDER_SUMMARY or not.
        assertThatThrownBy(() -> connector.fetch(
                new FetchRequest(org, account, "COUPANG", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesAdvertiseOrderSummaryOnly() {
        var capabilities = connector.capabilities("NAVER");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supports(DataType.ORDER_SUMMARY)).isTrue();
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThat(capabilities.supports(dataType))
                    .as("%s must stay unsupported in Slice 1b", dataType)
                    .isFalse();
        }
        assertThat(connector.dedicatedChannels()).containsExactly("NAVER");
    }

    @Test
    void missingCredentialFailsClosedWithZeroHttp() {
        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("자격 증명");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void closedVaultFailsClosedWithZeroHttp() {
        storeNaverCredential();
        NaverApiConnector keylessConnector = connectorWith(vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutNaverKeysFailsClosedWithZeroHttp() {
        vault.store(org, account, "API", "OAUTH2",
                Map.of("accessKey", "AK-1", "secretKey", "SK-1"), null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("client_id");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void rateLimitedTokenMintMapsToRateLimitedPageWithCursorUnchanged() {
        storeNaverCredential();
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, "cursor-42"));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.records()).isEmpty();
        // No official Retry-After header → the conservative fallback hint.
        assertThat(page.retryAfterSeconds()).isEqualTo(NaverApiConnector.FALLBACK_RETRY_AFTER_SECONDS);
        assertThat(page.nextCursorValue()).isEqualTo("cursor-42");
        assertThat(page.source()).isEqualTo(NaverApiConnector.KIND);
    }

    @Test
    void fetchRunsCredentialTokenAndTwoCallFlowEndToEnd() {
        storeNaverCredential();
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"data\":{\"lastChangeStatuses\":[{\"productOrderId\":\"PO1\",\"orderId\":\"O1\","
                        + "\"productOrderStatus\":\"PAYED\",\"lastChangedType\":\"PAYED\","
                        + "\"lastChangedDate\":\"2026-06-11T22:00:00+09:00\","
                        + "\"paymentDate\":\"2026-06-11T22:00:00+09:00\"}]}}"));
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"data\":[{\"productOrder\":{\"productOrderId\":\"PO1\",\"initialPaymentAmount\":12000}}]}"));

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, null));

        // credential → signature → token → last-changed → detail, in order.
        assertThat(http.sent).hasSize(3);
        assertThat(http.sent.get(0).form()).containsKey("client_secret_sign");
        assertThat(http.sent.get(1).method()).isEqualTo("GET");
        assertThat(http.sent.get(2).method()).isEqualTo("POST_JSON");
        assertThat(page.records()).hasSize(1);
        CanonicalOrderSummary summary = (CanonicalOrderSummary) page.records().get(0);
        assertThat(summary.summaryDate()).isEqualTo(LocalDate.parse("2026-06-11"));
        assertThat(summary.orderCount()).isEqualTo(1);
        assertThat(summary.salesAmount()).isEqualTo(12000L);
        assertThat(page.source()).isEqualTo(NaverApiConnector.KIND);
        assertThat(page.nextCursorValue()).contains("windowFrom");
    }

    @Test
    void rateLimitedOrdersCallMapsToRateLimitedPageWithCursorUnchanged() {
        storeNaverCredential();
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.rateLimited429()); // the last-changed call

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, null));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.records()).isEmpty();
        // Cursor unchanged: the initial (null) cursor stays null for the retry.
        assertThat(page.nextCursorValue()).isNull();
        assertThat(page.retryAfterSeconds()).isEqualTo(NaverApiConnector.FALLBACK_RETRY_AFTER_SECONDS);
    }

    @Test
    void pacedTwoCallFlowSpacesEveryRequestWithoutChangingResults() {
        storeNaverCredential();
        MutableTestClock pacerClock = new MutableTestClock(Instant.parse("2026-06-12T00:00:00Z"));
        RecordingSleeper sleeper = new RecordingSleeper(pacerClock);
        NaverApiConnector paced = pacedConnectorWith(vault, sleeper, pacerClock);
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"data\":{\"lastChangeStatuses\":[{\"productOrderId\":\"PO1\",\"orderId\":\"O1\","
                        + "\"productOrderStatus\":\"PAYED\",\"lastChangedType\":\"PAYED\","
                        + "\"lastChangedDate\":\"2026-06-11T22:00:00+09:00\","
                        + "\"paymentDate\":\"2026-06-11T22:00:00+09:00\"}]}}"));
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"data\":[{\"productOrder\":{\"productOrderId\":\"PO1\",\"initialPaymentAmount\":12000}}]}"));

        FetchPage page = paced.fetch(request(DataType.ORDER_SUMMARY, null));

        // token mint + last-changed + detail = 3 calls → first free, next two paced.
        assertThat(http.sent).hasSize(3);
        assertThat(sleeper.waits).containsExactly(java.time.Duration.ofSeconds(1), java.time.Duration.ofSeconds(1));
        // Pacing changes timing only — the page is identical to the unpaced flow.
        assertThat(page.records()).hasSize(1);
        assertThat(((CanonicalOrderSummary) page.records().get(0)).salesAmount()).isEqualTo(12000L);
    }

    @Test
    void pacedRateLimitedOrdersCallStillMapsToRateLimitedPageWithCursorUnchanged() {
        storeNaverCredential();
        MutableTestClock pacerClock = new MutableTestClock(Instant.parse("2026-06-12T00:00:00Z"));
        RecordingSleeper sleeper = new RecordingSleeper(pacerClock);
        NaverApiConnector paced = pacedConnectorWith(vault, sleeper, pacerClock);
        // Valid resume cursor so token mint succeeds and the 429 lands on the
        // order call (cursor parses before the last-changed request fires).
        String resumeCursor = "{\"windowFrom\":\"2026-06-10T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.rateLimited429()); // the last-changed call

        FetchPage page = paced.fetch(request(DataType.ORDER_SUMMARY, resumeCursor));

        // The pacing layer spaced the order call after the token mint...
        assertThat(sleeper.waits).containsExactly(java.time.Duration.ofSeconds(1));
        // ...but the 429 contract is unchanged: rate-limited page, cursor preserved.
        assertThat(page.rateLimited()).isTrue();
        assertThat(page.records()).isEmpty();
        assertThat(page.nextCursorValue()).isEqualTo(resumeCursor);
        assertThat(page.retryAfterSeconds()).isEqualTo(NaverApiConnector.FALLBACK_RETRY_AFTER_SECONDS);
    }

    @Test
    void quotaLimited429MapsToRateLimitedPageWithLongerRetryHintAndCursorUnchanged() {
        storeNaverCredential();
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.quotaLimited429()); // the last-changed call

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, null));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.records()).isEmpty();
        // A quota breach is per-period, so the hint is the longer quota fallback,
        // not the one-second rate fallback — cursor still preserved.
        assertThat(page.retryAfterSeconds()).isEqualTo(NaverApiConnector.QUOTA_FALLBACK_RETRY_AFTER_SECONDS);
        assertThat(page.nextCursorValue()).isNull();
    }

    @Test
    void rateLimitedMidStreamEchoesTheResumeCursorByteForByte() {
        storeNaverCredential();
        String resumeCursor = "{\"windowFrom\":\"2026-06-10T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, resumeCursor));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.nextCursorValue()).isEqualTo(resumeCursor);
    }
}
