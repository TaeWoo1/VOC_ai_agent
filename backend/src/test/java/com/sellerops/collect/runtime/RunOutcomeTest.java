package com.sellerops.collect.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RunOutcomeTest {

    @Test
    void cleanRunIsSuccess() {
        assertThat(RunOutcome.classify(5, 2, 0, false, false)).isEqualTo(RunOutcome.SUCCESS);
    }

    @Test
    void emptyCleanRunIsSuccess() {
        assertThat(RunOutcome.classify(0, 0, 0, false, false)).isEqualTo(RunOutcome.SUCCESS);
    }

    @Test
    void failuresWithDataIsPartial() {
        assertThat(RunOutcome.classify(3, 0, 2, false, false)).isEqualTo(RunOutcome.PARTIAL);
    }

    @Test
    void onlyFailuresIsFailed() {
        assertThat(RunOutcome.classify(0, 0, 4, false, false)).isEqualTo(RunOutcome.FAILED);
    }

    @Test
    void erroredWithSkipsIsPartial() {
        assertThat(RunOutcome.classify(0, 1, 0, false, true)).isEqualTo(RunOutcome.PARTIAL);
    }

    @Test
    void erroredWithNothingIsFailed() {
        assertThat(RunOutcome.classify(0, 0, 0, false, true)).isEqualTo(RunOutcome.FAILED);
    }

    @Test
    void rateLimitedClassifiesAsRateLimitedRegardlessOfRows() {
        assertThat(RunOutcome.classify(5, 0, 0, true, false)).isEqualTo(RunOutcome.RATE_LIMITED);
        assertThat(RunOutcome.classify(0, 0, 0, true, false)).isEqualTo(RunOutcome.RATE_LIMITED);
        // Rate limit wins even if rows also failed.
        assertThat(RunOutcome.classify(0, 0, 3, true, true)).isEqualTo(RunOutcome.RATE_LIMITED);
    }
}
