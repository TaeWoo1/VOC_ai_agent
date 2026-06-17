package com.sellerops.connector.cafe24;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * The real Cafe24 Admin API connector. Phase 3D-3 is the <b>refresh-token auth
 * skeleton only</b>: capabilities expose <b>no collectable data type</b>, so
 * neither the scheduler nor manual sync can reach an unimplemented fetch path.
 * The bean exists only behind {@code sellerops.connector.cafe24.enabled=true}
 * ({@link Cafe24ConnectorConfiguration}); with the flag off, CAFE24 keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → refresh-token grant (the one
 * HTTP call, proving the credential chain) → <b>immediate rotation
 * write-back</b> → schema-pending stop. The write-back ordering is an
 * invariant, not a convenience: Cafe24 refresh tokens are single-use, so the
 * moment the provider answers, the stored token is dead — persisting the
 * replacement before anything else can fail is what keeps the credential
 * usable. A failed refresh never writes back (the exception fires first), so
 * the stored credential is untouched on failure.
 *
 * <p>The initial refresh token enters through the credential intake API after
 * the operator completes Cafe24's interactive authorization-code consent —
 * that flow is manual setup, not connector code.
 *
 * <p><b>Storage invariant:</b> the {@code secrets} map is the single
 * authoritative location for the Cafe24 refresh token (key
 * {@code refresh_token}); the vault row's separate refresh-token slot is NOT
 * read by this connector and is never written by rotation. A credential whose
 * token lives only in that slot fails the shape check closed, with a message
 * naming the missing key — reading both locations was deliberately rejected,
 * because after a rotation the slot would hold a dead token while the secrets
 * map holds the live one, and a dual-path reader could resurrect the dead one.
 */
public class Cafe24ApiConnector implements PullConnector {

    public static final String KIND = "CAFE24_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "CAFE24";

    /**
     * 429 hint when the official X-Cafe24-Call-Remain header is absent. One
     * second is the smallest honest hint (the bucket drains 2/sec); the
     * scheduled runner clamps rate-limit waits to ≥1 minute anyway.
     */
    static final int FALLBACK_RETRY_AFTER_SECONDS = 1;

    private final Cafe24TokenClient tokenClient;
    private final CredentialVault vault;

    public Cafe24ApiConnector(Cafe24TokenClient tokenClient, CredentialVault vault) {
        this.tokenClient = tokenClient;
        this.vault = vault;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public Set<String> dedicatedChannels() {
        return Set.of(CHANNEL_CODE);
    }

    @Override
    public ConnectorCapabilities capabilities(String channelCode) {
        return new ConnectorCapabilities(
                CONNECTOR_CLASS,
                Set.of(),
                Map.of(),
                "Phase 3D-3 auth skeleton: no collectable data type yet."
                        + " Order/product/board schemas land in later approved slices;"
                        + " reviews/inquiries flow through the generic boards API"
                        + " (per-mall board discovery, schema unverified).");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before any HTTP: vault.open throws when no credential row
        // exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        String mallId = credential.secrets().get("mall_id");
        String clientId = credential.secrets().get("client_id");
        String clientSecret = credential.secrets().get("client_secret");
        String refreshToken = credential.secrets().get("refresh_token");
        if (isBlank(mallId) || isBlank(clientId) || isBlank(clientSecret) || isBlank(refreshToken)) {
            throw new IllegalStateException(
                    "카페24 자격 증명에 mall_id, client_id, client_secret 또는 refresh_token이 없습니다.");
        }

        Cafe24TokenResult token;
        try {
            token = tokenClient.refresh(mallId, clientId, clientSecret, refreshToken);
        } catch (Cafe24RateLimitedException e) {
            int retryAfter = e.retryAfterSeconds() != null ? e.retryAfterSeconds() : FALLBACK_RETRY_AFTER_SECONDS;
            // Cursor unchanged — a throttled attempt must re-request the same position.
            return FetchPage.rateLimited(request.dataType(), request.cursorValue(), retryAfter, KIND);
        }

        // Single-use rotation: persist the replacement before anything else can
        // fail. rotateSecrets re-encrypts the payload only — connector class,
        // auth type, creator, and the separate refresh-token slot are preserved.
        if (token.rotatedFrom(refreshToken)) {
            Map<String, String> rotated = new LinkedHashMap<>(credential.secrets());
            rotated.put("refresh_token", token.refreshToken());
            vault.rotateSecrets(request.orgId(), request.sellerAccountId(), rotated);
        }

        throw new IllegalStateException(
                "카페24 주문 수집은 아직 구현되지 않았습니다 (Phase 3D-3 인증 스켈레톤 — 주문 스키마는 다음 슬라이스).");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
