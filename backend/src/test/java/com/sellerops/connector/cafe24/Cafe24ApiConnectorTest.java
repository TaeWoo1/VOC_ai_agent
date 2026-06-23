package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
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
 * Phase 3D-3: the skeleton's fail-closed ordering (credential gate before any
 * HTTP), empty capability set, unsupported-type behavior, the refresh-token
 * chain proof, and — the load-bearing part — single-use rotation write-back:
 * a rotated refresh token is persisted immediately, a failed refresh never
 * writes back. All against the real vault over H2 and the recording fake.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24ApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final String masterKey = randomKeyBase64();

    // Fixed clock: 2026-06-23T01:00Z = 2026-06-23 10:00 KST → window end 2026-06-23,
    // start 2026-06-09 (end − LOOKBACK_DAYS).
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-23T01:00:00Z"), ZoneOffset.UTC);
    private static final LocalDate WINDOW_END = LocalDate.parse("2026-06-23");
    private static final LocalDate WINDOW_START = LocalDate.parse("2026-06-09");

    private CredentialVault vault;
    private Cafe24ApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = connectorWith(vault);
    }

    private Cafe24ApiConnector connectorWith(CredentialVault v) {
        return new Cafe24ApiConnector(new Cafe24TokenClient(http), v, new Cafe24OrdersClient(http), CLOCK);
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private void storeCafe24Credential() {
        vault.store(org, account, "API", "OAUTH2",
                Map.of("mall_id", "samplemall",
                        "client_id", "test-client-id",
                        "client_secret", "test-client-secret",
                        "refresh_token", "old-refresh-token"),
                null, null, null);
    }

    private FetchRequest request(DataType dataType, String cursor) {
        return new FetchRequest(org, account, "CAFE24", dataType, cursor, 50);
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
                new FetchRequest(org, account, "NAVER", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesExposeOrderSummaryAsNeedsVerification() {
        var capabilities = connector.capabilities("CAFE24");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supports(DataType.ORDER_SUMMARY)).isTrue();
        assertThat(capabilities.verificationStatus())
                .containsEntry(DataType.ORDER_SUMMARY, "NEEDS_VERIFICATION");
        // Only ORDER_SUMMARY is collectable; the rest stay deferred.
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThat(capabilities.supports(dataType))
                    .as("%s stays deferred", dataType)
                    .isFalse();
        }
        assertThat(connector.dedicatedChannels()).containsExactly("CAFE24");
        assertThat(connector.kind()).isEqualTo("CAFE24_API");
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
        storeCafe24Credential();
        Cafe24ApiConnector keylessConnector = connectorWith(vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutCafe24KeysFailsClosedWithZeroHttp() {
        // A Coupang-shaped credential on a CAFE24 account must fail the shape
        // check, naming the missing keys but never any stored value.
        vault.store(org, account, "API", "HMAC",
                Map.of("access_key", "stored-access-value", "secret_key", "stored-secret-value"),
                null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mall_id")
                .hasMessageNotContaining("stored-access-value")
                .hasMessageNotContaining("stored-secret-value");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void refreshTokenOnlyInTheDedicatedSlotFailsClosedWithZeroHttp() {
        // Storage invariant: the secrets map is the single authoritative
        // location. A credential whose token lives only in the vault's
        // separate refresh-token slot must fail the shape check closed with a
        // message naming the missing key — not silently read the other slot.
        vault.store(org, account, "API", "OAUTH2",
                Map.of("mall_id", "samplemall",
                        "client_id", "test-client-id",
                        "client_secret", "test-client-secret"),
                "slot-refresh-token", null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("refresh_token")
                .hasMessageNotContaining("slot-refresh-token");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void rotationNeverTouchesTheDedicatedRefreshTokenSlot() {
        // A credential stored with BOTH locations populated: the connector
        // refreshes from the secrets map and rotation rewrites only the
        // secrets payload — the separate slot keeps its original value.
        vault.store(org, account, "API", "OAUTH2",
                Map.of("mall_id", "samplemall",
                        "client_id", "test-client-id",
                        "client_secret", "test-client-secret",
                        "refresh_token", "old-refresh-token"),
                "slot-refresh-token", null, null);
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-new", "rotated-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.ordersOk());

        connector.fetch(request(DataType.ORDER_SUMMARY, null));

        // The grant used the secrets-map token, not the slot value.
        assertThat(http.sent.get(0).form().get("refresh_token")).isEqualTo("old-refresh-token");
        var reopened = vault.open(org, account);
        assertThat(reopened.secrets().get("refresh_token")).isEqualTo("rotated-refresh-token");
        assertThat(reopened.refreshToken()).isEqualTo("slot-refresh-token");
    }

    @Test
    void rotatedRefreshTokenIsWrittenBackEncrypted() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-new", "rotated-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.ordersOk());

        // Rotation write-back happens before the orders call — the single-use old
        // token is already dead server-side once the provider answered.
        connector.fetch(request(DataType.ORDER_SUMMARY, null));

        var reopened = vault.open(org, account);
        assertThat(reopened.secrets().get("refresh_token")).isEqualTo("rotated-refresh-token");
        // Only the payload rotated: class/type and the other keys are intact.
        assertThat(reopened.connectorClass()).isEqualTo("API");
        assertThat(reopened.authType()).isEqualTo("OAUTH2");
        assertThat(reopened.secrets().get("mall_id")).isEqualTo("samplemall");
        assertThat(reopened.secrets().get("client_id")).isEqualTo("test-client-id");
        assertThat(reopened.secrets().get("client_secret")).isEqualTo("test-client-secret");
        assertThat(vault.readMasked(org, account).lastRotatedAt()).isNotNull();
    }

    @Test
    void unrotatedRefreshTokenDoesNotWriteBack() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-new", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.ordersOk());

        connector.fetch(request(DataType.ORDER_SUMMARY, null));

        assertThat(vault.open(org, account).secrets().get("refresh_token"))
                .isEqualTo("old-refresh-token");
        // No rotation happened, so the rotation stamp must stay empty.
        assertThat(vault.readMasked(org, account).lastRotatedAt()).isNull();
    }

    @Test
    void failedRefreshNeverOverwritesTheStoredCredential() {
        storeCafe24Credential();
        http.enqueue(new Cafe24HttpClient.Response(401, "{\"error\":\"invalid_grant\"}", Map.of()));

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY, null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 401");

        // The old token survives a failed refresh — nothing was written back.
        assertThat(vault.open(org, account).secrets().get("refresh_token"))
                .isEqualTo("old-refresh-token");
        assertThat(vault.readMasked(org, account).lastRotatedAt()).isNull();
    }

    @Test
    void rateLimitedRefreshMapsToRateLimitedPageWithCursorUnchanged() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.rateLimited429("7"));

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, "cursor-42"));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.records()).isEmpty();
        assertThat(page.retryAfterSeconds()).isEqualTo(7);
        assertThat(page.nextCursorValue()).isEqualTo("cursor-42");
        assertThat(page.source()).isEqualTo(Cafe24ApiConnector.KIND);
        // A throttled refresh is not a rotation — the credential is untouched.
        assertThat(vault.open(org, account).secrets().get("refresh_token"))
                .isEqualTo("old-refresh-token");
    }

    @Test
    void rateLimitedRefreshWithoutHintUsesTheFallback() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.rateLimited429(null));

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, null));

        assertThat(page.rateLimited()).isTrue();
        assertThat(page.retryAfterSeconds())
                .isEqualTo(Cafe24ApiConnector.FALLBACK_RETRY_AFTER_SECONDS);
    }

    @Test
    void orderSummaryAggregatesTheTrailingWindowIntoOnePage() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.ordersOk(
                FakeCafe24HttpClient.order("o1", "2026-06-20T10:00:00+09:00", "1000"),
                FakeCafe24HttpClient.order("o2", "2026-06-20T23:00:00+09:00", "2000"),
                FakeCafe24HttpClient.order("o3", "2026-06-21T09:00:00+09:00", "500")));

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, null));

        // One page, each date once, no continuation.
        assertThat(page.dataType()).isEqualTo(DataType.ORDER_SUMMARY);
        assertThat(page.rateLimited()).isFalse();
        assertThat(page.hasMore()).isFalse();
        assertThat(page.source()).isEqualTo(Cafe24ApiConnector.KIND);
        assertThat(page.nextCursorValue()).isEqualTo(WINDOW_END.toString());

        List<CanonicalOrderSummary> rows = summaries(page);
        assertThat(rows).extracting(CanonicalOrderSummary::summaryDate)
                .containsExactly(LocalDate.parse("2026-06-20"), LocalDate.parse("2026-06-21"));
        assertThat(rows.get(0).orderCount()).isEqualTo(2);
        assertThat(rows.get(0).salesAmount()).isEqualTo(3000L);
        assertThat(rows.get(1).orderCount()).isEqualTo(1);
        assertThat(rows.get(1).salesAmount()).isEqualTo(500L);

        // The orders GET carried the KST window, date_type, paging, and Bearer token.
        FakeCafe24HttpClient.Sent ordersGet = http.sent.get(1);
        assertThat(ordersGet.method()).isEqualTo("GET");
        assertThat(ordersGet.uri().toString())
                .contains("start_date=" + WINDOW_START)
                .contains("end_date=" + WINDOW_END)
                .contains("date_type=order_date")
                .contains("limit=1000")
                .contains("offset=0");
        assertThat(ordersGet.headers().get("Authorization")).isEqualTo("Bearer access-1");
    }

    @Test
    void orderSummaryPagesUntilAShortPage() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.tokenOk("access-1", "old-refresh-token"));
        // A full page (== limit) forces a second request; the short page stops paging.
        String[] fullPage = new String[Cafe24ApiConnector.ORDER_PAGE_LIMIT];
        for (int i = 0; i < fullPage.length; i++) {
            fullPage[i] = FakeCafe24HttpClient.order("p" + i, "2026-06-20T10:00:00+09:00", "1000");
        }
        http.enqueue(FakeCafe24HttpClient.ordersOk(fullPage));
        http.enqueue(FakeCafe24HttpClient.ordersOk(
                FakeCafe24HttpClient.order("p1000", "2026-06-20T11:00:00+09:00", "1000"),
                FakeCafe24HttpClient.order("p1001", "2026-06-20T12:00:00+09:00", "1000")));

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, null));

        List<CanonicalOrderSummary> rows = summaries(page);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).orderCount()).isEqualTo(1002);
        assertThat(rows.get(0).salesAmount()).isEqualTo(1_002_000L);
        // Two orders GETs at advancing offsets (plus the token POST).
        assertThat(http.sent).hasSize(3);
        assertThat(http.sent.get(1).uri().toString()).contains("offset=0");
        assertThat(http.sent.get(2).uri().toString()).contains("offset=1000");
    }

    @Test
    void rateLimitedOrdersDiscardsPartialKeepsCursorButRotationPersisted() {
        storeCafe24Credential();
        http.enqueue(FakeCafe24HttpClient.tokenOk("at-new", "rotated-refresh-token"));
        http.enqueue(FakeCafe24HttpClient.rateLimited429("9"));

        FetchPage page = connector.fetch(request(DataType.ORDER_SUMMARY, "cursor-x"));

        // Partial window discarded, cursor unchanged → next run re-collects cleanly.
        assertThat(page.rateLimited()).isTrue();
        assertThat(page.records()).isEmpty();
        assertThat(page.retryAfterSeconds()).isEqualTo(9);
        assertThat(page.nextCursorValue()).isEqualTo("cursor-x");
        assertThat(page.source()).isEqualTo(Cafe24ApiConnector.KIND);
        // Rotation already fired before the orders call, so it must be persisted.
        assertThat(vault.open(org, account).secrets().get("refresh_token"))
                .isEqualTo("rotated-refresh-token");
        assertThat(vault.readMasked(org, account).lastRotatedAt()).isNotNull();
    }

    @SuppressWarnings("unchecked")
    private static List<CanonicalOrderSummary> summaries(FetchPage page) {
        return (List<CanonicalOrderSummary>) page.records();
    }
}
