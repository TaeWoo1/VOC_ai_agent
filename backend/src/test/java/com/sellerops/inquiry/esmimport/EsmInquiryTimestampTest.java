package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/** ESM timezone-less timestamps are read as Asia/Seoul (UTC+9) and converted to UTC. */
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
    void rejectsMalformedTimestamp() {
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("2026/07/01 09:00"))
                .isInstanceOf(Exception.class);
        assertThatThrownBy(() -> EsmInquiryTimestamp.toInstant("not a date"))
                .isInstanceOf(Exception.class);
    }
}
