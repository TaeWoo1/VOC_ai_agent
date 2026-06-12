package com.sellerops.connector.coupang;

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
 * Phase 3D-2: the skeleton's fail-closed ordering (credential gate before any
 * HTTP), empty capability set, unsupported-type behavior, and the deliberate
 * schema-pending stop — all against the real vault over H2 and the throwing
 * fake HTTP boundary (zero enqueued responses ⇒ any HTTP call fails the test).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CoupangApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    private final String masterKey = randomKeyBase64();

    private CredentialVault vault;
    private CoupangApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = new CoupangApiConnector(http, vault);
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

    @Test
    void unsupportedDataTypesThrowWithZeroHttp() {
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThatThrownBy(() -> connector.fetch(request(dataType)))
                    .isInstanceOf(UnsupportedDataTypeException.class);
        }
        // A request mis-routed to another channel is refused, ORDER_SUMMARY or not.
        assertThatThrownBy(() -> connector.fetch(
                new FetchRequest(org, account, "NAVER", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesExposeNoCollectableDataType() {
        var capabilities = connector.capabilities("COUPANG");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supportedDataTypes()).isEmpty();
        for (DataType dataType : DataType.values()) {
            assertThat(capabilities.supports(dataType))
                    .as("%s must stay uncollectable in the 3D-2 skeleton", dataType)
                    .isFalse();
        }
        assertThat(connector.dedicatedChannels()).containsExactly("COUPANG");
        assertThat(connector.kind()).isEqualTo("COUPANG_API");
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
        CoupangApiConnector keylessConnector = new CoupangApiConnector(http, vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutCoupangKeysFailsClosedWithZeroHttp() {
        // A Naver-shaped credential on a COUPANG account must fail the shape
        // check, naming the missing keys but never any stored value.
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
    void validCredentialStopsSchemaPendingWithZeroHttp() {
        // The credential chain is proven (vault open + shape pass), then the
        // skeleton stops deliberately — no order schema is implemented yet.
        storeCoupangCredential();

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("구현되지 않았습니다")
                .hasMessageNotContaining("AK-1")
                .hasMessageNotContaining("SK-1");
        assertThat(http.sent).isEmpty();
    }
}
