package com.sellerops.credential;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Whether a connection HOLDS a permission, answered from the moment it was granted.
 *
 * <p>Until this existed the product knew only what it had asked for. What it actually held surfaced
 * months later as an {@code insufficient_scope} on a Cafe24 product read — long after the seller had
 * finished consenting, when the only remedy left was to bring them back for a second consent.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class GrantedScopeRecordingTest {

    @Autowired ConnectorCredentialRepository credentials;

    private final Map<String, String> secrets = Map.of("mall_id", "demomall", "refresh_token", "R1");

    private CredentialVault vault() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return new CredentialVault(credentials, new ObjectMapper(),
                Base64.getEncoder().encodeToString(key), "local-test-1");
    }

    private UUID store(CredentialVault vault, UUID org, UUID account) {
        vault.store(org, account, "API", "OAUTH2", secrets, null, null, null);
        return account;
    }

    @Test
    void aFreshlyStoredCredentialHasNoObservedScopesRatherThanNone() {
        CredentialVault vault = vault();
        UUID org = UUID.randomUUID();
        UUID account = store(vault, org, UUID.randomUUID());

        // Null, not empty. Reporting an unobserved grant as "no permissions" would call every
        // pre-existing connection broken.
        assertThat(vault.diagnose(org, account).grantedScopes()).isNull();
    }

    @Test
    void recordingTheGrantMakesTheProductPermissionAnswerableWithoutACall() {
        CredentialVault vault = vault();
        UUID org = UUID.randomUUID();
        UUID account = store(vault, org, UUID.randomUUID());

        vault.recordGrantedScopes(org, account,
                List.of("mall.read_community", "mall.read_order", "mall.read_product"));

        assertThat(vault.diagnose(org, account).grantedScopes())
                .containsExactly("mall.read_community", "mall.read_order", "mall.read_product");
    }

    /**
     * A narrowed grant must be visible as a narrowing.
     *
     * <p>Scopes ride on every token, including every runtime refresh, so a seller who later reduced
     * the grant shows up here rather than as an unexplained 403 on the next product read.
     */
    @Test
    void aLaterNarrowerGrantReplacesTheRecordedSet() {
        CredentialVault vault = vault();
        UUID org = UUID.randomUUID();
        UUID account = store(vault, org, UUID.randomUUID());

        vault.recordGrantedScopes(org, account, List.of("mall.read_community", "mall.read_product"));
        vault.recordGrantedScopes(org, account, List.of("mall.read_community"));

        assertThat(vault.diagnose(org, account).grantedScopes()).containsExactly("mall.read_community");
    }

    /**
     * Silence is not a revocation. A token response that carries no scope list has told us nothing,
     * and overwriting a known grant with it would manufacture a permission regression out of a quiet
     * provider response — and send a seller to re-consent for no reason.
     */
    @Test
    void aResponseCarryingNoScopesLeavesTheRecordedGrantAlone() {
        CredentialVault vault = vault();
        UUID org = UUID.randomUUID();
        UUID account = store(vault, org, UUID.randomUUID());
        vault.recordGrantedScopes(org, account, List.of("mall.read_order", "mall.read_product"));

        vault.recordGrantedScopes(org, account, List.of());
        vault.recordGrantedScopes(org, account, null);

        assertThat(vault.diagnose(org, account).grantedScopes())
                .containsExactly("mall.read_order", "mall.read_product");
    }

    @Test
    void recordingScopesTouchesNoSecretMaterialAndKeepsTheCredentialOpenable() {
        CredentialVault vault = vault();
        UUID org = UUID.randomUUID();
        UUID account = store(vault, org, UUID.randomUUID());
        String fingerprintBefore = vault.diagnose(org, account).sealedKeyFingerprint();

        vault.recordGrantedScopes(org, account, List.of("mall.read_product"));

        assertThat(vault.open(org, account).secrets()).isEqualTo(secrets);
        assertThat(vault.diagnose(org, account).sealedKeyFingerprint()).isEqualTo(fingerprintBefore);
    }
}
