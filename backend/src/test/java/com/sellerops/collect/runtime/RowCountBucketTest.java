package com.sellerops.collect.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RowCountBucketTest {

    @Test
    void mapsCountsToBoundaries() {
        assertThat(RowCountBucket.of(-3)).isEqualTo(RowCountBucket.ZERO);
        assertThat(RowCountBucket.of(0)).isEqualTo(RowCountBucket.ZERO);
        assertThat(RowCountBucket.of(1)).isEqualTo(RowCountBucket.ONE);
        assertThat(RowCountBucket.of(2)).isEqualTo(RowCountBucket.FEW);
        assertThat(RowCountBucket.of(9)).isEqualTo(RowCountBucket.FEW);
        assertThat(RowCountBucket.of(10)).isEqualTo(RowCountBucket.TENS);
        assertThat(RowCountBucket.of(99)).isEqualTo(RowCountBucket.TENS);
        assertThat(RowCountBucket.of(100)).isEqualTo(RowCountBucket.HUNDREDS);
        assertThat(RowCountBucket.of(999)).isEqualTo(RowCountBucket.HUNDREDS);
        assertThat(RowCountBucket.of(1000)).isEqualTo(RowCountBucket.THOUSANDS_PLUS);
        assertThat(RowCountBucket.of(50_000)).isEqualTo(RowCountBucket.THOUSANDS_PLUS);
    }
}
