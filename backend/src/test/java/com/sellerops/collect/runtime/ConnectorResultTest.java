package com.sellerops.collect.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.DataType;
import org.junit.jupiter.api.Test;

class ConnectorResultTest {

    @Test
    void ofComputesTotalAndOutcome() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.MANUAL_UPLOAD,
                7, 2, 1, false, false, null);
        assertThat(r.totalRows()).isEqualTo(10);
        assertThat(r.outcome()).isEqualTo(RunOutcome.PARTIAL);
        assertThat(r.method()).isEqualTo(CollectionMethod.MANUAL_UPLOAD);
        assertThat(r.dataType()).isEqualTo(DataType.REVIEW);
    }

    @Test
    void rateLimitedDefaultsFailureCode() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.ORDER_SUMMARY, CollectionMethod.API,
                0, 0, 0, true, false, null);
        assertThat(r.failureCode()).isEqualTo("RATE_LIMITED");
        assertThat(r.rateLimited()).isTrue();
    }

    @Test
    void explicitFailureCodePreserved() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                0, 0, 2, false, true, "PROVIDER_UNAVAILABLE");
        assertThat(r.failureCode()).isEqualTo("PROVIDER_UNAVAILABLE");
        assertThat(r.outcome()).isEqualTo(RunOutcome.FAILED);
    }

    @Test
    void notAttemptedHasNoPersistedStatus() {
        ConnectorResult r = new ConnectorResult("NAVER", DataType.REVIEW, CollectionMethod.API,
                RunOutcome.NOT_ATTEMPTED, 0, 0, 0, 0, false, null);
        assertThatThrownBy(r::jobStatus).isInstanceOf(IllegalStateException.class);
    }
}
