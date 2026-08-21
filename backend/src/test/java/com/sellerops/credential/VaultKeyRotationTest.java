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
 * What happens to a stored credential when the vault's key changes — the failure mode that took a
 * full audit of the demo org to identify, because every one of these cases produced the same
 * sentence: "자격 증명 복호화에 실패했습니다".
 *
 * <p>The measured facts that motivated this class: four credentials all stamped
 * {@code encryption_key_id = 'local-dev-1'}; a key of exactly that name present on the machine; and
 * that key unable to open any of them. The column existed from the first release and
 * {@code open()} never read it, so a key id could name a key that was not the key and nothing
 * noticed. One of the four turned out to be recoverable from local material and one was genuinely
 * lost — an operationally enormous difference the old error message could not express.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class VaultKeyRotationTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final Map<String, String> secrets = Map.of("clientId", "CID-1", "clientSecret", "CS-2");

    private CredentialVault vault(String keyBase64, String keyId, String keyRing) {
        return new CredentialVault(credentials, new ObjectMapper(),
                new VaultKeyRing(keyBase64, keyId, keyRing));
    }

    private static String randomKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    @Test
    void aRetiredKeyStillOpensWhatItSealed() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        String oldKey = randomKey();
        vault(oldKey, "key-2026-06", "").store(org, account, "API", "API_KEY", secrets, null, null, null);

        // Rotate: a brand-new active key, with the old one carried on the read-only ring.
        CredentialVault rotated = vault(randomKey(), "key-2026-08", "key-2026-06:" + oldKey);

        assertThat(rotated.open(org, account).secrets()).isEqualTo(secrets);
        assertThat(rotated.diagnose(org, account).status()).isEqualTo(CredentialKeyStatus.OK);
    }

    @Test
    void rotatingWithoutCarryingTheOldKeySaysWhichKeyIsMissing() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        vault(randomKey(), "key-2026-06", "").store(org, account, "API", "API_KEY", secrets, null, null, null);

        CredentialVault rotated = vault(randomKey(), "key-2026-08", "");

        assertThatThrownBy(() -> rotated.open(org, account))
                .isInstanceOf(CredentialUnavailableException.class)
                .hasMessageContaining("key-2026-06");
        CredentialDiagnosis d = rotated.diagnose(org, account);
        assertThat(d.status()).isEqualTo(CredentialKeyStatus.KEY_NOT_AVAILABLE);
        // The remedy is a config edit, not a seller reconnect. Naming that correctly is the point.
        assertThat(d.remedy()).contains("key-ring");
    }

    /**
     * The demo org's exact shape: the row's key id names a key that IS present, and is the wrong key.
     * Proven by fingerprint comparison, so the verdict does not depend on a decryption attempt that
     * could equally mean a damaged payload.
     */
    @Test
    void aKeyIdThatNamesTheWrongKeyIsReportedAsMismatchNotAsCorruption() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        vault(randomKey(), "local-dev-1", "").store(org, account, "API", "API_KEY", secrets, null, null, null);

        // Same key id, different material — a machine where "local-dev-1" was regenerated.
        CredentialVault impostor = vault(randomKey(), "local-dev-1", "");

        CredentialDiagnosis d = impostor.diagnose(org, account);
        assertThat(d.status()).isEqualTo(CredentialKeyStatus.KEY_MISMATCH);
        assertThat(d.sealedKeyFingerprint()).isNotNull().isNotEqualTo(d.availableKeyFingerprint());
        assertThatThrownBy(() -> impostor.open(org, account))
                .isInstanceOf(CredentialUnavailableException.class)
                .satisfies(e -> assertThat(((CredentialUnavailableException) e).status())
                        .isEqualTo(CredentialKeyStatus.KEY_MISMATCH));
    }

    @Test
    void aFingerprintIdentifiesAKeyWithoutCarryingIt() {
        String keyBase64 = randomKey();
        byte[] key = Base64.getDecoder().decode(keyBase64);
        String fingerprint = EnvelopeCipher.fingerprint(key);

        assertThat(fingerprint).isNotBlank();
        // Stable for the same key, different for another, and no substring of the key survives in it.
        assertThat(EnvelopeCipher.fingerprint(key)).isEqualTo(fingerprint);
        assertThat(EnvelopeCipher.fingerprint(Base64.getDecoder().decode(randomKey())))
                .isNotEqualTo(fingerprint);
        assertThat(fingerprint).doesNotContain(keyBase64.substring(0, 8));
    }

    @Test
    void diagnosingAnAccountWithNoCredentialSaysSoWithoutThrowing() {
        CredentialDiagnosis d = vault(randomKey(), "k", "")
                .diagnose(UUID.randomUUID(), UUID.randomUUID());
        assertThat(d.status()).isEqualTo(CredentialKeyStatus.NO_CREDENTIAL);
        assertThat(d.openable()).isFalse();
    }

    @Test
    void anUnconfiguredVaultBlamesTheServerNotTheSeller() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        vault(randomKey(), "k", "").store(org, account, "API", "API_KEY", secrets, null, null, null);

        CredentialDiagnosis d = vault("", "k", "").diagnose(org, account);
        assertThat(d.status()).isEqualTo(CredentialKeyStatus.NO_KEY_CONFIGURED);
        assertThat(d.remedy()).contains("셀러가 다시 연결할 필요는 없습니다");
    }

    @Test
    void aMalformedKeyRingFailsAtConstructionRatherThanAtTheFirstSync() {
        assertThatThrownBy(() -> new VaultKeyRing(randomKey(), "k", "no-colon-here"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("keyId:base64");
    }

    @Test
    void theActiveKeyWinsOverAStaleRingEntryForTheSameId() {
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();
        String active = randomKey();
        vault(active, "k", "").store(org, account, "API", "API_KEY", secrets, null, null, null);

        // A ring entry claiming the same id must not shadow the authoritative active material.
        CredentialVault v = vault(active, "k", "k:" + randomKey());
        assertThat(v.open(org, account).secrets()).isEqualTo(secrets);
    }
}
