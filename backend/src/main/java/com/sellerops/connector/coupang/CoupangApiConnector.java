package com.sellerops.connector.coupang;

import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.connector.UnsupportedScope;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The real Coupang WING Open API connector. ORDER_SUMMARY is collectable through the
 * officially documented "PO list query, paging by day" v5 {@code ordersheets} flow (see
 * {@link CoupangOrdersClient}); everything else stays unsupported — REVIEW has no official
 * Coupang API at all, INQUIRY/PRODUCT/SALES are deferred pending their own schema
 * verification. The bean exists only behind {@code sellerops.connector.coupang.enabled=true}
 * ({@link CoupangConnectorConfiguration}); with the flag off, COUPANG keeps resolving to the
 * mock connector and runtime behavior is unchanged.
 *
 * <p>Fail-closed ordering inside {@code fetch} / {@code verifyConnection}: data-type/route gate
 * → vault open (missing credential / missing master key throw here) → secret-shape check → only
 * then the first HTTP call. A credential problem can never produce an outbound request.
 *
 * <p><b>Two separate checks.</b> {@code verifyConnection} answers credential validity and
 * order access as DISTINCT questions: a low-privilege {@code returnShippingCenters} GET proves
 * the HMAC credential + caller IP at the gateway, and only when that passes is a read-only
 * {@code ordersheets} order-access probe run. Coupang's gateway returns a fixed 401 for a bad
 * signature and a fixed "Not allowed IP" 403 for an unregistered caller, so a bad credential is
 * never misreported as an IP problem (or vice versa); an ungranted order scope is the hedged
 * {@code ORDER_ACCESS_DENIED}, never guessed into a specific code.
 */
public class CoupangApiConnector implements PullConnector, ConnectionVerifier {

    public static final String KIND = "COUPANG_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "COUPANG";

    private final CoupangOrdersClient ordersClient;
    private final CredentialVault vault;

    public CoupangApiConnector(CoupangOrdersClient ordersClient, CredentialVault vault) {
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
                "ORDER_SUMMARY via the official v5 ordersheets day-paging flow"
                        + " (createdAt window ≤31d, per-status sweep, nextToken paging)."
                        + " REVIEW has no official Coupang API; INQUIRY/PRODUCT/SALES deferred.");
    }

    @Override
    public List<UnsupportedScope> unsupportedScopes(String channelCode) {
        if (!CHANNEL_CODE.equals(channelCode)) {
            return List.of();
        }
        // An honest, operator-facing boundary: Coupang exposes no seller review API.
        return List.of(new UnsupportedScope("REVIEW_API", "리뷰 API 없음 (쿠팡 미제공)"));
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }
        Credential credential = openAndValidate(request.orgId(), request.sellerAccountId());
        try {
            return ordersClient.fetchOrderSummaryPage(
                    credential.accessKey(), credential.secretKey(), credential.vendorId(), request.cursorValue());
        } catch (CoupangRateLimitedException e) {
            // Cursor unchanged — a throttled attempt must re-request the same window.
            return FetchPage.rateLimited(
                    request.dataType(), request.cursorValue(), e.effectiveRetryAfterSeconds(), KIND);
        }
    }

    /**
     * Auth <b>and order-access</b> check for the stored credential — never collects, never
     * writes. Fail-closed ordering mirrors {@code fetch}: vault open → secret-shape check (no HTTP
     * if a field is missing) → a single credential/environment probe → <b>only when that passes</b>,
     * one read-only order-access probe. The credential probe alone proves the HMAC key + caller IP;
     * it can NEVER prove the vendor holds order-API access, so the order probe is what lets the
     * connect test distinguish a bad credential / unregistered IP from a missing order scope, instead
     * of passing to PREPARING and failing silently at first sync. No secret or provider body is returned.
     */
    @Override
    public VerifyOutcome verifyConnection(VerifyContext context) {
        // The service already confirmed a credential is on file; a missing master key (deploy
        // misconfig) propagates as a 500, not a fabricated FAILED.
        DecryptedCredential decrypted = vault.open(context.orgId(), context.sellerAccountId());
        String accessKey = decrypted.secrets().get("access_key");
        String secretKey = decrypted.secrets().get("secret_key");
        String vendorId = decrypted.secrets().get("vendor_id");
        if (isBlank(accessKey) || isBlank(secretKey) || isBlank(vendorId)) {
            return VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL);
        }
        return switch (ordersClient.credentialProbe(accessKey, secretKey, vendorId)) {
            // Credential + IP accepted — now answer the separate order-access question.
            case OK -> orderAccessOutcome(accessKey, secretKey, vendorId);
            // A non-IP 403 means the signature WAS accepted (else 401); the credential is valid, so
            // let the order probe answer authoritatively rather than blocking it here.
            case INCONCLUSIVE_FORBIDDEN -> orderAccessOutcome(accessKey, secretKey, vendorId);
            case INVALID -> VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL);
            case IP_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
            case RATE_LIMITED -> VerifyOutcome.failed(VerifyOutcome.REASON_TEMPORARY_PROVIDER_ERROR);
            case UNAVAILABLE -> VerifyOutcome.failed(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
        };
    }

    /**
     * The order-access half of the connect test, reached only when the credential is already proven.
     * Maps the read-only probe to a safe reason code. Only a genuine access denial fails; every
     * inconclusive outcome (throttling, provider 5xx, a we-side 4xx) degrades to {@code success()},
     * so a credential the gateway just accepted is never blocked by a transient order-side condition
     * (the sync path surfaces any residual issue). A 403 with the fixed IP marker is the call-IP
     * verdict; any other 403 is the hedged {@code ORDER_ACCESS_DENIED}.
     */
    private VerifyOutcome orderAccessOutcome(String accessKey, String secretKey, String vendorId) {
        return switch (ordersClient.probeOrderAccess(accessKey, secretKey, vendorId)) {
            case CONFIRMED, RATE_LIMITED, UNAVAILABLE -> VerifyOutcome.success();
            case CALL_IP_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
            case ACCESS_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_ORDER_ACCESS_DENIED);
        };
    }

    private Credential openAndValidate(java.util.UUID orgId, java.util.UUID sellerAccountId) {
        // Fail closed before any HTTP: vault.open throws when no credential row exists (org-scoped)
        // or the vault master key is not configured.
        DecryptedCredential decrypted = vault.open(orgId, sellerAccountId);
        String accessKey = decrypted.secrets().get("access_key");
        String secretKey = decrypted.secrets().get("secret_key");
        String vendorId = decrypted.secrets().get("vendor_id");
        if (isBlank(accessKey) || isBlank(secretKey) || isBlank(vendorId)) {
            throw new IllegalStateException(
                    "쿠팡 자격 증명에 access_key, secret_key 또는 vendor_id가 없습니다.");
        }
        return new Credential(accessKey, secretKey, vendorId);
    }

    private record Credential(String accessKey, String secretKey, String vendorId) {
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
