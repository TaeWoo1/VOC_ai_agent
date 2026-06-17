package com.sellerops.ingest.parse;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;

/** Lenient date parsing for operator-provided exports (KO/EN common formats). */
public final class DateParse {

    private static final List<DateTimeFormatter> FORMATS = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("yyyy.MM.dd"),
            DateTimeFormatter.ofPattern("yyyyMMdd"));

    private DateParse() {
    }

    /** Parse a date; throws IllegalArgumentException if no format matches. */
    public static LocalDate localDate(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("날짜가 비어 있습니다.");
        }
        // Trim a trailing time component if present ("2026-06-01 13:00" / "2026-06-01T..").
        String token = raw.strip().split("[ T]")[0];
        // NAVER seller-center exports dates as "yyyy.MM.dd." (trailing dot after the day);
        // strip it so the existing yyyy.MM.dd formatter matches. No currently valid format
        // ends in a dot, so this is backward-compatible.
        if (token.endsWith(".")) {
            token = token.substring(0, token.length() - 1);
        }
        for (DateTimeFormatter fmt : FORMATS) {
            try {
                return LocalDate.parse(token, fmt);
            } catch (Exception ignored) {
                // try next
            }
        }
        throw new IllegalArgumentException("날짜 형식을 인식할 수 없습니다: " + raw);
    }

    /** Parse a date to an Instant at start-of-day UTC. */
    public static java.time.Instant instantAtStartOfDay(String raw) {
        return localDate(raw).atStartOfDay(ZoneOffset.UTC).toInstant();
    }
}
