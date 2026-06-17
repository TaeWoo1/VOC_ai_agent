package com.sellerops.credential;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
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
 * Slice 5: vault round-trip over a real (H2) DB — write-only intake, masked
 * reads, in-memory decrypt, rotation, and fail-closed behavior without a key.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CredentialVaultTest {

    @Autowired ConnectorCredentialRepository credentials;

    private CredentialVault vault;
    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final Map<String, String> secrets = Map.of("accessKey", "AK-123", "secretKey", "SK-456");

    @BeforeEach
    void setUp() {
        vault = vaultWithKey(randomKeyBase64());
    }

    private CredentialVault vaultWithKey(String masterKeyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), masterKeyBase64, "local-test-1");
    }

    private static String randomKeyBase64() {
        byte[] key = new byte[CredentialVault.MASTER_KEY_LENGTH];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    @Test
    void storeAndOpenRoundTrip() {
        Instant expiry = Instant.parse("2026-12-31T00:00:00Z");
        vault.store(org, account, "API", "OAUTH2", secrets, "refresh-token-789", expiry, null);

        DecryptedCredential opened = vault.open(org, account);

        assertThat(opened.secrets()).isEqualTo(secrets);
        assertThat(opened.refreshToken()).isEqualTo("refresh-token-789");
        assertThat(opened.connectorClass()).isEqualTo("API");
        assertThat(opened.authType()).isEqualTo("OAUTH2");
        assertThat(opened.tokenExpiresAt()).isEqualTo(expiry);
    }

    @Test
    void storedRowContainsNoPlaintext() {
        vault.store(org, account, "API", "HMAC", secrets, "refresh-token-789", null, null);

        ConnectorCredential row = credentials.findBySellerAccountId(account).orElseThrow();
        assertThat(row.getEncryptionKeyId()).isEqualTo("local-test-1");
        assertThat(row.getIv()).hasSize(12);
        for (String secret : new String[] {"AK-123", "SK-456", "refresh-token-789"}) {
            byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
            assertThat(contains(row.getEncryptedPayload(), bytes)).as("payload leaks %s", secret).isFalse();
            assertThat(contains(row.getRefreshTokenEnc(), bytes)).as("refresh blob leaks %s", secret).isFalse();
        }
    }

    @Test
    void maskedReadExposesMetadataOnly() {
        vault.store(org, account, "API", "OAUTH2", secrets, "refresh-token-789", null, null);

        CredentialMetadata masked = vault.readMasked(org, account);

        assertThat(masked.sellerAccountId()).isEqualTo(account);
        assertThat(masked.connectorClass()).isEqualTo("API");
        assertThat(masked.authType()).isEqualTo("OAUTH2");
        assertThat(masked.encryptionKeyId()).isEqualTo("local-test-1");
        assertThat(masked.hasRefreshToken()).isTrue();
        // The masked view's whole rendering carries no secret material.
        assertThat(masked.toString()).doesNotContain("AK-123", "SK-456", "refresh-token-789");
    }

    @Test
    void storingAgainRotatesInPlace() {
        // Start WITH a refresh token so rotating to none proves the blob is cleared.
        vault.store(org, account, "API", "OAUTH2", secrets, "refresh-token-789", null, null);
        assertThat(credentials.findBySellerAccountId(account).orElseThrow().getLastRotatedAt()).isNull();

        Map<String, String> rotated = Map.of("accessKey", "AK-NEW", "secretKey", "SK-NEW");
        vault.store(org, account, "API", "HMAC", rotated, null, null, null);

        assertThat(credentials.count()).isEqualTo(1); // upsert, not a second row
        ConnectorCredential row = credentials.findBySellerAccountId(account).orElseThrow();
        assertThat(row.getLastRotatedAt()).isNotNull();
        assertThat(row.getRefreshTokenEnc()).isNull(); // stale token blob must not survive rotation
        DecryptedCredential opened = vault.open(org, account);
        assertThat(opened.secrets()).isEqualTo(rotated);
        assertThat(opened.refreshToken()).isNull();
        assertThat(vault.readMasked(org, account).hasRefreshToken()).isFalse();
    }

    @Test
    void rotateSecretsReplacesOnlyThePayload() {
        // Phase 3D-3: connector-driven rotation for providers with single-use
        // refresh tokens. Everything except the secret payload must survive.
        Instant expiry = Instant.parse("2026-12-31T00:00:00Z");
        UUID creator = UUID.randomUUID();
        vault.store(org, account, "API", "OAUTH2", secrets, "refresh-token-789", expiry, creator);

        Map<String, String> rotated = Map.of("accessKey", "AK-ROTATED", "secretKey", "SK-ROTATED");
        vault.rotateSecrets(org, account, rotated);

        assertThat(credentials.count()).isEqualTo(1);
        ConnectorCredential row = credentials.findBySellerAccountId(account).orElseThrow();
        assertThat(row.getConnectorClass()).isEqualTo("API");
        assertThat(row.getAuthType()).isEqualTo("OAUTH2");
        assertThat(row.getCreatedBy()).isEqualTo(creator);
        assertThat(row.getLastRotatedAt()).isNotNull();
        DecryptedCredential opened = vault.open(org, account);
        assertThat(opened.secrets()).isEqualTo(rotated);
        assertThat(opened.refreshToken()).isEqualTo("refresh-token-789"); // separate slot untouched
        assertThat(opened.tokenExpiresAt()).isEqualTo(expiry);
    }

    @Test
    void rotateSecretsFailsClosedWithoutAKeyLeavingTheRowUntouched() {
        vault.store(org, account, "API", "OAUTH2", secrets, null, null, null);

        assertThatThrownBy(() -> vaultWithKey("").rotateSecrets(
                org, account, Map.of("accessKey", "AK-NEW")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(vault.open(org, account).secrets()).isEqualTo(secrets);
    }

    @Test
    void rotateSecretsOnMissingOrCrossOrgRowReadsAsAbsent() {
        assertThatThrownBy(() -> vault.rotateSecrets(org, account, Map.of("k", "v")))
                .isInstanceOf(ApiException.class);

        vault.store(org, account, "API", "OAUTH2", secrets, null, null, null);
        assertThatThrownBy(() -> vault.rotateSecrets(UUID.randomUUID(), account, Map.of("k", "v")))
                .isInstanceOf(ApiException.class);
        assertThat(vault.open(org, account).secrets()).isEqualTo(secrets);
    }

    @Test
    void rotateSecretsRejectsEmptySecrets() {
        vault.store(org, account, "API", "OAUTH2", secrets, null, null, null);

        assertThatThrownBy(() -> vault.rotateSecrets(org, account, Map.of()))
                .isInstanceOf(ApiException.class);
        assertThat(vault.open(org, account).secrets()).isEqualTo(secrets);
    }

    @Test
    void missingMasterKeyFailsClosedWithoutWriting() {
        CredentialVault keyless = vaultWithKey("");

        assertThatThrownBy(() -> keyless.store(org, account, "API", "HMAC", secrets, null, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
        assertThat(credentials.count()).isZero();
    }

    @Test
    void wrongSizedMasterKeyIsRejected() {
        CredentialVault shortKey = vaultWithKey(Base64.getEncoder().encodeToString(new byte[16]));
        assertThatThrownBy(() -> shortKey.store(org, account, "API", "HMAC", secrets, null, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32바이트");
    }

    @Test
    void malformedBase64MasterKeyFailsClosed() {
        CredentialVault garbled = vaultWithKey("not-base64!!!");
        assertThatThrownBy(() -> garbled.store(org, account, "API", "HMAC", secrets, null, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("base64");
        assertThat(credentials.count()).isZero();
    }

    @Test
    void crossOrgAccessReadsAsAbsent() {
        vault.store(org, account, "API", "HMAC", secrets, null, null, null);

        UUID otherOrg = UUID.randomUUID();
        assertThatThrownBy(() -> vault.open(otherOrg, account)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> vault.readMasked(otherOrg, account)).isInstanceOf(ApiException.class);
        // Storing from another org must not silently take over the row either.
        assertThatThrownBy(() -> vault.store(otherOrg, account, "API", "HMAC", secrets, null, null, null))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void emptySecretsAreRejected() {
        assertThatThrownBy(() -> vault.store(org, account, "API", "HMAC", Map.of(), null, null, null))
                .isInstanceOf(ApiException.class);
        assertThat(credentials.count()).isZero();
    }

    @Test
    void decryptedCredentialToStringMasksSecrets() {
        vault.store(org, account, "API", "OAUTH2", secrets, "refresh-token-789", null, null);

        String rendered = vault.open(org, account).toString();

        assertThat(rendered).doesNotContain("AK-123", "SK-456", "refresh-token-789");
        assertThat(rendered).contains("<masked");
    }

    private static boolean contains(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return true;
        }
        return false;
    }
}
