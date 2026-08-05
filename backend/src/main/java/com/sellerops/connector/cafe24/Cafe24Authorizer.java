package com.sellerops.connector.cafe24;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The single Cafe24 credential-authorization seam: vault open (missing
 * credential / missing master key throws here) → secret-shape check →
 * refresh-token grant → <b>immediate single-use rotation write-back</b>.
 *
 * <p>Extracted from {@link Cafe24ApiConnector} so the connector and any
 * diagnostic live-proof share <b>one</b> path — the refresh/rotation logic is
 * defined once here and never copied. The write-back ordering is an invariant,
 * not a convenience: Cafe24 refresh tokens are single-use, so the replacement
 * is persisted before the caller does anything else that could fail. A failed
 * refresh throws first and never writes back, leaving the stored credential
 * untouched. A {@link Cafe24RateLimitedException} on refresh propagates before
 * any write-back.
 *
 * <p><b>Storage invariant</b> (preserved from the connector): the {@code secrets}
 * map is the single authoritative location for the refresh token (key
 * {@code refresh_token}); the vault row's separate refresh-token slot is not
 * read and is never written by rotation.
 *
 * <p><b>Concurrency</b> (single-use rotation race): the three Cafe24 streams and the
 * capability probe can each refresh the same account's shared, single-use token
 * concurrently. Two guards prevent one caller from spuriously killing the connection by
 * spending a token the other already rotated: (1) a per-account in-process lock serializes
 * the open→refresh→rotate section ({@link Cafe24AccountRefreshLocks}); (2) on an
 * {@code invalid_grant} the credential is re-read once — if the stored refresh token has
 * changed, the old one was merely superseded (by another process), so the refresh is retried
 * with the current token instead of being reported as a dead connection.
 */
public class Cafe24Authorizer {

    private final Cafe24TokenClient tokenClient;
    private final CredentialVault vault;
    private final Cafe24AccountRefreshLocks refreshLocks = new Cafe24AccountRefreshLocks();
    /**
     * App-level OAuth credentials of the ONE registered SellerOps Cafe24 app —
     * server configuration, identical for every mall, NEVER per-seller vault
     * material. The vault holds only seller-connection values (mall_id,
     * refresh_token).
     */
    private final String appClientId;
    private final String appClientSecret;

    public Cafe24Authorizer(Cafe24TokenClient tokenClient, CredentialVault vault,
                            String appClientId, String appClientSecret) {
        this.tokenClient = tokenClient;
        this.vault = vault;
        this.appClientId = appClientId;
        this.appClientSecret = appClientSecret;
    }

    /**
     * Refresh the stored Cafe24 credential and return a fresh access token plus
     * the mall id. Persists a rotated single-use refresh token before returning.
     *
     * <p>Serialized per account so concurrent streams/probe never double-spend the
     * single-use token (see class doc).
     */
    public Authorized authorize(UUID orgId, UUID sellerAccountId) {
        return refreshLocks.withAccountLock(sellerAccountId, () -> doAuthorize(orgId, sellerAccountId));
    }

    private Authorized doAuthorize(UUID orgId, UUID sellerAccountId) {
        DecryptedCredential credential = vault.open(orgId, sellerAccountId);
        String mallId = credential.secrets().get("mall_id");
        String refreshToken = credential.secrets().get("refresh_token");
        if (isBlank(mallId) || isBlank(refreshToken)) {
            throw new IllegalStateException(
                    "카페24 자격 증명에 mall_id 또는 refresh_token이 없습니다.");
        }
        if (isBlank(appClientId) || isBlank(appClientSecret)) {
            // App-level OAuth credentials are server configuration — a run cannot
            // proceed without them, and they are never read from the vault.
            throw new IllegalStateException(
                    "카페24 앱 자격 증명(client_id/client_secret)이 설정되지 않았습니다.");
        }

        Cafe24TokenResult token;
        try {
            token = tokenClient.refresh(mallId, appClientId, appClientSecret, refreshToken);
        } catch (Cafe24OAuthException e) {
            if (e.kind() != Cafe24OAuthException.Kind.INVALID_GRANT) {
                // Insufficient-scope / unknown provider failures are not a rotation race — surface them.
                throw e;
            }
            // invalid_grant: the token we used may have been rotated out from under us by another
            // process (the in-process lock only serializes THIS host). Re-read once; if the stored
            // token changed, the old one was merely superseded — retry with the current token
            // instead of declaring the connection dead. If unchanged, it is genuinely revoked.
            DecryptedCredential reread = vault.open(orgId, sellerAccountId);
            String current = reread.secrets().get("refresh_token");
            if (current == null || current.isBlank() || current.equals(refreshToken)) {
                throw e;
            }
            credential = reread;
            refreshToken = current;
            token = tokenClient.refresh(mallId, appClientId, appClientSecret, current);
        }

        // Single-use rotation: persist the replacement before anything else can
        // fail. rotateSecrets re-encrypts the payload only — connector class, auth
        // type, creator, and the separate refresh-token slot are preserved.
        if (token.rotatedFrom(refreshToken)) {
            Map<String, String> rotated = new LinkedHashMap<>(credential.secrets());
            rotated.put("refresh_token", token.refreshToken());
            vault.rotateSecrets(orgId, sellerAccountId, rotated);
        }
        return new Authorized(mallId, token.accessToken());
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /** A fresh access token bound to its mall — never persisted, logged, or serialized. */
    public record Authorized(String mallId, String accessToken) {
    }
}
