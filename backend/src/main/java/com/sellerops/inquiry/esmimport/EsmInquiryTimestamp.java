package com.sellerops.inquiry.esmimport;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Parses an ESM inquiry timestamp. ESM exports 접수일시/처리일시 as a timezone-less
 * {@code yyyy-MM-dd HH:mm:ss} string; ESM is a Korea-only platform, so a bare local
 * timestamp is interpreted as {@code Asia/Seoul} (a documented, platform-specific
 * policy) and converted to a canonical UTC {@link Instant}. The exact raw string is
 * preserved verbatim elsewhere (provenance + fingerprint) — this only produces the
 * canonical instant; it never widens or reduces precision.
 */
public final class EsmInquiryTimestamp {

    public static final ZoneId ESM_ZONE = ZoneId.of("Asia/Seoul");

    private static final DateTimeFormatter FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private EsmInquiryTimestamp() {
    }

    /**
     * Parse a nonblank {@code yyyy-MM-dd HH:mm:ss} string as Asia/Seoul → UTC instant.
     * Throws {@link java.time.format.DateTimeParseException} on any other shape.
     */
    public static Instant toInstant(String raw) {
        LocalDateTime local = LocalDateTime.parse(raw.strip(), FORMAT);
        return local.atZone(ESM_ZONE).toInstant();
    }
}
