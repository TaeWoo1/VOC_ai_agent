package com.sellerops.collect.runtime;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.UUID;

/**
 * The ONLY shape allowed to leave the runtime for a log, metric, or API response. It
 * emits coarse buckets, enum names, booleans, and a 16-hex salted hash — never a raw row
 * count, identifier, file name, or error message. The exposed field names are pinned by
 * {@link #KEYS} so a no-leak test can assert the surface never widens.
 */
public record SanitizedRunView(
        String channelCode,
        String dataType,
        String method,
        String outcome,
        String totalRowsBucket,
        String successRowsBucket,
        String skippedRowsBucket,
        String failedRowsBucket,
        boolean rateLimited,
        boolean hasFailure,
        String failureCode,
        String syncJobIdHash16) {

    /** Allow-listed field names — the no-leak test asserts the view exposes exactly these. */
    public static final List<String> KEYS = List.of(
            "channelCode", "dataType", "method", "outcome",
            "totalRowsBucket", "successRowsBucket", "skippedRowsBucket", "failedRowsBucket",
            "rateLimited", "hasFailure", "failureCode", "syncJobIdHash16");

    /**
     * Project a {@link ConnectorResult} (which holds raw counts) into the sanitized view.
     * {@code salt} keeps the {@code syncJobId} hash non-reversible; {@code syncJobId} may
     * be null (e.g. a run that never opened), yielding a null hash.
     */
    public static SanitizedRunView of(ConnectorResult r, UUID syncJobId, String salt) {
        return new SanitizedRunView(
                r.channelCode(),
                r.dataType().name(),
                r.method().name(),
                r.outcome().name(),
                RowCountBucket.of(r.totalRows()).name(),
                RowCountBucket.of(r.successRows()).name(),
                RowCountBucket.of(r.skippedRows()).name(),
                RowCountBucket.of(r.failedRows()).name(),
                r.rateLimited(),
                r.failedRows() > 0 || r.outcome() == RunOutcome.FAILED,
                r.failureCode(),
                hash16(salt, syncJobId));
    }

    private static String hash16(String salt, UUID syncJobId) {
        if (syncJobId == null) {
            return null;
        }
        String basis = (salt == null ? "" : salt) + " " + syncJobId;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(basis.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
