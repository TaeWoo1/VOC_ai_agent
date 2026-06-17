package com.sellerops.connector.ssg;

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
 * Phase 3D-6: the skeleton's fail-closed ordering (credential gate, zero HTTP
 * everywhere — SSG auth is a static header, so the skeleton performs no HTTP
 * at all), empty capability set, unsupported-type behavior, the official
 * raw-value {@code Authorization} header assembly, and the deliberate
 * schema-pending stop — all against the real vault over H2 and the throwing
 * fake HTTP boundary.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SsgApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final FakeSsgHttpClient http = new FakeSsgHttpClient();
    private final String masterKey = randomKeyBase64();

    private CredentialVault vault;
    private SsgApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = new SsgApiConnector(http, vault);
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private void storeSsgCredential() {
        vault.store(org, account, "API", "API_KEY",
                Map.of("auth_key", "SSG_TEST_KEY"),
                null, null, null);
    }

    private FetchRequest request(DataType dataType) {
        return new FetchRequest(org, account, "SSG", dataType, null, 50);
    }

    @Test
    void unsupportedDataTypesThrowWithZeroHttp() {
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThatThrownBy(() -> connector.fetch(request(dataType)))
                    .isInstanceOf(UnsupportedDataTypeException.class);
        }
        // A request mis-routed to another channel is refused, ORDER_SUMMARY or
        // not — including OHOUSE, which has no dedicated connector at all.
        assertThatThrownBy(() -> connector.fetch(
                new FetchRequest(org, account, "OHOUSE", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesExposeNoCollectableDataType() {
        var capabilities = connector.capabilities("SSG");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supportedDataTypes()).isEmpty();
        for (DataType dataType : DataType.values()) {
            assertThat(capabilities.supports(dataType))
                    .as("%s must stay uncollectable in the 3D-6 skeleton", dataType)
                    .isFalse();
        }
        assertThat(connector.dedicatedChannels()).containsExactly("SSG");
        assertThat(connector.kind()).isEqualTo("SSG_API");
    }

    @Test
    void authHeadersUseTheOfficialRawValueFormat() {
        // Official spec: every endpoint's request-header table carries exactly
        // `Authorization | 업체 인증키` — the raw key as the value, no
        // Bearer/Basic prefix.
        Map<String, String> headers = SsgApiConnector.authHeaders("issued-key-value");
        assertThat(headers).containsExactlyEntriesOf(Map.of("Authorization", "issued-key-value"));
    }

    @Test
    void blankKeyFailsHeaderAssemblyWithoutEcho() {
        for (String blank : new String[] {null, "", "   "}) {
            assertThatThrownBy(() -> SsgApiConnector.authHeaders(blank))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("인증키");
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
        storeSsgCredential();
        SsgApiConnector keylessConnector = new SsgApiConnector(http, vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutAuthKeyFailsClosedWithZeroHttp() {
        // An 11st-shaped credential on an SSG account must fail the shape
        // check, naming the missing key but never any stored value.
        vault.store(org, account, "API", "API_KEY",
                Map.of("openapikey", "stored-other-channel-value"),
                null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("auth_key")
                .hasMessageNotContaining("stored-other-channel-value");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void blankStoredKeyFailsClosedWithZeroHttp() {
        // Present-but-blank is as unusable as absent — same fail-closed path.
        vault.store(org, account, "API", "API_KEY",
                Map.of("auth_key", "   "), null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("auth_key");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void validCredentialStopsSchemaPendingWithZeroHttp() {
        // The credential chain is proven (vault open + shape pass), then the
        // skeleton stops deliberately — no order schema is implemented yet.
        storeSsgCredential();

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("구현되지 않았습니다")
                .hasMessageNotContaining("SSG_TEST_KEY");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void fakeMasksTheAuthHeaderCaseInsensitivelyInTestOutput() {
        // The fake's failed-assertion rendering must mask the key regardless of
        // header-name casing — a future slice could assemble it differently.
        var sent = new FakeSsgHttpClient.Sent("GET",
                java.net.URI.create("https://example.invalid/check"),
                Map.of("AUTHORIZATION", "SSG_TEST_KEY"));

        assertThat(sent.toString())
                .contains("<masked>")
                .doesNotContain("SSG_TEST_KEY");
    }
}
