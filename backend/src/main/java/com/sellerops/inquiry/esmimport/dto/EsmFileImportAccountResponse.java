package com.sellerops.inquiry.esmimport.dto;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.inquiry.esmimport.EsmMarketplace;
import java.util.UUID;

/**
 * Sanitized result of provisioning a file-import ESM account. {@code connectionStatus}
 * is {@code FILE_UPLOAD_SUPPORTED} (never {@code CONNECTED}) so no surface claims a live
 * marketplace connection; {@code fileUpload} is true. The selling id is returned only as
 * a non-reversible SHA-256 prefix for a masked match check — never the raw value.
 * {@code idempotentReplay} is true when an exact prior create (same org + marketplace +
 * selling id on a file-import GMARKET account) was found and returned unchanged.
 */
public record EsmFileImportAccountResponse(
        UUID sellerAccountId,
        EsmMarketplace marketplace,
        ChannelStatus connectionStatus,
        boolean fileUpload,
        String sellerIdSha256Prefix,
        boolean idempotentReplay) {
}
