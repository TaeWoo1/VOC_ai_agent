package com.sellerops.connector.coupang;

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
import com.sellerops.ingest.canonical.CanonicalOrder;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The real Coupang connector: fail-closed ordering (credential gate before any HTTP), the
 * ORDER_SUMMARY capability, the full-window multi-status ordersheets sweep with nextToken
 * paging, the rate-limit signal, and the two-part connect test (credential/environment probe
 * then a separate order-access probe) — all against the real vault over H2 and the recording
 * fake HTTP boundary. Every credential-shape failure asserts <b>zero</b> HTTP calls.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CoupangApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    // A fixed clock so the swept window and probe window are deterministic (KST 2026-08-05).
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-05T02:00:00Z"), ZoneOffset.UTC);
    // The stub points at the real gateway HOST (so URL/signature assertions are realistic), so the live-call
    // guard requires an armed approval id — this test run is "armed" with a test env-binding token. The guard's
    // own fail-closed behavior (real host, blank id) is proven in CoupangLiveCallGuardTest + the unarmed case below.
    private static final String TEST_APPROVAL_ID = "apr-test-approval";
    private final CoupangOrdersClient ordersClient =
            new CoupangOrdersClient(http, new CoupangSigner(clock), clock, "https://api-gateway.coupang.com",
                    TEST_APPROVAL_ID);
    private final String masterKey = randomKeyBase64();

    private CredentialVault vault;
    private CoupangApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = new CoupangApiConnector(ordersClient, vault);
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private void storeCoupangCredential() {
        vault.store(org, account, "API", "HMAC",
                Map.of("access_key", "AK-1", "secret_key", "SK-1", "vendor_id", "A00012345"),
                null, null, null);
    }

    private FetchRequest request(DataType dataType) {
        return new FetchRequest(org, account, "COUPANG", dataType, null, 50);
    }

    private static CoupangHttpClient.Response json(int status, String body) {
        return new CoupangHttpClient.Response(status, body, Map.of());
    }

    private static String ordersheet(String status, long shipmentBoxId, long orderId,
                                     String nextToken, long... orderPrices) {
        StringBuilder items = new StringBuilder();
        for (long price : orderPrices) {
            if (items.length() > 0) {
                items.append(',');
            }
            items.append("{\"orderPrice\":").append(price).append('}');
        }
        String data = "{\"shipmentBoxId\":" + shipmentBoxId + ",\"orderId\":" + orderId
                + ",\"status\":\"" + status + "\""
                + ",\"orderedAt\":\"2026-08-05T10:00:00+09:00\""
                + ",\"paidAt\":\"2026-08-05T10:01:00+09:00\""
                + ",\"orderItems\":[" + items + "]}";
        String token = nextToken == null ? "null" : "\"" + nextToken + "\"";
        return "{\"code\":200,\"message\":\"OK\",\"data\":[" + data + "],\"nextToken\":" + token + "}";
    }

    private static String emptyPage() {
        return "{\"code\":200,\"message\":\"OK\",\"data\":[],\"nextToken\":null}";
    }

    /** Enqueue empty pages for every status after the first (so the full sweep completes). */
    private void enqueueRemainingStatusesEmpty(int alreadyEnqueuedStatuses) {
        for (int i = alreadyEnqueuedStatuses; i < CoupangOrdersClient.STATUSES.size(); i++) {
            http.enqueue(json(200, emptyPage()));
        }
    }

    // --- fail-closed ordering (zero HTTP) ---------------------------------

    @Test
    void unsupportedDataTypesThrowWithZeroHttp() {
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThatThrownBy(() -> connector.fetch(request(dataType)))
                    .isInstanceOf(UnsupportedDataTypeException.class);
        }
        assertThatThrownBy(() -> connector.fetch(
                new FetchRequest(org, account, "NAVER", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesExposeOrderSummaryOnly() {
        var capabilities = connector.capabilities("COUPANG");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supportedDataTypes()).containsExactly(DataType.ORDER_SUMMARY);
        assertThat(capabilities.verificationStatus()).containsEntry(DataType.ORDER_SUMMARY, "CONFIRMED");
        assertThat(connector.dedicatedChannels()).containsExactly("COUPANG");
        assertThat(connector.kind()).isEqualTo("COUPANG_API");
        // Honest boundary: no Coupang review API.
        assertThat(connector.unsupportedScopes("COUPANG")).extracting("code").containsExactly("REVIEW_API");
    }

    @Test
    void missingCredentialFailsClosedWithZeroHttp() {
        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("자격 증명");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void closedVaultFailsClosedWithZeroHttp() {
        storeCoupangCredential();
        CoupangApiConnector keylessConnector = new CoupangApiConnector(ordersClient, vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutCoupangKeysFailsClosedWithZeroHttp() {
        vault.store(org, account, "API", "OAUTH2",
                Map.of("client_id", "stored-id-value", "client_secret", "stored-secret-value"),
                null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("access_key")
                .hasMessageNotContaining("stored-id-value")
                .hasMessageNotContaining("stored-secret-value");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void partialCredentialFailsClosedWithZeroHttp() {
        vault.store(org, account, "API", "HMAC",
                Map.of("access_key", "AK-1", "secret_key", "SK-1"), null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("vendor_id");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void liveCallToRealGatewayWithoutArmedApprovalFailsClosedBeforeAnyHttp() {
        storeCoupangCredential();
        // Real gateway host but NO armed approval id → the backend live-run interlock refuses the call
        // before signing or opening a socket. A valid credential is present, so this proves the guard —
        // not a credential gate — is what stops it.
        CoupangOrdersClient unarmed = new CoupangOrdersClient(
                http, new CoupangSigner(clock), clock, "https://api-gateway.coupang.com", "");
        CoupangApiConnector unarmedConnector = new CoupangApiConnector(unarmed, vault);

        assertThatThrownBy(() -> unarmedConnector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThat(http.sent).isEmpty();

        // The connect test's credential probe is guarded at the same choke point — also zero HTTP.
        assertThatThrownBy(() -> unarmedConnector.verifyConnection(new VerifyContext(org, account, "COUPANG")))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThat(http.sent).isEmpty();
    }

    // --- order collection -------------------------------------------------

    @Test
    void fetchSweepsAllStatusesAndMapsOrdersAndDailySummary() {
        storeCoupangCredential();
        // ACCEPT carries one shipment box (two items → 12000 + 3000 = 15000); the other five statuses are empty.
        http.enqueue(json(200, ordersheet("ACCEPT", 100001L, 5001L, null, 12000L, 3000L)));
        enqueueRemainingStatusesEmpty(1);

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY));

        // One GET per status (six), all signed and carrying X-Requested-By + X-MARKET.
        assertThat(http.sent).hasSize(CoupangOrdersClient.STATUSES.size());
        assertThat(http.sent).allSatisfy(sent -> {
            assertThat(sent.headers()).containsKey("Authorization");
            assertThat(sent.headers()).containsEntry("X-Requested-By", "A00012345");
            assertThat(sent.headers()).containsEntry("X-MARKET", "KR");
            String uri = sent.uri().toString();
            assertThat(uri).contains("/vendors/A00012345/ordersheets");
            // The createdAt dates carry the official KST offset (+09:00, '+' encoded as %2B) — a bare
            // date without it is the Coupang analogue of NAVER's malformed-datetime HTTP 400.
            assertThat(uri).contains("createdAtFrom=2026-07-29%2B09:00");
            assertThat(uri).contains("createdAtTo=2026-08-05%2B09:00");
            assertThat(uri).contains("maxPerPage=50");
        });

        List<CanonicalOrder> orders = page.orders().stream().map(CanonicalOrder.class::cast).toList();
        assertThat(orders).singleElement().satisfies(o -> {
            assertThat(o.externalOrderId()).isEqualTo("100001");
            assertThat(o.parentOrderId()).isEqualTo("5001");
            assertThat(o.rawStatusCode()).isEqualTo("ACCEPT");
            assertThat(o.paymentAmount()).isEqualTo(15000L);
            assertThat(o.summaryDate().toString()).isEqualTo("2026-08-05");
        });

        List<CanonicalOrderSummary> daily =
                page.records().stream().map(CanonicalOrderSummary.class::cast).toList();
        assertThat(daily).singleElement().satisfies(d -> {
            assertThat(d.summaryDate().toString()).isEqualTo("2026-08-05");
            assertThat(d.orderCount()).isEqualTo(1);
            assertThat(d.salesAmount()).isEqualTo(15000L);
        });

        // Terminal page (the whole window was swept); the scheduler re-runs it.
        assertThat(page.hasMore()).isFalse();
        assertThat(page.source()).isEqualTo("COUPANG_API");
    }

    @Test
    void fetchFollowsNextTokenWithinAStatus() {
        storeCoupangCredential();
        // ACCEPT paginates: page 1 (nextToken=TOK2) then page 2 (terminal); five empty statuses follow.
        http.enqueue(json(200, ordersheet("ACCEPT", 100001L, 5001L, "TOK2", 10000L)));
        http.enqueue(json(200, ordersheet("ACCEPT", 100002L, 5002L, null, 20000L)));
        enqueueRemainingStatusesEmpty(1);

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY));

        List<CanonicalOrder> orders = page.orders().stream().map(CanonicalOrder.class::cast).toList();
        assertThat(orders).extracting(CanonicalOrder::externalOrderId).containsExactly("100001", "100002");
        // Seven HTTP calls: ACCEPT×2 + five empty statuses; the second ACCEPT carried the nextToken.
        assertThat(http.sent).hasSize(CoupangOrdersClient.STATUSES.size() + 1);
        assertThat(http.sent.get(1).uri().toString()).contains("nextToken=TOK2");
    }

    @Test
    void rateLimitedFetchReturnsRateLimitedPageWithCursorUnchanged() {
        storeCoupangCredential();
        String priorCursor = "{\"initialized\":true,\"throughDate\":\"2026-08-04\"}";
        http.enqueue(new CoupangHttpClient.Response(429, "{\"code\":429}", Map.of("Retry-After", "30")));

        FetchPage page = connector.fetch(
                new FetchRequest(org, account, "COUPANG", DataType.ORDER_SUMMARY, priorCursor, 50));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.retryAfterSeconds()).isEqualTo(30);
        // Cursor unchanged so a retry re-requests the same window.
        assertThat(page.nextCursorValue()).isEqualTo(priorCursor);
    }

    // --- connect test: credential vs order-access separation --------------

    @Test
    void verifySucceedsWhenCredentialAndOrderAccessBothPass() {
        storeCoupangCredential();
        http.enqueue(json(200, "{\"code\":200,\"data\":[]}"));   // returnShippingCenters — credential OK
        http.enqueue(json(200, emptyPage()));                    // ordersheets probe — order access CONFIRMED

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.SUCCESS);
        assertThat(http.sent).hasSize(2);
        assertThat(http.sent.get(0).uri().toString()).contains("/returnShippingCenters");
        assertThat(http.sent.get(1).uri().toString()).contains("/ordersheets");
    }

    @Test
    void verifyWithBlankCredentialFailsInvalidWithZeroHttp() {
        // A Coupang-shaped credential missing a required field must fail the shape check as
        // INVALID_CREDENTIAL before any probe call — symmetric with fetch()'s fail-closed ordering.
        vault.store(org, account, "API", "HMAC",
                Map.of("access_key", "AK-1", "secret_key", "SK-1"), null, null, null); // no vendor_id

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void verifyReportsInvalidCredentialOn401() {
        storeCoupangCredential();
        http.enqueue(json(401, "{\"message\":\"invalid signature\"}"));

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        assertThat(http.sent).hasSize(1); // never reached the order probe
    }

    @Test
    void verifyReportsCallEnvironmentMismatchOnIpDenied403() {
        storeCoupangCredential();
        http.enqueue(json(403,
                "{\"message\":\"[FORBIDDEN] Not allowed IP. Please contact the Coupang seller call center.\"}"));

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
    }

    @Test
    void verifyHedgesOrderAccessDeniedWhenCredentialPassesButOrderProbe403IsNotIp() {
        storeCoupangCredential();
        http.enqueue(json(200, "{\"code\":200,\"data\":[]}"));    // credential OK
        http.enqueue(json(403, "{\"message\":\"forbidden\"}"));   // ordersheets 403, no IP marker → hedged

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_ORDER_ACCESS_DENIED);
    }

    @Test
    void verifyDoesNotBlockAValidCredentialOnAThrottledOrderProbe() {
        storeCoupangCredential();
        http.enqueue(json(200, "{\"code\":200,\"data\":[]}"));   // credential OK
        http.enqueue(json(429, "{\"code\":429}"));               // order probe throttled → inconclusive

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        // A throttled order probe must not block a credential the gateway just accepted.
        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.SUCCESS);
    }

    // --- diagnostic hardening: status-carrying probes + ordersheets auxiliary fallback --------

    @Test
    void credentialProbeClassifiesEachStatusAndCarriesRawHttpStatus() {
        // The credential probe is split so a 400/404 (client), a 5xx (server) and a transport failure
        // are distinguishable — each carrying the exact (safe) HTTP status for diagnosis.
        http.enqueue(json(200, "{\"code\":200,\"data\":[]}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.OK, 200));

        http.enqueue(json(401, "{\"message\":\"invalid signature\"}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.INVALID, 401));

        http.enqueue(json(429, "{\"code\":429}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.RATE_LIMITED, 429));

        http.enqueue(json(404, "{\"message\":\"not found\"}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.CLIENT_ERROR, 404));

        http.enqueue(json(400, "{\"message\":\"bad request\"}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.CLIENT_ERROR, 400));

        http.enqueue(json(503, "{\"message\":\"service unavailable\"}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.SERVER_ERROR, 503));

        // 403 with the IP marker vs a bare 403 stay authoritative (unchanged), still carrying the status.
        http.enqueue(json(403,
                "{\"message\":\"[FORBIDDEN] Not allowed IP. Please contact the Coupang seller call center.\"}"));
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.IP_DENIED, 403));

        http.enqueueTransportFailure();
        assertThat(ordersClient.credentialProbe("AK", "SK", "A00012345"))
                .isEqualTo(new CoupangOrdersClient.CredentialProbeResult(
                        CoupangOrdersClient.CredentialProbe.TRANSPORT_ERROR,
                        CoupangOrdersClient.CredentialProbeResult.NO_HTTP_STATUS));
    }

    @Test
    void verifyRescuesValidCredentialViaOrdersheetsWhenReturnCentersReturnsClientError() {
        // Reproduces the live first-connection failure: returnShippingCenters answered with a
        // non-401/403 4xx (here 404) → PROVIDER_UNAVAILABLE under the old collapse-everything logic.
        // The credential is actually valid, so the ordersheets auxiliary probe (200) now confirms it.
        storeCoupangCredential();
        http.enqueue(json(404, "{\"message\":\"not found\"}")); // returnShippingCenters — unsuitable
        http.enqueue(json(200, emptyPage()));                   // ordersheets — order access CONFIRMED

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.SUCCESS);
        assertThat(http.sent).hasSize(2);
        assertThat(http.sent.get(0).uri().toString()).contains("/returnShippingCenters");
        assertThat(http.sent.get(1).uri().toString()).contains("/ordersheets");
    }

    @Test
    void verifyRescuesValidCredentialViaOrdersheetsWhenReturnCentersReturnsServerError() {
        storeCoupangCredential();
        http.enqueue(json(503, "{\"message\":\"unavailable\"}")); // returnShippingCenters 5xx
        http.enqueue(json(200, emptyPage()));                     // ordersheets 200 → confirmed

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.SUCCESS);
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void verifyStaysProviderUnavailableWhenReturnCentersAndOrdersheetsAreBothInconclusive() {
        // The auxiliary probe must NOT fabricate success from an inconclusive order probe (the
        // credential was never proven). returnShippingCenters 404 + ordersheets 500 → PROVIDER_UNAVAILABLE.
        storeCoupangCredential();
        http.enqueue(json(404, "{\"message\":\"not found\"}"));
        http.enqueue(json(500, "{\"message\":\"server error\"}"));

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void verifySurfacesOrderAccessDeniedViaAuxiliaryProbeWhenReturnCentersClientErrors() {
        // returnShippingCenters unsuitable (404); ordersheets 403 without the IP marker → the signature
        // was accepted (credential valid) but the order scope is denied → hedged ORDER_ACCESS_DENIED.
        storeCoupangCredential();
        http.enqueue(json(404, "{\"message\":\"not found\"}"));
        http.enqueue(json(403, "{\"message\":\"forbidden\"}"));

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_ORDER_ACCESS_DENIED);
    }

    @Test
    void verifyReportsProviderUnavailableOnCredentialTransportFailureWithoutAuxiliaryProbe() {
        // A transport failure is systemic — the connector must NOT issue a second doomed call
        // (exactly one HTTP attempt) and reports the honest PROVIDER_UNAVAILABLE.
        storeCoupangCredential();
        http.enqueueTransportFailure();

        VerifyOutcome outcome = connector.verifyConnection(new VerifyContext(org, account, "COUPANG"));

        assertThat(outcome.status()).isEqualTo(VerifyOutcome.Status.FAILED);
        assertThat(outcome.reasonCode()).isEqualTo(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
        assertThat(http.sent).hasSize(1);
    }
}
