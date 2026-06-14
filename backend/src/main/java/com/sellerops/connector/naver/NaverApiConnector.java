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
 * The real Naver Commerce API connector. Phase 3C Slice 1b: ORDER_SUMMARY is
 * collectable through the officially recommended two-call flow (see
 * {@link NaverOrdersClient}); everything else stays unsupported — REVIEW has no
 * official API at all, INQUIRY/PRODUCT/SALES are deferred pending their own
 * schema verification. The bean exists only behind
 * {@code sellerops.connector.naver.enabled=true}
 * ({@link NaverConnectorConfiguration}); with the flag off, NAVER keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p>Fail-closed ordering inside {@code fetch}: data-type gate → vault open
 * (missing credential / missing master key throw here) → secret-shape check →
 * only then the first HTTP call (token mint, then the order queries). A
 * credential problem can never produce an outbound request.
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

    /**
     * A quota breach ({@code GW.QUOTA_LIMIT}) is per-period, not per-second, so a
     * one-second hint would just re-trip it. Without an explicit header, hint a
     * full minute as the conservative earliest retry.
     */
    static final int QUOTA_FALLBACK_RETRY_AFTER_SECONDS = 60;

    private final NaverTokenClient tokenClient;
    private final NaverOrdersClient ordersClient;
    private final CredentialVault vault;

    public NaverApiConnector(NaverTokenClient tokenClient, NaverOrdersClient ordersClient,
                             CredentialVault vault) {
        this.tokenClient = tokenClient;
        this.ordersClient = ordersClient;
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
                Set.of(DataType.ORDER_SUMMARY),
                Map.of(DataType.ORDER_SUMMARY, "CONFIRMED"),
                "Slice 1b: ORDER_SUMMARY via the official two-call flow"
                        + " (last-changed-statuses → product-orders/query)."
                        + " REVIEW has no official API; INQUIRY/PRODUCT/SALES deferred.");
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
            String accessToken = tokenClient.accessToken(clientId, clientSecret);
            return ordersClient.fetchOrderSummaryPage(accessToken, request.cursorValue());
        } catch (NaverRateLimitedException e) {
            // Cursor unchanged — a throttled attempt must re-request the same position.
            return FetchPage.rateLimited(request.dataType(), request.cursorValue(), retryAfterFor(e), KIND);
        }
    }

    /**
     * The earliest-retry hint: the server's {@code Retry-After} if it ever sends
     * one, else a per-cause default — a full minute for a quota breach (per-period),
     * one second for a rate breach (per-second bucket).
     */
    private static int retryAfterFor(NaverRateLimitedException e) {
        if (e.retryAfterSeconds() != null) {
            return e.retryAfterSeconds();
        }
        return e.limitType() == NaverRateLimitedException.LimitType.QUOTA_LIMIT
                ? QUOTA_FALLBACK_RETRY_AFTER_SECONDS
                : FALLBACK_RETRY_AFTER_SECONDS;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
