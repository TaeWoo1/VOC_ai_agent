package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.DataType;
import org.junit.jupiter.api.Test;

/**
 * The acquisition registry is a list of PROVEN routes, not a list of intentions. These assertions pin
 * that: the one entry that exists names its evidence, and everything else answers empty rather than
 * optimistically.
 */
class AcquisitionPathRegistryTest {

    @Test
    void coupangReviewIsAcquiredThroughTheActionWindow() {
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG", DataType.REVIEW))
                .singleElement()
                .satisfies(path -> {
                    assertThat(path.method()).isEqualTo("ACTION_WINDOW");
                    // LIVE_PROVEN is a claim about evidence: docs/coupang_review_locate_ux_v1.md §5.1.
                    assertThat(path.verificationStatus()).isEqualTo("LIVE_PROVEN");
                });
    }

    @Test
    void everythingElseIsEmpty() {
        // Same channel, other types.
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG", DataType.ORDER_SUMMARY)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG", DataType.INQUIRY)).isEmpty();
        // Same type, other channels — including NAVER, which also has no review API but has no proven
        // acquisition path either. Absence of an API must not be read as presence of another route.
        assertThat(AcquisitionPathRegistry.pathsFor("NAVER", DataType.REVIEW)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor("CAFE24", DataType.REVIEW)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor("GMARKET", DataType.REVIEW)).isEmpty();
    }

    @Test
    void unknownAndNullInputsAnswerEmptyRatherThanThrowing() {
        assertThat(AcquisitionPathRegistry.pathsFor("NOT_A_CHANNEL", DataType.REVIEW)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor(null, DataType.REVIEW)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG", null)).isEmpty();
    }

    @Test
    void theRegistryIsCaseAndCodeExact() {
        // Channel codes are the catalog's own uppercase codes; a near-miss must not match, because a
        // silent match would attach one channel's proof to another.
        assertThat(AcquisitionPathRegistry.pathsFor("coupang", DataType.REVIEW)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG ", DataType.REVIEW)).isEmpty();
    }
}
