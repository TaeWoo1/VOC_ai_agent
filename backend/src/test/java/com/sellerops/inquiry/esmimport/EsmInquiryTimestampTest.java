package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * ESM timezone-less timestamps come in two equivalent separators — dash
 * {@code yyyy-MM-dd HH:mm:ss} and dot {@code yyyy.MM.dd HH:mm:ss}. Both are read as
 * Asia/Seoul (UTC+9) and converted to UTC; both canonicalize to the same dash form.
 * Parsing is strict: slash separators, missing components, and invalid calendar dates
 * are rejected.
 */
class EsmInquiryTimestampTest {

    @Test
    void interpretsBareTimestampAsSeoulThenUtc() {
        // 09:00 KST == 00:00 UTC.
        assertThat(EsmInquiryTimestamp.toInstant("2026-07-01 09:00:00"))
                .isEqualTo(Instant.parse("2026-07-01T00:00:00Z"));
    }

    @Test
    void keepsSecondPrecision() {
        assertThat(EsmInquiryTimestamp.toInstant("2026-07-01 09:00:37"))
                .isEqualTo(Instant.parse("2026-07-01T00:00:37Z"));
    }

    @Test
    void crossesDayBoundaryCorrectly() {
        // 08:30 KST on the 1st is 23:30 UTC on the previous day.
        assertThat(EsmInquiryTimestamp.toInstant("2026-07-01 08:30:00"))
                .isEqualTo(Instant.parse("2026-06-30T23:30:00Z"));
    }

    @Test
    void parsesDotSeparatedTimestamp() {
        // The actual ESM export uses dots: 2026.07.01 09:00:00 KST == 00:00 UTC.
        assertThat(EsmInquiryTimestamp.toInstant("2026.07.01 09:00:00"))
                .isEqualTo(Instant.parse("2026-07-01T00:00:00Z"));
    }

    @Test
    void dotAndDashOfSameLocalTimeAreEquivalent() {
        String dash = "2026-07-01 09:00:37";
        String dot = "2026.07.01 09:00:37";
        // Same LocalDateTime, same Instant, same canonical form.
        assertThat(EsmInquiryTimestamp.parseLocal(dot)).isEqualTo(EsmInquiryTimestamp.parseLocal(dash));
        assertThat(EsmInquiryTimestamp.toInstant(dot)).isEqualTo(EsmInquiryTimestamp.toInstant(dash));
        assertThat(EsmInquiryTimestamp.canonical(dot)).isEqualTo(EsmInquiryTimestamp.canonical(dash));
    }

    @Test
    void canonicalFormIsAlwaysDashSeparated() {
        assertThat(EsmInquiryTimestamp.canonical("2026.07.01 09:00:37")).isEqualTo("2026-07-01 09:00:37");
        assertThat(EsmInquiryTimestamp.canonical("2026-07-01 09:00:37")).isEqualTo("2026-07-01 09:00:37");
    }

    @Test
    void rejectsSlashSeparatedTimestamp() {
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("2026/07/01 09:00:00"))
                .isInstanceOf(Exception.class);
    }

    @Test
    void rejectsInvalidCalendarDate() {
        // 2026-02-30 does not exist — strict parsing rejects it rather than coercing.
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("2026-02-30 09:00:00"))
                .isInstanceOf(Exception.class);
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("2026.13.01 09:00:00"))
                .isInstanceOf(Exception.class);
    }

    @Test
    void rejectsMissingSeconds() {
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("2026-07-01 09:00"))
                .isInstanceOf(Exception.class);
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("2026.07.01 09:00"))
                .isInstanceOf(Exception.class);
    }

    @Test
    void rejectsMalformedTimestamp() {
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("not a date"))
                .isInstanceOf(Exception.class);
    }
}
