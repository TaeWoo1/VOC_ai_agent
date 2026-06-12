package com.sellerops.connector.coupang;

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
 * The real Coupang WING Open API connector. Phase 3D-2 is the <b>auth skeleton
 * only</b>: capabilities expose <b>no collectable data type</b>, so neither the
 * scheduler nor manual sync can reach an unimplemented fetch path
 * ({@code requireAutoCollectable} rejects schedule PUTs and the executor's
 * capability gate records a config failure before fetch). The bean exists only
 * behind {@code sellerops.connector.coupang.enabled=true}
 * ({@link CoupangConnectorConfiguration}); with the flag off, COUPANG keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → schema-pending stop. The
 * ORDER_SUMMARY gate lets a direct call prove the credential chain, then stops
 * with a clear schema-pending error — order/ordersheet parsing is a later,
 * separately approved slice. No code path reaches the HTTP boundary in this
 * slice; REVIEW is permanently unsupported (no official review API, verified).
 */
public class CoupangApiConnector implements PullConnector {

    public static final String KIND = "COUPANG_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "COUPANG";

    /**
     * Held for the order-collection slice; the skeleton's tests pass a throwing
     * fake to prove no fetch path can reach it.
     */
    @SuppressWarnings("unused")
    private final CoupangHttpClient http;
    private final CredentialVault vault;

    public CoupangApiConnector(CoupangHttpClient http, CredentialVault vault) {
        this.http = http;
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
                "Phase 3D-2 auth skeleton: no collectable data type yet."
                        + " Ordersheet/inquiry/product schemas land in later approved slices;"
                        + " REVIEW has no official API.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before any HTTP: vault.open throws when no credential row
        // exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        if (isBlank(credential.secrets().get("access_key"))
                || isBlank(credential.secrets().get("secret_key"))
                || isBlank(credential.secrets().get("vendor_id"))) {
            throw new IllegalStateException(
                    "쿠팡 자격 증명에 access_key, secret_key 또는 vendor_id가 없습니다.");
        }

        throw new IllegalStateException(
                "쿠팡 주문 수집은 아직 구현되지 않았습니다 (Phase 3D-2 인증 스켈레톤 — 주문 스키마는 다음 슬라이스).");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
