package com.sellerops.collect.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.DataType;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Locks the critical rule: {@code RunOutcome.RATE_LIMITED} is never written to
 * {@code sync_jobs.status}; the status set stays the existing four values and rate limiting
 * is carried by {@code rate_limited=true} + a failure code.
 */
class RunOutcomeStatusMappingTest {

    private static final Set<String> PERSISTED_STATUSES = Set.of("RUNNING", "SUCCESS", "PARTIAL", "FAILED");

    private ConnectorResult result(int success, int skipped, int failed, boolean rateLimited, boolean errored) {
        return ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                success, skipped, failed, rateLimited, errored, null);
    }

    @Test
    void successMapsToSuccess() {
        assertThat(result(5, 0, 0, false, false).jobStatus()).isEqualTo("SUCCESS");
    }

    @Test
    void partialMapsToPartial() {
        assertThat(result(3, 0, 2, false, false).jobStatus()).isEqualTo("PARTIAL");
    }

    @Test
    void failedMapsToFailed() {
        assertThat(result(0, 0, 3, false, false).jobStatus()).isEqualTo("FAILED");
    }

    @Test
    void rateLimitedIsNeverAStatusValue() {
        ConnectorResult withData = result(5, 0, 0, true, false);
        ConnectorResult noData = result(0, 0, 0, true, false);

        // RATE_LIMITED is the in-code outcome...
        assertThat(withData.outcome()).isEqualTo(RunOutcome.RATE_LIMITED);
        assertThat(noData.outcome()).isEqualTo(RunOutcome.RATE_LIMITED);

        // ...but the persisted status is one of the existing four, never "RATE_LIMITED".
        assertThat(withData.jobStatus()).isEqualTo("PARTIAL");
        assertThat(noData.jobStatus()).isEqualTo("FAILED");
        assertThat(withData.jobStatus()).isNotEqualTo("RATE_LIMITED");
        assertThat(noData.jobStatus()).isNotEqualTo("RATE_LIMITED");
    }

    @Test
    void rateLimitIsCarriedByFlagAndCode() {
        ConnectorResult r = result(0, 0, 0, true, false);
        assertThat(r.rateLimited()).isTrue();
        assertThat(r.failureCode()).isEqualTo("RATE_LIMITED");
    }

    @Test
    void jobStatusAlwaysWithinPersistedStatusSet() {
        ConnectorResult[] cases = {
                result(5, 0, 0, false, false),
                result(3, 1, 2, false, false),
                result(0, 0, 3, false, false),
                result(5, 0, 0, true, false),
                result(0, 0, 0, true, false),
                result(0, 1, 0, false, true),
                result(0, 0, 0, false, true)
        };
        for (ConnectorResult r : cases) {
            assertThat(PERSISTED_STATUSES).contains(r.jobStatus());
        }
    }
}
