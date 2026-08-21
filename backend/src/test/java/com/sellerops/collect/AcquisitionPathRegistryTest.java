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
                    // LIVE_PROVEN is a claim about evidence, and about the evidence for THIS claim:
                    // docs/coupang_review_acquisition_v1.md §6.6 (22 stored), not the locate re-proof,
                    // which deliberately stored nothing.
                    assertThat(path.verificationStatus()).isEqualTo("LIVE_PROVEN");
                    // Not SCHEDULED, and never will be: Coupang publishes no seller review API, so
                    // new 상품평 arrive when the seller opens the window and not otherwise. Rendering
                    // this as an ordinary sync would promise a refresh nobody can deliver.
                    assertThat(path.recurrence()).isEqualTo("SELLER_REPEATED");
                });
    }

    /**
     * NAVER's Seller Center export is the product's real review source and went unregistered until
     * 2026-08-22 — while every one of the demo org's 3,858 real NAVER reviews had arrived through it.
     * The one surface that exists to say how a type is acquired said nothing for the channel carrying
     * the most review data in the system, so a corpus with no schedule read as though it had one.
     */
    @Test
    void naverReviewIsAcquiredThroughTheSellerCenterExport() {
        assertThat(AcquisitionPathRegistry.pathsFor("NAVER", DataType.REVIEW))
                .singleElement()
                .satisfies(path -> {
                    assertThat(path.method()).isEqualTo("EXPORT");
                    assertThat(path.verificationStatus()).isEqualTo("LIVE_PROVEN");
                    assertThat(path.recurrence()).isEqualTo("SELLER_REPEATED");
                });
    }

    /**
     * No entry anywhere claims SCHEDULED, and that is a fact about the channels rather than a gap in
     * the product: this registry exists precisely for types their channel does NOT serve by API. An
     * entry claiming an unattended schedule here would be describing the pull connector, which has its
     * own answer and must not be restated.
     */
    @Test
    void noRegisteredPathClaimsToRunUnattended() {
        for (String channel : new String[] {"COUPANG", "NAVER", "CAFE24"}) {
            for (DataType type : DataType.values()) {
                assertThat(AcquisitionPathRegistry.pathsFor(channel, type))
                        .allSatisfy(p -> assertThat(p.recurrence()).isNotEqualTo("SCHEDULED"));
            }
        }
    }

    @Test
    void everythingElseIsEmpty() {
        // Same channel, other types.
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG", DataType.ORDER_SUMMARY)).isEmpty();
        assertThat(AcquisitionPathRegistry.pathsFor("COUPANG", DataType.INQUIRY)).isEmpty();
        // NAVER INQUIRY has no API and no proven alternative route either — absence of an API must
        // not be read as presence of another one. The demo org's 8 NAVER inquiries were seed rows.
        assertThat(AcquisitionPathRegistry.pathsFor("NAVER", DataType.INQUIRY)).isEmpty();
        // Cafe24 serves reviews through its own connector (board 4), and the registry deliberately
        // does not restate what the pull connector already answers.
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
