package com.sellerops.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.sellerops.collect.runtime.CollectionMethod;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The review-import history read: what it selects, in what order, and what it refuses to carry.
 *
 * <p>The load-bearing property is that the predicate runs <b>in the query</b> and the limit applies
 * <b>after</b> it. A fetch-then-filter implementation passes every other assertion here and still
 * shows a seller an empty history for imports that exist — so that case is tested explicitly, with
 * enough unrelated jobs to bury the review import.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewImportHistoryTest {

    @Autowired SyncJobRepository syncJobs;

    private final UUID org = UUID.randomUUID();
    private final UUID otherOrg = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private SyncJob job(UUID orgId, String jobType, String uploadType, CollectionMethod method,
                        String status, int success, int skipped, int failed) {
        SyncJob j = new SyncJob();
        j.setOrgId(orgId);
        j.setChannelId(channel);
        j.setJobType(jobType);
        j.setUploadType(uploadType);
        j.setMethod(method == null ? null : method.name());
        j.setStatus(status);
        j.setTotalRows(success + skipped + failed);
        j.setSuccessRows(success);
        j.setSkippedRows(skipped);
        j.setFailedRows(failed);
        j.setStartedAt(Instant.parse("2026-05-10T00:00:00Z"));
        j.setFinishedAt(Instant.parse("2026-05-10T00:00:05Z"));
        return syncJobs.save(j);
    }

    private SyncJob reviewImport(CollectionMethod method, String status, int s, int k, int f) {
        return job(org, "FILE_UPLOAD", "REVIEW", method, status, s, k, f);
    }

    private List<ReviewImportView> recent(int limit) {
        return syncJobs.findReviewImports(org, PageRequest.of(0, limit)).stream()
                .map(ReviewImportView::from)
                .toList();
    }

    @Test
    void selectsReviewImportsAndNothingElse() {
        SyncJob wanted = reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "SUCCESS", 6, 0, 0);
        job(org, "FILE_UPLOAD", "INQUIRY", CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 3, 0, 0);
        job(org, "FILE_UPLOAD", "ORDER_SUMMARY", CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 3, 0, 0);
        job(org, "NAVER_API", null, CollectionMethod.API, "SUCCESS", 9, 0, 0);   // uploadType null

        assertThat(recent(20)).extracting(ReviewImportView::id).containsExactly(wanted.getId());
    }

    @Test
    void isOrgScoped() {
        reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 1, 0, 0);
        job(otherOrg, "FILE_UPLOAD", "REVIEW", CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 99, 0, 0);

        assertThat(recent(20)).hasSize(1);
        assertThat(recent(20)).allSatisfy(v -> assertThat(v.successRows()).isEqualTo(1));
    }

    @Test
    void filtersBEFOREitLimits() {
        // THE PROPERTY THIS READ EXISTS FOR. One review import, then more unrelated jobs than the
        // limit. A fetch-then-filter implementation takes the newest N rows first, finds no review
        // import among them, and returns an empty history for an import that plainly exists.
        SyncJob buried = reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "SUCCESS", 4, 0, 0);
        for (int i = 0; i < 30; i++) {
            job(org, "FILE_UPLOAD", "INQUIRY", CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 1, 0, 0);
        }

        assertThat(recent(5)).extracting(ReviewImportView::id).containsExactly(buried.getId());
    }

    @Test
    void ordersNewestFirstBY_THE_INSTANT_IT_DISPLAYS() {
        // Asserted against explicit timestamps, not against "two calls agree" — that weaker check
        // passes for ascending order, or for no ORDER BY at all.
        //
        // The pair below is the case that made the ordering worth pinning: a long import that
        // STARTED first but FINISHED last. Sorting on createdAt would put it second while the row
        // shows the later date, so the list would visibly contradict its own labels.
        SyncJob longRun = finishedAt(reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 1, 0, 0),
                "2026-05-10T09:00:00Z", "2026-05-10T23:50:00Z");
        SyncJob shortRun = finishedAt(reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 2, 0, 0),
                "2026-05-10T22:00:00Z", "2026-05-10T22:05:00Z");
        SyncJob oldest = finishedAt(reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 3, 0, 0),
                "2026-05-01T00:00:00Z", "2026-05-01T00:01:00Z");

        assertThat(recent(20)).extracting(ReviewImportView::id)
                .containsExactly(longRun.getId(), shortRun.getId(), oldest.getId());
    }

    @Test
    void aStillRunningImportSortsByItsStartBecauseItHasNoEnd() {
        SyncJob finished = finishedAt(reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 1, 0, 0),
                "2026-05-10T08:00:00Z", "2026-05-10T08:01:00Z");
        SyncJob running = finishedAt(reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "RUNNING", 0, 0, 0),
                "2026-05-10T09:00:00Z", null);

        assertThat(recent(20)).extracting(ReviewImportView::id)
                .containsExactly(running.getId(), finished.getId());
    }

    @Test
    void aTieIsBrokenDeterministicallyRatherThanLeftToTheDatabase() {
        // A genuine tie: same finish instant on both rows. Without the id tiebreaker the order is
        // whatever the database happens to return, so the list can appear to shuffle between reads.
        finishedAt(reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 1, 0, 0),
                "2026-05-10T09:00:00Z", "2026-05-10T10:00:00Z");
        finishedAt(reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 2, 0, 0),
                "2026-05-10T09:00:00Z", "2026-05-10T10:00:00Z");

        List<UUID> first = recent(20).stream().map(ReviewImportView::id).toList();

        assertThat(first).hasSize(2);
        // The property is STABILITY, not a particular winner: `id desc` is evaluated by the database's
        // own uuid collation, which is not Java's `UUID.compareTo`. Asserting a specific id order here
        // would pin an implementation detail of the store rather than the guarantee the surface needs —
        // that two reads of an unchanged table return the same order.
        assertThat(recent(20).stream().map(ReviewImportView::id).toList()).isEqualTo(first);
        assertThat(recent(20).stream().map(ReviewImportView::id).toList()).isEqualTo(first);
    }

    @Test
    void honoursTheLimit() {
        for (int i = 0; i < 5; i++) {
            reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", i, 0, 0);
        }

        assertThat(recent(3)).hasSize(3);
    }

    /** Pin an import's own instants — {@code createdAt} is only auto-set when left null. */
    private SyncJob finishedAt(SyncJob j, String started, String finished) {
        j.setStartedAt(Instant.parse(started));
        j.setFinishedAt(finished == null ? null : Instant.parse(finished));
        j.setCreatedAt(Instant.parse(started));
        return syncJobs.saveAndFlush(j);
    }

    // --- what the view carries, and what it refuses to ---------------------------------

    @Test
    void carriesEachProvenanceIncludingAnUnknownOne() {
        reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "SUCCESS", 1, 0, 0);
        reviewImport(CollectionMethod.MANUAL_UPLOAD, "SUCCESS", 1, 0, 0);
        reviewImport(null, "SUCCESS", 1, 0, 0);   // a row that predates the V6 method column

        assertThat(recent(20)).extracting(ReviewImportView::method)
                .containsExactlyInAnyOrder("SELLER_CENTER_EXPORT", "MANUAL_UPLOAD", null);
    }

    @Test
    void carriesTheOutcomesTheSurfaceMustTellApart() {
        // An empty export and an all-duplicate re-import are BOTH successes — neither is a failure
        // and neither is "nothing collected". A RUNNING row is a real state (opened, never finalized).
        reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "SUCCESS", 0, 0, 0);   // empty export
        reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "SUCCESS", 0, 6, 0);   // all duplicates
        reviewImport(CollectionMethod.MANUAL_UPLOAD, "PARTIAL", 4, 0, 2);
        reviewImport(CollectionMethod.MANUAL_UPLOAD, "FAILED", 0, 0, 0);
        reviewImport(CollectionMethod.SELLER_CENTER_EXPORT, "RUNNING", 0, 0, 0);

        assertThat(recent(20))
                .extracting(ReviewImportView::status, ReviewImportView::successRows, ReviewImportView::skippedRows)
                .containsExactlyInAnyOrder(
                        tuple("SUCCESS", 0, 0),
                        tuple("SUCCESS", 0, 6),
                        tuple("PARTIAL", 4, 0),
                        tuple("FAILED", 0, 0),
                        tuple("RUNNING", 0, 0));
    }

    @Test
    void neverCarriesTheRawErrorMessage() {
        // sync_jobs.error_message holds the raw first row-error, and the connector also stores
        // exception text there — which can embed parser or filename detail. It must not reach an
        // operator surface; the status is enough for the UI to explain itself.
        SyncJob failed = reviewImport(CollectionMethod.MANUAL_UPLOAD, "FAILED", 0, 0, 3);
        failed.setErrorMessage("파일을 처리하지 못했습니다: /Users/someone/Downloads/실제파일.xlsx");
        syncJobs.save(failed);

        String serialized = recent(20).toString();

        assertThat(serialized).doesNotContain("실제파일", "/Users/", "파일을 처리하지 못했습니다");
        // …and the field is absent from the record entirely, not merely blank in this case.
        assertThat(ReviewImportView.class.getRecordComponents())
                .extracting(java.lang.reflect.RecordComponent::getName)
                .doesNotContain("errorMessage")
                // channelId is absent too: nothing renders it, and shipping an id the surface never
                // shows is exposure without purpose (see the record's own note).
                .doesNotContain("channelId")
                .containsExactly("id", "method", "status", "totalRows",
                        "successRows", "skippedRows", "failedRows", "startedAt", "finishedAt");
    }
}
