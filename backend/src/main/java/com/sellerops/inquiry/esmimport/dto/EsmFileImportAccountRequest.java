package com.sellerops.inquiry.esmimport.dto;

import com.sellerops.inquiry.esmimport.EsmMarketplace;

/**
 * Operator request to provision a truthful <b>file-import-only</b> ESM (G마켓/옥션)
 * SellerAccount. Carries only the non-secret marketplace selling id — never an ESM
 * password, browser credential, 2FA value, or API secret.
 */
public record EsmFileImportAccountRequest(
        EsmMarketplace marketplace,
        String alias,
        String sellerId) {
}
