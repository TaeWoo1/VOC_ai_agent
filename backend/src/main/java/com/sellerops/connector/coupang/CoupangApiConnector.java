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
import com.sellerops.connector.coupang.CoupangOrdersClient.CredentialProbe;
import com.sellerops.connector.coupang.CoupangOrdersClient.CredentialProbeResult;
import com.sellerops.connector.coupang.CoupangOrdersClient.OrderAccessProbe;
import com.sellerops.connector.coupang.CoupangOrdersClient.OrderAccessResult;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The real Coupang WING Open API connector. Two streams are collectable, both officially
 * documented and both read-only: ORDER_SUMMARY through the "PO list query, paging by day" v5
 * {@code ordersheets} flow ({@link CoupangOrdersClient}), and INQUIRY through the v5
 * {@code onlineInquiries} 상품별 고객문의 flow ({@link CoupangInquiriesClient}). Everything else
 * stays unsupported — REVIEW has no official Coupang API at all, PRODUCT/SALES are deferred
 * pending their own schema verification. The bean exists only behind
 * {@code sellerops.connector.coupang.enabled=true} ({@link CoupangConnectorConfiguration}); with
 * the flag off, COUPANG keeps resolving to the mock connector and runtime behavior is unchanged.
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

    private static final Logger log = LoggerFactory.getLogger(CoupangApiConnector.class);

    private final CoupangOrdersClient ordersClient;
    private final CoupangInquiriesClient inquiriesClient;
    private final CredentialVault vault;

    public CoupangApiConnector(CoupangOrdersClient ordersClient, CoupangInquiriesClient inquiriesClient,
                               CredentialVault vault) {
        this.ordersClient = ordersClient;
        this.inquiriesClient = inquiriesClient;
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
                Set.of(DataType.ORDER_SUMMARY, DataType.INQUIRY),
                // INQUIRY stays NEEDS_VERIFICATION until a gated live run collects on a real account.
                // The code being written is not the evidence; only a live run promotes this.
                Map.of(DataType.ORDER_SUMMARY, "CONFIRMED",
                        DataType.INQUIRY, "NEEDS_VERIFICATION"),
                "ORDER_SUMMARY via the official v5 ordersheets day-paging flow"
                        + " (createdAt window ≤31d, per-status sweep, nextToken paging)."
                        + " INQUIRY via the official v5 onlineInquiries 상품별 고객문의 flow"
                        + " (inquiryAt window ≤7d, answered-bucket sweep, pageNum paging);"
                        + " the PII-bearing 고객센터 callCenterInquiries stream is not called."
                        + " REVIEW has no official Coupang API; PRODUCT/SALES deferred.");
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
        boolean routable = CHANNEL_CODE.equals(request.channelCode())
                && (request.dataType() == DataType.ORDER_SUMMARY || request.dataType() == DataType.INQUIRY);
        if (!routable) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }
        // Credentials open once, before either stream's first HTTP call — the fail-closed ordering
        // is the same for both: no credential, no request.
        Credential credential = openAndValidate(request.orgId(), request.sellerAccountId());
        try {
            return switch (request.dataType()) {
                case ORDER_SUMMARY -> ordersClient.fetchOrderSummaryPage(
                        credential.accessKey(), credential.secretKey(), credential.vendorId(),
                        request.cursorValue());
                case INQUIRY -> inquiriesClient.fetchInquiryPage(
                        credential.accessKey(), credential.secretKey(), credential.vendorId(),
                        request.cursorValue());
                default -> throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
            };
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
        CredentialProbeResult credential = ordersClient.credentialProbe(accessKey, secretKey, vendorId);
        if (credential.classification() != CredentialProbe.OK) {
            // Diagnosis only: endpoint name + the numeric HTTP status + the safe category. NEVER the
            // provider body/header, the Authorization signature, or any credential.
            log.warn("Coupang credential probe not-OK: endpoint=returnShippingCenters httpStatus={} category={}",
                    credential.httpStatus(), credential.classification());
        }
        return switch (credential.classification()) {
            // Credential + IP accepted — now answer the separate order-access question.
            case OK -> orderAccessOutcome(accessKey, secretKey, vendorId);
            // A non-IP 403 means the signature WAS accepted (else 401); the credential is valid, so
            // let the order probe answer authoritatively rather than blocking it here.
            case INCONCLUSIVE_FORBIDDEN -> orderAccessOutcome(accessKey, secretKey, vendorId);
            case INVALID -> VerifyOutcome.failed(VerifyOutcome.REASON_INVALID_CREDENTIAL);
            case IP_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
            case RATE_LIMITED -> VerifyOutcome.failed(VerifyOutcome.REASON_TEMPORARY_PROVIDER_ERROR);
            // returnShippingCenters gave no authoritative auth verdict (a non-401/403 4xx, a 5xx, or —
            // for TRANSPORT_ERROR — no response at all). The credential may still be valid, so consult
            // the endpoint we actually need (ordersheets) as an auxiliary read-only probe rather than
            // blocking on an endpoint that may simply be unsuitable for this vendor.
            case CLIENT_ERROR, SERVER_ERROR -> auxiliaryOrderAccessOutcome(accessKey, secretKey, vendorId);
            // A transport failure is systemic (the gateway was unreachable) — the auxiliary probe would
            // hit the same wall. Report it honestly rather than issuing a second doomed call.
            case TRANSPORT_ERROR -> VerifyOutcome.failed(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
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
        return switch (orderAccessProbe(accessKey, secretKey, vendorId).classification()) {
            case CONFIRMED, RATE_LIMITED, UNAVAILABLE -> VerifyOutcome.success();
            case CALL_IP_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
            case ACCESS_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_ORDER_ACCESS_DENIED);
        };
    }

    /**
     * Auxiliary order-access probe — the fallback when {@code returnShippingCenters} gave no
     * authoritative credential verdict (a 400/404 or a 5xx), because that endpoint may be unsuitable
     * for this vendor. Here the credential is NOT yet proven, so — unlike {@link #orderAccessOutcome}
     * — an inconclusive order probe must NOT be upgraded to success: only a real {@code ordersheets}
     * 200 proves the HMAC credential the return-centers endpoint couldn't. A 403 still yields the
     * authoritative call-IP / hedged order-access verdict; a throttle / 5xx / transport failure stays
     * the honest {@code PROVIDER_UNAVAILABLE} (never fabricated into a success or an INVALID_CREDENTIAL).
     */
    private VerifyOutcome auxiliaryOrderAccessOutcome(String accessKey, String secretKey, String vendorId) {
        return switch (orderAccessProbe(accessKey, secretKey, vendorId).classification()) {
            case CONFIRMED -> VerifyOutcome.success();
            case CALL_IP_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH);
            case ACCESS_DENIED -> VerifyOutcome.failed(VerifyOutcome.REASON_ORDER_ACCESS_DENIED);
            case RATE_LIMITED, UNAVAILABLE -> VerifyOutcome.failed(VerifyOutcome.REASON_PROVIDER_UNAVAILABLE);
        };
    }

    /** Run the read-only order-access probe and log its outcome sanitized (status + category only). */
    private OrderAccessResult orderAccessProbe(String accessKey, String secretKey, String vendorId) {
        OrderAccessResult order = ordersClient.probeOrderAccess(accessKey, secretKey, vendorId);
        if (order.classification() != OrderAccessProbe.CONFIRMED) {
            log.warn("Coupang order-access probe not-confirmed: endpoint=ordersheets httpStatus={} category={}",
                    order.httpStatus(), order.classification());
        }
        return order;
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
