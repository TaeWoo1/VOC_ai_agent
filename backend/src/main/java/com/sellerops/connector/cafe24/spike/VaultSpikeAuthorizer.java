package com.sellerops.connector.cafe24.spike;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Vault-backed {@link SpikeAuthorizer}. Opens the <b>spike</b> credential (a
 * disposable seller account in a disposable DB), refreshes it through the
 * scope-aware {@link SpikeTokenClient}, and persists any rotated single-use refresh
 * token before returning — the same rotation discipline as the production
 * {@code Cafe24Authorizer}, but on the spike credential only. The production
 * credential is never opened or written here.
 *
 * <p>Fails closed: a missing mall id / refresh token, missing app credentials, or a
 * refresh failure throws before any comment work can begin.
 */
public class VaultSpikeAuthorizer implements SpikeAuthorizer {

    private final SpikeTokenClient tokenClient;
    private final CredentialVault vault;
    private final String appClientId;
    private final String appClientSecret;

    public VaultSpikeAuthorizer(SpikeTokenClient tokenClient, CredentialVault vault,
                                String appClientId, String appClientSecret) {
        this.tokenClient = tokenClient;
        this.vault = vault;
        this.appClientId = appClientId;
        this.appClientSecret = appClientSecret;
    }

    @Override
    public SpikeAuthorization authorizeForSpike(UUID orgId, UUID spikeAccountId) {
        DecryptedCredential credential = vault.open(orgId, spikeAccountId);
        String mallId = credential.secrets().get("mall_id");
        String refreshToken = credential.secrets().get("refresh_token");
        if (isBlank(mallId) || isBlank(refreshToken)) {
            throw new IllegalStateException("스파이크 자격 증명에 mall_id 또는 refresh_token이 없습니다.");
        }
        if (isBlank(appClientId) || isBlank(appClientSecret)) {
            throw new IllegalStateException("카페24 앱 자격 증명(client_id/client_secret)이 설정되지 않았습니다.");
        }

        SpikeToken token = tokenClient.refresh(mallId, appClientId, appClientSecret, refreshToken);

        // Single-use rotation write-back — persist the replacement before returning.
        if (token.refreshToken() != null && !token.refreshToken().isBlank()
                && !token.refreshToken().equals(refreshToken)) {
            Map<String, String> rotated = new LinkedHashMap<>(credential.secrets());
            rotated.put("refresh_token", token.refreshToken());
            vault.rotateSecrets(orgId, spikeAccountId, rotated);
        }
        return new SpikeAuthorization(mallId, token.accessToken(), token.writeCommunityGranted());
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
