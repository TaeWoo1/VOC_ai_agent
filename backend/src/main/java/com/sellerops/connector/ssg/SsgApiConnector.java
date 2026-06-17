package com.sellerops.connector.ssg;

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
 * The real SSG.COM Open API connector. Phase 3D-6 is the <b>static-key auth
 * skeleton only</b>: capabilities expose <b>no collectable data type</b>, so
 * neither the scheduler nor manual sync can reach an unimplemented fetch
 * path. The bean exists only behind {@code sellerops.connector.ssg.enabled=
 * true} ({@link SsgConnectorConfiguration}) — and, uniquely in Phase 3D,
 * only with an explicit {@code base-url}: the SSG production API host is not
 * publicly printed in the official docs (all endpoint examples are relative
 * paths), so there is no default and startup fails closed without one.
 *
 * <p>Officially documented auth (re-verified 2026-06-13 from
 * eapi.ssgadm.com): every endpoint's request-header table has exactly one
 * auth row — {@code Authorization | string | Y | 업체 인증키} — the raw key
 * as the header value, no Bearer/Basic prefix, no separate vendor/company id
 * anywhere in header, query, or body (vendor identity is implied by the
 * key). The key is issued per company via an MD-department request after the
 * 입점 contract, activated through an email link, and managed (including the
 * access-IP registration that becomes mandatory 2026-06-30) in Partner
 * Office → API 관리 — all operator setup duties. The credential secret key
 * is named {@code auth_key} (the official docs name the value only as the
 * 업체 인증키 carried in {@code Authorization}; they define no snake_case
 * field name).
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → schema-pending stop. Static
 * header auth has no token round-trip, so the skeleton performs no HTTP at
 * all. Order/shipping/claim/settlement, product (v2), unanswered-only 상품
 * Q&A, and 쪽지 APIs exist officially; reviews are confirmed absent from the
 * full catalog. All fetch schemas are deferred to later approved slices.
 */
public class SsgApiConnector implements PullConnector {

    public static final String KIND = "SSG_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "SSG";

    /** The official auth header — the raw 업체 인증키 as the value, no prefix. */
    public static final String AUTH_HEADER = "Authorization";

    /**
     * Held for the order-collection slice; the skeleton's tests pass a throwing
     * fake to prove no fetch path can reach it.
     */
    @SuppressWarnings("unused")
    private final SsgHttpClient http;
    private final CredentialVault vault;

    public SsgApiConnector(SsgHttpClient http, CredentialVault vault) {
        this.http = http;
        this.vault = vault;
    }

    /**
     * Assembles the per-request auth header map the fetch slices will attach.
     * Fails closed on a blank key — a keyless request would only produce a
     * confusing remote auth error — and never echoes the key in the message.
     */
    public static Map<String, String> authHeaders(String authKey) {
        if (authKey == null || authKey.isBlank()) {
            throw new IllegalStateException("SSG 업체 인증키가 비어 있습니다.");
        }
        return Map.of(AUTH_HEADER, authKey);
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
                "Phase 3D-6 auth skeleton: no collectable data type yet."
                        + " Order/shipping/claim/settlement, product, unanswered-only 상품Q&A"
                        + " and 쪽지 APIs exist officially; reviews are confirmed absent."
                        + " Endpoint schemas land in later approved slices.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before anything else: vault.open throws when no credential
        // row exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        String authKey = credential.secrets().get("auth_key");
        if (authKey == null || authKey.isBlank()) {
            throw new IllegalStateException("SSG 자격 증명에 auth_key가 없습니다.");
        }

        throw new IllegalStateException(
                "SSG 주문 수집은 아직 구현되지 않았습니다 (Phase 3D-6 인증 스켈레톤 — 주문 스키마는 다음 슬라이스).");
    }
}
