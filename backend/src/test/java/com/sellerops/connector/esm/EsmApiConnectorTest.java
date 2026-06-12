package com.sellerops.connector.esm;

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
 * Phase 3D-4: the skeleton's fail-closed ordering (credential gate, zero HTTP
 * everywhere — ESM auth is a self-signed JWT, so the skeleton performs no
 * HTTP at all), empty capability set, unsupported-type behavior, and the
 * deliberate schema-pending stop — all against the real vault over H2 and the
 * throwing fake HTTP boundary.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class EsmApiConnectorTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final FakeEsmHttpClient http = new FakeEsmHttpClient();
    private final String masterKey = randomKeyBase64();

    private CredentialVault vault;
    private EsmApiConnector connector;

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(masterKey);
        connector = new EsmApiConnector(http, vault);
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private void storeEsmCredential() {
        vault.store(org, account, "API", "JWT_HS256",
                Map.of("master_id", "test-master-id",
                        "secret_key", "test-esm-secret-key",
                        "issuer", "www.sellerops.example",
                        "gmarket_seller_id", "gmarket-1",
                        "auction_seller_id", "auction-1"),
                null, null, null);
    }

    private FetchRequest request(DataType dataType) {
        return new FetchRequest(org, account, "GMARKET", dataType, null, 50);
    }

    @Test
    void unsupportedDataTypesThrowWithZeroHttp() {
        for (DataType dataType : new DataType[] {
                DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT, DataType.SALES}) {
            assertThatThrownBy(() -> connector.fetch(request(dataType)))
                    .isInstanceOf(UnsupportedDataTypeException.class);
        }
        // A request mis-routed to another channel is refused, ORDER_SUMMARY or
        // not — including ELEVENST, which has no dedicated connector at all.
        assertThatThrownBy(() -> connector.fetch(
                new FetchRequest(org, account, "ELEVENST", DataType.ORDER_SUMMARY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void capabilitiesExposeNoCollectableDataType() {
        var capabilities = connector.capabilities("GMARKET");
        assertThat(capabilities.connectorClass()).isEqualTo("API");
        assertThat(capabilities.supportedDataTypes()).isEmpty();
        for (DataType dataType : DataType.values()) {
            assertThat(capabilities.supports(dataType))
                    .as("%s must stay uncollectable in the 3D-4 skeleton", dataType)
                    .isFalse();
        }
        // One shared ESM connector — but dedicated to GMARKET only, because the
        // channel catalog has no separate AUCTION code yet.
        assertThat(connector.dedicatedChannels()).containsExactly("GMARKET");
        assertThat(connector.kind()).isEqualTo("ESM_API");
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
        storeEsmCredential();
        EsmApiConnector keylessConnector = new EsmApiConnector(http, vaultWithKey(""));

        assertThatThrownBy(() -> keylessConnector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void credentialWithoutEsmKeysFailsClosedWithZeroHttp() {
        // A Coupang-shaped credential on a GMARKET account must fail the shape
        // check, naming the missing keys but never any stored value.
        vault.store(org, account, "API", "HMAC",
                Map.of("access_key", "stored-access-value", "secret_key", "stored-secret-value"),
                null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("master_id")
                .hasMessageNotContaining("stored-access-value")
                .hasMessageNotContaining("stored-secret-value");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void missingGmarketSellerIdFailsClosedWithZeroHttp() {
        // The catalog channel is GMARKET — an Auction-only credential cannot
        // serve it, even though the ssi claim itself would accept A: alone.
        vault.store(org, account, "API", "JWT_HS256",
                Map.of("master_id", "test-master-id",
                        "secret_key", "test-esm-secret-key",
                        "issuer", "www.sellerops.example",
                        "auction_seller_id", "auction-1"),
                null, null, null);

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("gmarket_seller_id");
        assertThat(http.sent).isEmpty();
    }

    @Test
    void validCredentialStopsSchemaPendingWithZeroHttp() {
        // The credential chain is proven (vault open + shape pass), then the
        // skeleton stops deliberately — no order schema is implemented yet.
        storeEsmCredential();

        assertThatThrownBy(() -> connector.fetch(request(DataType.ORDER_SUMMARY)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("구현되지 않았습니다")
                .hasMessageNotContaining("test-esm-secret-key");
        assertThat(http.sent).isEmpty();
    }
}
