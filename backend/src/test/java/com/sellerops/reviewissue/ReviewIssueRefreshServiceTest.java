package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssueExtractionService.ExtractionResult;
import com.sellerops.reviewissue.ReviewIssueLifecycleService.AutomaticPassResult;
import com.sellerops.reviewissue.ReviewIssueRefreshService.IssueRefreshResult;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/**
 * The after-ingest refresh: extract the newest bounded batch, then run the automatic lifecycle pass, and
 * report honest totals. Repositories/services mocked. Pins the boundedness (never an unbounded scan) and
 * that both halves (extraction totals + lifecycle deltas) are folded into one result.
 */
class ReviewIssueRefreshServiceTest {

    private final ReviewRepository reviews = mock(ReviewRepository.class);
    private final ReviewIssueExtractionService extraction = mock(ReviewIssueExtractionService.class);
    private final ReviewIssueLifecycleService lifecycle = mock(ReviewIssueLifecycleService.class);
    private final ReviewIssueRefreshService service =
            new ReviewIssueRefreshService(reviews, extraction, lifecycle);

    private final UUID org = UUID.randomUUID();

    @Test
    void extractsNewestBoundedBatchThenRunsLifecyclePassAndSumsTotals() {
        Review a = new Review();
        Review b = new Review();
        when(reviews.findForIssueExtraction(eq(org), any(Pageable.class))).thenReturn(List.of(a, b));
        when(extraction.extract(a)).thenReturn(new ExtractionResult(1, 0, 1, 0));
        when(extraction.extract(b)).thenReturn(new ExtractionResult(1, 1, 0, 1));
        when(lifecycle.runAutomaticPass(org, LocalDate.parse("2026-05-10")))
                .thenReturn(new AutomaticPassResult(2, 1));

        IssueRefreshResult result = service.refresh(org, LocalDate.parse("2026-05-10"), 2000);

        assertThat(result.reviewsScanned()).isEqualTo(2);
        assertThat(result.evidenceAdded()).isEqualTo(2);
        assertThat(result.unknownAdded()).isEqualTo(1);
        assertThat(result.issuesCreated()).isEqualTo(1);
        assertThat(result.issuesReopened()).isEqualTo(1);
        assertThat(result.raisedForReview()).isEqualTo(2);
        assertThat(result.resolved()).isEqualTo(1);
        verify(lifecycle).runAutomaticPass(org, LocalDate.parse("2026-05-10"));
    }

    @Test
    void capsTheBatchSizeSoAnAfterIngestRefreshNeverBecomesAFullScan() {
        when(reviews.findForIssueExtraction(eq(org), any(Pageable.class))).thenReturn(List.of());
        when(lifecycle.runAutomaticPass(any(), any())).thenReturn(new AutomaticPassResult(0, 0));

        service.refresh(org, LocalDate.parse("2026-05-10"), Integer.MAX_VALUE);

        ArgumentCaptor<Pageable> cap = ArgumentCaptor.forClass(Pageable.class);
        verify(reviews).findForIssueExtraction(eq(org), cap.capture());
        assertThat(cap.getValue().getPageSize()).isEqualTo(ReviewIssueRefreshService.MAX_REVIEWS_CEILING);
        assertThat(cap.getValue()).isEqualTo(PageRequest.of(0, ReviewIssueRefreshService.MAX_REVIEWS_CEILING));
    }
}
