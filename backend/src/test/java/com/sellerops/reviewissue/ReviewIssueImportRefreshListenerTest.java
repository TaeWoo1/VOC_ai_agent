package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.reviewimport.ReviewSegmentIngestedEvent;
import com.sellerops.reviewissue.ReviewIssueRefreshService.IssueRefreshResult;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The after-ingest listener is best-effort by contract: the import already committed, so a refresh that
 * throws must be swallowed (logged), never rethrown, or it would fail an already-successful request.
 */
class ReviewIssueImportRefreshListenerTest {

    private final ReviewIssueRefreshService refresh = mock(ReviewIssueRefreshService.class);
    private final ReviewIssueImportRefreshListener listener = new ReviewIssueImportRefreshListener(refresh);

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final ReviewSegmentIngestedEvent event =
            new ReviewSegmentIngestedEvent(org, channel, LocalDate.parse("2026-05-10"));

    @Test
    void refreshesTheIssueMemoryForTheEventsOrgAndReferenceDate() {
        when(refresh.refresh(eq(org), eq(LocalDate.parse("2026-05-10")), anyInt()))
                .thenReturn(new IssueRefreshResult(0, 0, 0, 0, 0, 0, 0));

        listener.onSegmentIngested(event);

        verify(refresh).refresh(eq(org), eq(LocalDate.parse("2026-05-10")), anyInt());
    }

    @Test
    void swallowsAFailedRefreshSoItNeverFailsTheAlreadyCommittedImport() {
        doThrow(new RuntimeException("db unavailable"))
                .when(refresh).refresh(eq(org), eq(LocalDate.parse("2026-05-10")), anyInt());

        assertThatCode(() -> listener.onSegmentIngested(event)).doesNotThrowAnyException();
    }
}
