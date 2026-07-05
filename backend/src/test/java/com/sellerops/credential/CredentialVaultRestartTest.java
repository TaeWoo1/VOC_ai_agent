package com.sellerops.credential;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * A stored credential must survive a backend restart when the same DB and vault master
 * key are supplied, and must fail closed when the key is missing or different. Restart
 * is modeled by reconstructing a fresh {@link CredentialVault} over the same persisted
 * rows — the master key comes from configuration, never generated per startup, so a
 * same-key reconstruction decrypts and a different/empty key cannot.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CredentialVaultRestartTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    private CredentialVault vaultWith(String keyBase64) {
        return new CredentialVault(credentials, new ObjectMapper(), keyBase64, "local-test-1");
    }

    private static String randomKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    @Test
    void anEncryptedCredentialRemainsUsableAfterServiceReconstructionWithTheSameKey() {
        String key = randomKey();
        Map<String, String> secrets = Map.of(
                "mall_id", "samplemall", "client_id", "cid",
                "client_secret", "csecret", "refresh_token", "rt-original");
        vaultWith(key).store(org, account, "API", "OAUTH2", secrets, null, null, null);

        // Simulate a restart: a brand-new vault instance over the same rows + same key.
        CredentialVault reconstructed = vaultWith(key);

        assertThat(reconstructed.hasCredential(org, account)).isTrue();
        assertThat(reconstructed.open(org, account).secrets()).isEqualTo(secrets);
    }

    @Test
    void aDifferentMasterKeyCannotDecryptTheStoredCredential() {
        vaultWith(randomKey()).store(org, account, "API", "OAUTH2",
                Map.of("refresh_token", "rt"), null, null, null);

        CredentialVault wrongKey = vaultWith(randomKey()); // different key

        assertThatThrownBy(() -> wrongKey.open(org, account)).isInstanceOf(Exception.class);
    }

    @Test
    void aMissingMasterKeyFailsClosed() {
        vaultWith(randomKey()).store(org, account, "API", "OAUTH2",
                Map.of("refresh_token", "rt"), null, null, null);

        CredentialVault emptyKey = vaultWith(""); // key not configured

        assertThatThrownBy(() -> emptyKey.open(org, account))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("마스터 키");
    }
}
