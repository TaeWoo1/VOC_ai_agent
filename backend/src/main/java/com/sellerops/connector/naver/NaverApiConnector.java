package com.sellerops.connector.naver;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.Map;
import java.util.Set;

/**
 * The real Naver Commerce API connector — Phase 3C Slice 1a: the safely
 * confirmed boundary only. The bean exists only behind
 * {@code sellerops.connector.naver.enabled=true} (see
 * {@link NaverConnectorConfiguration}); with the flag off, NAVER keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p><b>Safe state until Slice 1b:</b> {@link #capabilities} advertises no
 * collectable data type, so schedule PUTs are rejected and the run executor
 * records a config failure before ever calling {@link #fetch} — no
 * scheduler/manual path can reach the unimplemented orders call. The
 * {@code fetch(ORDER_SUMMARY)} path below exists to prove the credential →
 * token chain end to end (and is exercised by tests): it distinguishes
 * "never supported here" ({@link UnsupportedDataTypeException} — REVIEW,
 * INQUIRY, PRODUCT, SALES) from "supported by Naver, parsing pending official
 * schema confirmation" (a clear schema-pending error after the token mint).
 * Slice 1b flips capabilities to ORDER_SUMMARY once the official
 * last-changed-statuses response schema is confirmed.
 *
 * <p>Fail-closed ordering inside {@code fetch}: data-type gate → vault open
 * (missing credential / missing master key throw here) → secret-shape check →
 * only then the first HTTP call (token mint). A credential problem can never
 * produce an outbound request.
 */
public class NaverApiConnector implements PullConnector {

    public static final String KIND = "NAVER_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "NAVER";

    /**
     * Naver sends no Retry-After on 429 (official: rate metering is per second,
     * clients back off themselves). One second is the smallest honest hint; the
     * scheduled runner clamps rate-limit waits to ≥1 minute anyway.
     */
    static final int FALLBACK_RETRY_AFTER_SECONDS = 1;

    private final NaverTokenClient tokenClient;
    private final CredentialVault vault;

    public NaverApiConnector(NaverTokenClient tokenClient, CredentialVault vault) {
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
        // Slice 1a: nothing is collectable yet — this is what keeps the scheduler
        // and manual sync away from the unimplemented orders call. ORDER_SUMMARY
        // is the confirmed first target; it turns on in Slice 1b.
        return new ConnectorCapabilities(
                CONNECTOR_CLASS,
                Set.of(),
                Map.of(DataType.ORDER_SUMMARY, "NEEDS_VERIFICATION"),
                "Slice 1a: auth/token path only. ORDER_SUMMARY collection lands in Slice 1b"
                        + " once the official last-changed-statuses response schema is confirmed.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before any HTTP: vault.open throws when no credential row
        // exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        String clientId = credential.secrets().get("client_id");
        String clientSecret = credential.secrets().get("client_secret");
        if (isBlank(clientId) || isBlank(clientSecret)) {
            throw new IllegalStateException("네이버 자격 증명에 client_id 또는 client_secret이 없습니다.");
        }

        try {
            tokenClient.accessToken(clientId, clientSecret);
        } catch (NaverRateLimitedException e) {
            int retryAfter = e.retryAfterSeconds() != null ? e.retryAfterSeconds() : FALLBACK_RETRY_AFTER_SECONDS;
            // Cursor unchanged — a throttled attempt must re-request the same position.
            return FetchPage.rateLimited(request.dataType(), request.cursorValue(), retryAfter, KIND);
        }

        // Token path proven. The orders call itself is Slice 1b: the official
        // response schema (fields, pagination block, amount availability) is not
        // yet confirmed, and guessing it is forbidden.
        throw new IllegalStateException(
                "네이버 주문 수집은 아직 사용할 수 없습니다 — 공식 응답 스키마 확정 후 Slice 1b에서 구현됩니다.");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
