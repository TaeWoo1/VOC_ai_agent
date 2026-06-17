package com.sellerops.connector.esm;

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
 * The real ESM Trading API connector — ONE connector for both Gmarket and
 * Auction, because the official API family is shared: a single credential
 * (ESM+ Master ID + issued secret key) signs one JWT whose {@code ssi} claim
 * carries both marketplaces' seller ids. Phase 3D-4 is the <b>JWT auth
 * skeleton only</b>: capabilities expose <b>no collectable data type</b>, so
 * neither the scheduler nor manual sync can reach an unimplemented fetch path.
 * The bean exists only behind {@code sellerops.connector.esm.enabled=true}
 * ({@link EsmConnectorConfiguration}); with the flag off, GMARKET keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p><b>Channel-catalog note:</b> the current catalog models G마켓/옥션 as the
 * single channel code {@code GMARKET} (there is no {@code AUCTION} code), so
 * this connector dedicates to {@code GMARKET} only. If a separate AUCTION
 * channel is ever introduced (a channel-catalog change needing its own
 * approval), it is added to {@link #dedicatedChannels()} — the shared
 * credential and {@code ssi} claim already carry both seller ids, so no
 * auth redesign is required.
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → schema-pending stop. ESM
 * auth is a self-signed JWT — there is no token endpoint, so the skeleton
 * performs no HTTP at all; the signer is proven offline in its own tests.
 * Order/inquiry/product endpoint schemas are later, separately approved
 * slices; no official review API is documented.
 */
public class EsmApiConnector implements PullConnector {

    public static final String KIND = "ESM_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "GMARKET";

    /**
     * Held for the order-collection slice; the skeleton's tests pass a throwing
     * fake to prove no fetch path can reach it.
     */
    @SuppressWarnings("unused")
    private final EsmHttpClient http;
    private final CredentialVault vault;

    public EsmApiConnector(EsmHttpClient http, CredentialVault vault) {
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
                "Phase 3D-4 auth skeleton: no collectable data type yet."
                        + " One shared ESM connector for Gmarket/Auction (catalog models both"
                        + " as GMARKET). Order/inquiry/product schemas land in later approved"
                        + " slices; no official review API is documented.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before anything else: vault.open throws when no credential
        // row exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        String masterId = credential.secrets().get("master_id");
        String secretKey = credential.secrets().get("secret_key");
        // The issuer is the service domain registered at key issuance — part of
        // the credential application, hence credential-scoped, never config.
        String issuer = credential.secrets().get("issuer");
        // The catalog channel is GMARKET, so its seller id is required; the
        // Auction id is optional and joins the ssi claim when present.
        String gmarketSellerId = credential.secrets().get("gmarket_seller_id");
        if (isBlank(masterId) || isBlank(secretKey) || isBlank(issuer) || isBlank(gmarketSellerId)) {
            throw new IllegalStateException(
                    "ESM 자격 증명에 master_id, secret_key, issuer 또는 gmarket_seller_id가 없습니다.");
        }

        throw new IllegalStateException(
                "ESM 주문 수집은 아직 구현되지 않았습니다 (Phase 3D-4 인증 스켈레톤 — 주문 스키마는 다음 슬라이스).");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
