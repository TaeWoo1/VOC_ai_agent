package com.sellerops.connector.elevenst;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.credential.ConnectorCredentialRepository;
import com.sellerops.credential.CredentialVault;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Phase 3D-5: the skeleton's fail-closed ordering (credential gate, zero HTTP
 * everywhere — 11st auth is a static header, so the skeleton performs no HTTP
 * at all), empty capability set, unsupported-type behavior, the official
 * {@code openapikey} header assembly, and the deliberate schema-pending stop —
 * all against the real vault over H2 and the throwing fake HTTP boundary.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ElevenstApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final FakeElevenstHttpClient http = new FakeElevenstHttpClient();
    private final String masterKey = randomKeyBase64();

    private CredentialVault vault;
    private ElevenstApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = new ElevenstApiConnector(http, vault);
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private void storeElevenstCredential() {
        vault.store(org, account, "API", "API_KEY",
                Map.of("openapikey", "ELEVENST_TEST_KEY"),
                null, null, null);
    }

    private FetchRequest request(DataType dataType) {
        return new FetchRequest(org, account, "ELEVENST", dataType, null, 50);
    }

    @Test
    void unsupportedDataTypesThrowWithZeroHttp() {
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThatThrownBy(() -> connector.fetch(request(dataType)))
                    .isInstanceOf(UnsupportedDataTypeException.class);
        }
        // A request mis-routed to another channel is refused, ORDER_SUMMARY or
        // not — including SSG, which has no dedicated connector at all.
        assertThatThrownBy(() -> connector.fetch(
                new FetchRequest(org, account, "SSG", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesExposeNoCollectableDataType() {
        var capabilities = connector.capabilities("ELEVENST");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supportedDataTypes()).isEmpty();
        for (DataType dataType : DataType.values()) {
            assertThat(capabilities.supports(dataType))
                    .as("%s must stay uncollectable in the 3D-5 skeleton", dataType)
                    .isFalse();
        }
        assertThat(connector.dedicatedChannels()).containsExactly("ELEVENST");
        assertThat(connector.kind()).isEqualTo("ELEVENST_API");
    }

    @Test
    void authHeadersUseTheOfficialHeaderNameVerbatim() {
        // Official operation guide: "'openapikey:발급key값' 형태로 전송" — the
        // header name is literally lowercase openapikey, value is the raw key.
        Map<String, String> headers = ElevenstApiConnector.authHeaders("issued-key-value");
        assertThat(headers).containsExactlyEntriesOf(Map.of("openapikey", "issued-key-value"));
    }

    @Test
    void blankKeyFailsHeaderAssemblyWithoutEcho() {
        for (String blank : new String[] {null, "", "   "}) {
            assertThatThrownBy(() -> ElevenstApiConnector.authHeaders(blank))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("openapikey");
        }
        assertThat(http.sent).isEmpty();
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
        storeElevenstCredential();
        ElevenstApiConnector keylessConnector = new ElevenstApiConnector(http, vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutOpenapikeyFailsClosedWithZeroHttp() {
        // A Naver-shaped credential on an ELEVENST account must fail the shape
        // check, naming the missing key but never any stored value.
        vault.store(org, account, "API", "OAUTH2",
                Map.of("client_id", "stored-id-value", "client_secret", "stored-secret-value"),
                null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("openapikey")
                .hasMessageNotContaining("stored-id-value")
                .hasMessageNotContaining("stored-secret-value");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void blankStoredKeyFailsClosedWithZeroHttp() {
        // Present-but-blank is as unusable as absent — same fail-closed path.
        vault.store(org, account, "API", "API_KEY",
                Map.of("openapikey", "   "), null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("openapikey");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void validCredentialStopsSchemaPendingWithZeroHttp() {
        // The credential chain is proven (vault open + shape pass), then the
        // skeleton stops deliberately — no order schema is implemented yet
        // (per-endpoint specs are seller-login-walled).
        storeElevenstCredential();

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("구현되지 않았습니다")
                .hasMessageNotContaining("ELEVENST_TEST_KEY");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void fakeMasksTheKeyHeaderCaseInsensitivelyInTestOutput() {
        // The fake's failed-assertion rendering must mask the key regardless of
        // header-name casing — a future slice could assemble it differently.
        var sent = new FakeElevenstHttpClient.Sent("GET",
                java.net.URI.create("https://example.invalid/check"),
                Map.of("OPENAPIKEY", "ELEVENST_TEST_KEY"));

        assertThat(sent.toString())
                .contains("<masked>")
                .doesNotContain("ELEVENST_TEST_KEY");
    }
}
