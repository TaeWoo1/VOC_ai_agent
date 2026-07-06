package com.sellerops.inquiry.esmimport.dto;

import com.sellerops.inquiry.esmimport.EsmMarketplace;

/**
 * Add or update one marketplace's selling id on an existing file-import account. The
 * account is identified by the path, never the body; only the non-secret selling id is
 * carried.
 */
public record EsmFileImportIdentityRequest(
        EsmMarketplace marketplace,
        String sellerId) {
}
