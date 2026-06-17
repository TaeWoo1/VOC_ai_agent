package com.sellerops.connector.elevenst;

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
 * The real 11st (11번가) Seller Open API connector. Phase 3D-5 is the
 * <b>static-key auth skeleton only</b>: capabilities expose <b>no collectable
 * data type</b>, so neither the scheduler nor manual sync can reach an
 * unimplemented fetch path. The bean exists only behind
 * {@code sellerops.connector.elevenst.enabled=true}
 * ({@link ElevenstConnectorConfiguration}); with the flag off, ELEVENST keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p>Officially documented auth (re-verified 2026-06-12 from
 * openapi.11st.co.kr): a single static 32-char key, sent verbatim as the
 * {@code openapikey} HTTP header — no OAuth, no HMAC, no token endpoint. The
 * key works only from IPs registered at the portal ("IP주소 정보를 입력해야
 * 셀러 API Key 승인이 가능"), which stays an operator setup duty. The
 * credential secret key is named {@code openapikey}, matching the official
 * header name verbatim.
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → schema-pending stop. Since
 * the auth is a static header there is no token round-trip — the skeleton
 * performs no HTTP at all. Order/product/claim — and, notably, 구매후기
 * (purchase-review) + Q&A — APIs exist in the official catalog, but every
 * per-endpoint spec is seller-login-walled, so all fetch schemas are
 * deferred to later, separately approved slices.
 */
public class ElevenstApiConnector implements PullConnector {

    public static final String KIND = "ELEVENST_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "ELEVENST";

    /** The official auth header name, verbatim ("'openapikey:발급key값' 형태로 전송"). */
    public static final String AUTH_HEADER = "openapikey";

    /**
     * Held for the order-collection slice; the skeleton's tests pass a throwing
     * fake to prove no fetch path can reach it.
     */
    @SuppressWarnings("unused")
    private final ElevenstHttpClient http;
    private final CredentialVault vault;

    public ElevenstApiConnector(ElevenstHttpClient http, CredentialVault vault) {
        this.http = http;
        this.vault = vault;
    }

    /**
     * Assembles the per-request auth header map the fetch slices will attach.
     * Fails closed on a blank key — a keyless request would only produce a
     * confusing remote auth error — and never echoes the key in the message.
     */
    public static Map<String, String> authHeaders(String openapikey) {
        if (openapikey == null || openapikey.isBlank()) {
            throw new IllegalStateException("11번가 openapikey가 비어 있습니다.");
        }
        return Map.of(AUTH_HEADER, openapikey);
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
                "Phase 3D-5 auth skeleton: no collectable data type yet."
                        + " Order/product/claim and 구매후기/Q&A APIs exist in the official"
                        + " catalog, but per-endpoint specs are seller-login-walled —"
                        + " schemas land in later approved slices.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before anything else: vault.open throws when no credential
        // row exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        String openapikey = credential.secrets().get("openapikey");
        if (openapikey == null || openapikey.isBlank()) {
            throw new IllegalStateException("11번가 자격 증명에 openapikey가 없습니다.");
        }

        throw new IllegalStateException(
                "11번가 주문 수집은 아직 구현되지 않았습니다 (Phase 3D-5 인증 스켈레톤 — 주문 스키마는 다음 슬라이스).");
    }
}
