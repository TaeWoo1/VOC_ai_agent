package com.sellerops.collect.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.DataType;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SanitizedRunViewTest {

    private final UUID jobId = UUID.fromString("12345678-90ab-cdef-1234-567890abcdef");

    @Test
    void exposesExactlyTheAllowListedKeys() {
        List<String> actual = Arrays.stream(SanitizedRunView.class.getRecordComponents())
                .map(RecordComponent::getName)
                .toList();
        assertThat(actual).containsExactlyInAnyOrderElementsOf(SanitizedRunView.KEYS);
    }

    @Test
    void everyFieldIsBucketEnumBooleanOrHashNeverRawNumberOrId() {
        for (RecordComponent c : SanitizedRunView.class.getRecordComponents()) {
            Class<?> t = c.getType();
            assertThat(t == String.class || t == boolean.class)
                    .as("field %s has type %s; sanitized view must only expose String/boolean", c.getName(), t)
                    .isTrue();
        }
    }

    @Test
    void mapsRawCountsToBuckets() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.SELLER_CENTER_EXPORT,
                1500, 30, 4, false, false, null);
        SanitizedRunView v = SanitizedRunView.of(r, jobId, "salt");
        assertThat(v.totalRowsBucket()).isEqualTo("THOUSANDS_PLUS");
        assertThat(v.successRowsBucket()).isEqualTo("THOUSANDS_PLUS");
        assertThat(v.skippedRowsBucket()).isEqualTo("TENS");
        assertThat(v.failedRowsBucket()).isEqualTo("FEW");
        assertThat(v.hasFailure()).isTrue();
        assertThat(v.channelCode()).isEqualTo("NAVER");
        assertThat(v.method()).isEqualTo("SELLER_CENTER_EXPORT");
    }

    @Test
    void hashesJobIdTo16HexAndHidesRawId() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                5, 0, 0, false, false, null);
        SanitizedRunView v = SanitizedRunView.of(r, jobId, "salt");
        assertThat(v.syncJobIdHash16()).hasSize(16).matches("[0-9a-f]{16}");
        assertThat(v.toString()).doesNotContain(jobId.toString());
    }

    @Test
    void saltChangesHash() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                5, 0, 0, false, false, null);
        assertThat(SanitizedRunView.of(r, jobId, "s1").syncJobIdHash16())
                .isNotEqualTo(SanitizedRunView.of(r, jobId, "s2").syncJobIdHash16());
    }

    @Test
    void nullJobIdYieldsNullHash() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.REVIEW, CollectionMethod.API,
                5, 0, 0, false, false, null);
        assertThat(SanitizedRunView.of(r, null, "salt").syncJobIdHash16()).isNull();
    }

    @Test
    void rateLimitSurfacesAsBooleanAndCode() {
        ConnectorResult r = ConnectorResult.of("NAVER", DataType.ORDER_SUMMARY, CollectionMethod.API,
                0, 0, 0, true, false, null);
        SanitizedRunView v = SanitizedRunView.of(r, jobId, "salt");
        assertThat(v.rateLimited()).isTrue();
        assertThat(v.failureCode()).isEqualTo("RATE_LIMITED");
        // Outcome enum may read RATE_LIMITED; the persisted status mapping is asserted separately.
        assertThat(v.outcome()).isEqualTo("RATE_LIMITED");
    }
}
