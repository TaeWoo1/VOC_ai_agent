package com.sellerops.inquiry.esmimport;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;

/**
 * Parses an ESM inquiry timestamp (접수일시 / 처리일시). ESM exports the value as a
 * timezone-less local string in one of two equivalent separators — dash
 * {@code yyyy-MM-dd HH:mm:ss} or dot {@code yyyy.MM.dd HH:mm:ss} — and nothing else.
 * Both are parsed <b>strictly</b> ({@link ResolverStyle#STRICT} with {@code uuuu}), so a
 * slash separator, a missing component (e.g. no seconds), or an invalid calendar date
 * (e.g. {@code 2026-02-30}) is rejected rather than silently coerced. No lenient date
 * guessing is added.
 *
 * <p>ESM is a Korea-only platform, so a bare local timestamp is interpreted as
 * {@code Asia/Seoul} (a documented, platform-specific policy) and converted to a
 * canonical UTC {@link Instant} via {@link #toInstant}. Separately, {@link #canonical}
 * yields a <b>separator-independent</b> {@code yyyy-MM-dd HH:mm:ss} local string: the
 * fingerprint uses this canonical form (not the lexical raw string) so dot- and dash-form
 * exports of the same local time fingerprint identically. The exact original string is
 * preserved verbatim in provenance — never here.
 */
public final class EsmInquiryTimestamp {

    public static final ZoneId ESM_ZONE = ZoneId.of("Asia/Seoul");

    // Accepted inputs, strict. `uuuu` (not `yyyy`) so STRICT can resolve the year and
    // reject invalid calendar dates like 2026-02-30 instead of coercing them.
    private static final DateTimeFormatter DASH = strict("uuuu-MM-dd HH:mm:ss");
    private static final DateTimeFormatter DOT = strict("uuuu.MM.dd HH:mm:ss");

    // Canonical, separator-independent local form (always dash).
    private static final DateTimeFormatter CANONICAL = strict("uuuu-MM-dd HH:mm:ss");

    private EsmInquiryTimestamp() {
    }

    /**
     * Parse a nonblank dash- or dot-separated {@code yyyy-MM-dd HH:mm:ss} string as a
     * strict local timestamp. Throws {@link DateTimeParseException} on any other shape
     * (slash separator, missing component, or invalid calendar date).
     */
    public static LocalDateTime parseLocal(String raw) {
        String s = raw.strip();
        try {
            return LocalDateTime.parse(s, DASH);
        } catch (DateTimeParseException dash) {
            try {
                return LocalDateTime.parse(s, DOT);
            } catch (DateTimeParseException dot) {
                throw dash;   // report against the canonical (dash) shape
            }
        }
    }

    /** Parse a dash- or dot-form timestamp as Asia/Seoul → canonical UTC instant. */
    public static Instant toInstant(String raw) {
        return parseLocal(raw).atZone(ESM_ZONE).toInstant();
    }

    /**
     * Separator-independent canonical local form ({@code yyyy-MM-dd HH:mm:ss}) of a valid
     * timestamp — identical for the dot- and dash-form representations of the same local
     * time. Used by the fingerprint so equivalent representations collapse to one identity.
     */
    public static String canonical(String raw) {
        return parseLocal(raw).format(CANONICAL);
    }

    private static DateTimeFormatter strict(String pattern) {
        return DateTimeFormatter.ofPattern(pattern).withResolverStyle(ResolverStyle.STRICT);
    }
}
