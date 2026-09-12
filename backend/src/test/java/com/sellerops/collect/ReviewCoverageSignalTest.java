package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.sync.SyncJob;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The coverage derivation, one branch at a time.
 *
 * <p>The cases that matter are the two that are easy to get backwards: a full page of entirely new reviews is
 * the WEAKEST position (nothing said the list ended, and nothing said we caught up), while a page that
 * skipped even one row is the strongest a bounded read can offer. Getting those two the wrong way round would
 * reassure a seller exactly when they should be told to look again.
 */
class ReviewCoverageSignalTest {

    private static SyncJob read(int total, int stored, int skipped, String stopReason) {
        SyncJob j = new SyncJob();
        j.setMethod(CollectionMethod.SELLER_CENTER_READ.name());
        j.setTotalRows(total);
        j.setSuccessRows(stored);
        j.setSkippedRows(skipped);
        j.setErrorMessage(stopReason);
        return j;
    }

    @Test
    @DisplayName("a page that overlapped stored reviews reached known ground, even though it stopped at a bound")
    void overlapBeatsTheBound() {
        assertThat(ReviewCoverageSignal.of(read(9, 0, 9, "PAGE_LIMIT_REACHED")))
                .isEqualTo(ReviewCoverageSignal.REACHED_KNOWN_GROUND);
        assertThat(ReviewCoverageSignal.of(read(10, 9, 1, "PAGE_LIMIT_REACHED")))
                .isEqualTo(ReviewCoverageSignal.REACHED_KNOWN_GROUND);
    }

    @Test
    @DisplayName("a full page of entirely new reviews, stopped at our own bound, may have more behind it")
    void everyRowNewAtTheBoundIsBacklog() {
        assertThat(ReviewCoverageSignal.of(read(10, 10, 0, "PAGE_LIMIT_REACHED")))
                .isEqualTo(ReviewCoverageSignal.BACKLOG_POSSIBLE);
        assertThat(ReviewCoverageSignal.of(read(500, 500, 0, "REVIEW_LIMIT_REACHED")))
                .isEqualTo(ReviewCoverageSignal.BACKLOG_POSSIBLE);
    }

    @Test
    @DisplayName("no stop reason means the pager said this was the last page — there is no tail to miss")
    void aCompletedWalkHasNoTail() {
        assertThat(ReviewCoverageSignal.of(read(10, 10, 0, null)))
                .isEqualTo(ReviewCoverageSignal.REACHED_KNOWN_GROUND);
        assertThat(ReviewCoverageSignal.of(read(10, 10, 0, "  ")))
                .isEqualTo(ReviewCoverageSignal.REACHED_KNOWN_GROUND);
    }

    @Test
    @DisplayName("a walk that ended for a reason about READING says nothing about coverage")
    void unreadablePagesAreUndetermined() {
        for (String stop : new String[] {"PAGE_UNREADABLE", "PAGER_UNRESOLVED", "PAGE_DID_NOT_ADVANCE", "OPERATOR_FINISHED"}) {
            assertThat(ReviewCoverageSignal.of(read(10, 10, 0, stop)))
                    .as(stop)
                    .isEqualTo(ReviewCoverageSignal.UNDETERMINED);
        }
    }

    @Test
    @DisplayName("the operator saying they were done is not the list saying it ended")
    void operatorFinishedIsNotAClaimAboutTheList() {
        assertThat(ReviewCoverageSignal.of(read(10, 10, 0, "OPERATOR_FINISHED")))
                .isEqualTo(ReviewCoverageSignal.UNDETERMINED);
    }

    @Test
    @DisplayName("a run that received nothing concluded nothing")
    void nothingReadConcludesNothing() {
        assertThat(ReviewCoverageSignal.of(read(0, 0, 0, "PAGE_LIMIT_REACHED")))
                .isEqualTo(ReviewCoverageSignal.UNDETERMINED);
    }

    @Test
    @DisplayName("the question is not asked of a run that was not a screen read")
    void otherMethodsAreNotAsked() {
        SyncJob api = read(10, 10, 0, "PAGE_LIMIT_REACHED");
        api.setMethod(CollectionMethod.API.name());
        assertThat(ReviewCoverageSignal.of(api)).isNull();

        SyncJob noMethod = read(10, 10, 0, null);
        noMethod.setMethod(null);
        assertThat(ReviewCoverageSignal.of(noMethod)).isNull();
        assertThat(ReviewCoverageSignal.of(null)).isNull();
    }
}
