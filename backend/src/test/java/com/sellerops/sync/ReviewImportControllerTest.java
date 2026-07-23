package com.sellerops.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.auth.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;

/**
 * The import-history controller is a thin shell: it derives orgId from the authenticated principal
 * (never the client) and turns the optional {@code limit} into a bounded page request.
 *
 * <p>Both halves are worth pinning. The org is the whole authorization story for this read — a
 * client-supplied org would expose another seller's operational history. And the limit reaches
 * {@code PageRequest}, which throws on a non-positive size, so clamping is not cosmetic.
 */
class ReviewImportControllerTest {

    private final SyncJobRepository syncJobs = mock(SyncJobRepository.class);
    private final ReviewImportController controller = new ReviewImportController(syncJobs);

    private AuthPrincipal principalFor(UUID orgId) {
        return new AuthPrincipal(UUID.randomUUID(), orgId, "op@example.com");
    }

    private Pageable pageableFor(Integer limit) {
        UUID orgId = UUID.randomUUID();
        when(syncJobs.findReviewImports(eq(orgId), org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of());

        controller.recent(principalFor(orgId), limit);

        ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);
        verify(syncJobs).findReviewImports(eq(orgId), captor.capture());
        return captor.getValue();
    }

    @Test
    void readsTheOrgFromThePrincipalNeverFromTheCaller() {
        UUID orgId = UUID.randomUUID();
        when(syncJobs.findReviewImports(eq(orgId), org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of());

        controller.recent(principalFor(orgId), null);

        verify(syncJobs).findReviewImports(eq(orgId), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void anAbsentLimitUsesTheDefaultPage() {
        Pageable page = pageableFor(null);

        assertThat(page.getPageSize()).isEqualTo(ReviewImportController.DEFAULT_LIMIT);
        assertThat(page.getPageNumber()).isZero();
    }

    @Test
    void anOversizedLimitIsClampedRatherThanHonoured() {
        assertThat(pageableFor(10_000).getPageSize()).isEqualTo(ReviewImportController.MAX_LIMIT);
    }

    @Test
    void aNonPositiveLimitClampsUpInsteadOfThrowing() {
        // PageRequest.of rejects a size < 1, so an unclamped 0 or -5 would surface as a 500 for what
        // is only a display parameter.
        assertThat(pageableFor(0).getPageSize()).isEqualTo(1);
        assertThat(pageableFor(-5).getPageSize()).isEqualTo(1);
    }

    @Test
    void aLimitInsideTheRangeIsHonouredExactly() {
        assertThat(pageableFor(7).getPageSize()).isEqualTo(7);
    }
}
