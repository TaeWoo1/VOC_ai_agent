package com.sellerops.review.triage.eval;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The JavaScript that DREW the calibration sample and the Java that WEIGHTS it must agree.
 *
 * <p>A disagreement would not fail anything visibly: the harness would divide each row by an
 * inclusion probability the row was never drawn under, and every population number would be wrong by
 * a factor nobody could see. These are the committed vectors from
 * {@code tools/review-triage-calibration/parity-vectors.json}, which the JavaScript side generated —
 * synthetic fingerprints and synthetic bodies, no seller data.
 *
 * <p>This test runs in CI. It touches no database and reads no review.
 */
class CalibrationSampleTest {

    private static final Path VECTORS =
            Path.of("..", "tools", "review-triage-calibration", "parity-vectors.json");

    private static JsonNode vectors() throws Exception {
        return new ObjectMapper().readTree(Files.readString(VECTORS));
    }

    @Test
    @DisplayName("the draw order and the DEV/HOLDOUT split reproduce the JavaScript byte for byte")
    void orderAndSplitMatchTheDrawingSide() throws Exception {
        JsonNode order = vectors().path("order");
        assertThat(order).isNotEmpty();
        for (JsonNode vector : order) {
            String fingerprint = vector.path("fingerprint").asText();
            assertThat(CalibrationSample.sampleOrderKey(fingerprint))
                    .as("sample order key")
                    .isEqualTo(vector.path("sampleOrderKey").asText());
            assertThat(CalibrationSample.splitOf(fingerprint))
                    .as("split")
                    .isEqualTo(vector.path("split").asText());
        }
    }

    /**
     * The vector set includes an all-{@code f} fingerprint on purpose. Java's {@code byte} is signed,
     * so an unmasked {@code digest[0] % 2} yields {@code -1} for any high byte and would sort roughly
     * half the corpus into the wrong half of the split — a bug that produces a plausible-looking
     * 50/50 report while measuring the wrong rows.
     */
    @Test
    @DisplayName("a first digest byte above 127 splits the same way on both sides")
    void theSplitReadsTheFirstByteUnsigned() throws Exception {
        int highBytes = 0;
        for (JsonNode vector : vectors().path("order")) {
            if (vector.path("splitFirstByte").asInt() < 128) {
                continue;
            }
            highBytes++;
            assertThat(CalibrationSample.splitOf(vector.path("fingerprint").asText()))
                    .as("a fingerprint whose split digest starts above 0x7f")
                    .isEqualTo(vector.path("split").asText());
        }
        // Without a vector in this range the assertion above never runs, and an unmasked signed read
        // — which yields -1 for every high byte and buckets those rows all one way — would pass the
        // whole file. The coverage is the point of the test, so it is asserted rather than assumed.
        assertThat(highBytes).as("vectors covering a first byte above 127").isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("the vectors exercise both halves of the split")
    void theVectorsCoverBothHalves() throws Exception {
        assertThat(vectors().path("order")).isNotEmpty();
        assertThat(vectors().path("order").findValuesAsText("split"))
                .contains("DEV", "HOLDOUT");
    }

    @Test
    @DisplayName("a stratum is decided by rating band and code points, not UTF-16 units")
    void strataMatchTheDrawingSide() throws Exception {
        JsonNode strata = vectors().path("strata");
        assertThat(strata).isNotEmpty();
        for (JsonNode vector : strata) {
            Integer rating = vector.path("rating").isNull() ? null : vector.path("rating").asInt();
            String body = vector.path("body").asText();
            String expected = vector.path("stratum").isNull() ? null : vector.path("stratum").asText();
            assertThat(CalibrationSample.stratumOf(rating, body))
                    .as("%s", vector.path("note").asText())
                    .isEqualTo(expected);
        }
    }

    @Test
    @DisplayName("the allocation is the one the contract pre-committed")
    void theAllocationIsTheCommittedOne() {
        assertThat(CalibrationSample.STRATA).hasSize(9);
        assertThat(CalibrationSample.ALLOCATION.keySet())
                .containsExactlyInAnyOrderElementsOf(CalibrationSample.STRATA);
        // The 4-5* bands are the only sampled ones; everything below 4* is censused because the
        // frame holds barely a hundred such reviews and sampling there would throw away the scarce
        // class. If one of these ever became finite, the contract changed and this test should not
        // have stayed green.
        assertThat(CalibrationSample.ALLOCATION.get("LOW_S")).isEqualTo(Integer.MAX_VALUE);
        assertThat(CalibrationSample.ALLOCATION.get("MID_L")).isEqualTo(Integer.MAX_VALUE);
        assertThat(CalibrationSample.ALLOCATION.get("HIGH_S")).isEqualTo(30);
        assertThat(CalibrationSample.ALLOCATION.get("HIGH_M")).isEqualTo(40);
        assertThat(CalibrationSample.ALLOCATION.get("HIGH_L")).isEqualTo(45);
    }
}
