package com.sellerops.inquiry.esmimport;

/**
 * The two ESM+ marketplaces that share the single {@code GMARKET} channel. The ESM
 * inquiry export never identifies which marketplace a file belongs to, so the
 * operator selects exactly one at upload; it is bound into the preview token and
 * every provenance row. Each marketplace maps to the credential-vault field holding
 * that account's configured selling id (판매아이디), used to fail-closed cross-check the
 * file against the selected connection.
 */
public enum EsmMarketplace {

    GMARKET("gmarket_seller_id"),
    AUCTION("auction_seller_id");

    private final String sellerIdSecretKey;

    EsmMarketplace(String sellerIdSecretKey) {
        this.sellerIdSecretKey = sellerIdSecretKey;
    }

    /** The credential-vault secret key holding this marketplace's configured selling id. */
    public String sellerIdSecretKey() {
        return sellerIdSecretKey;
    }
}
