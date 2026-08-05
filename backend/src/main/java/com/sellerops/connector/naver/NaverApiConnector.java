package com.sellerops.connector.naver;

import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
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
public class NaverApiConnector implements PullConnector, ConnectionVerifier {

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
     * Auth <b>and order-access</b> check for the stored credential — never collects,
     * never writes. Fail-closed ordering mirrors {@code fetch}: vault open →
     * secret-shape check (no HTTP if a field is missing) → a single live token mint
     * (no cache) → <b>only when the token is accepted</b>, one read-only order-access
     * probe ({@link NaverOrdersClient#probeOrderAccess}). The token alone proves the
     * credential; it can NEVER prove the app holds the order-API permission or that
     * the caller IP is allowed — those first surface at the order endpoint, so the
     * probe is what lets the connect test distinguish a bad credential from a missing
     * order permission / an unregistered call IP, instead of passing to PREPARING and
     * failing silently at first sync. No token, secret, or provider body is returned.
     */
    @Override
    public VerifyOutcome verifyConnection(VerifyContext context) {
        // The service already confirmed a credential is on file; a missing master
        // key (deploy misconfig) propagates as a 500, not a fabricated FAILED.
        DecryptedCredential credential = vault.open(context.orgId(), context.sellerAccountId());
        String clientId = credential.secrets().get("client_id");
        String clientSecret = credential.secrets().get("client_secret");
        if (isBlank(clientId) || isBlank(clientSecret)) {
            return VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        }
        return switch (tokenClient.verify(clientId, clientSecret)) {
            // Credential accepted — now answer the separate order-access question.
            case OK -> orderAccessOutcome(clientId, clientSecret);
            case INVALID -> VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL);
            case RATE_LIMITED -> VerifyOutcome.failed(VerifyOutcome.REASON_TEMPORARY_PROVIDER_ERROR);
            case UNAVAILABLE -> VerifyOutcome.failed(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
        };
    }

    /**
     * The order-access half of the connect test, reached only when the credential is
     * already proven. Obtains a token for the probe (the throwaway verify token is
     * not returned) and maps the read-only probe result to a safe reason code.
     *
     * <p>Only a genuine access denial (HTTP 403) fails the test; every inconclusive
     * outcome — throttling, provider 5xx, a we-side 4xx, or an inability to even mint
     * the probe token — degrades to {@code success()}, because the credential the
     * token step just accepted must not be blocked by a transient order-side condition
     * (this preserves the pre-probe behavior for those cases; the sync path surfaces
     * any residual order issue). PERMISSION/CALL-IP verdicts fire only behind the
     * never-guessed code whitelists; today an unrecognized 403 is the hedged
     * {@code ORDER_ACCESS_DENIED}.
     */
    private VerifyOutcome orderAccessOutcome(String clientId, String clientSecret) {
        String accessToken;
        try {
            accessToken = tokenClient.accessToken(clientId, clientSecret);
        } catch (NaverRateLimitedException | IllegalStateException e) {
            // Could not obtain a probe token though verify accepted the credential —
            // inconclusive. Do not block a credential that was just proven valid.
            return VerifyOutcome.success();
        }
        return switch (ordersClient.probeOrderAccess(accessToken)) {
            case CONFIRMED, RATE_LIMITED, UNAVAILABLE -> VerifyOutcome.success();
            case PERMISSION_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_PERMISSION_INSUFFICIENT);
            case CALL_IP_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
            case ACCESS_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_ORDER_ACCESS_DENIED);
        };
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
