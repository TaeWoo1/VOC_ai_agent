package com.sellerops.responsibility.aside;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.auth.device.HelperDevice;
import com.sellerops.auth.device.HelperDeviceRepository;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.responsibility.SourceFailureReason;
import com.sellerops.responsibility.SourceObservation;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>How a marketplace device read becomes a run source row — and how it does not.</b>
 *
 * <p>The loopback recipe's semantics are asserted in {@link AsideSourceObserverTest} and are unchanged. A marketplace
 * read differs in the two ways that keep it truthful: it is {@code BOUNDED} (a read of the screen's period, never the
 * store's history), and its new/changed counts are the ones ingest recorded against the job, never a digest guess.
 * Every failure is {@code NONE} with no count, and the sign-in wall and an unproven store say so by name.
 */
class AsideMarketplaceObservationTest {

    private static final UUID ORG = UUID.randomUUID();

    private final ScheduledAsideJobService jobs = mock(ScheduledAsideJobService.class);
    private final HelperDeviceRepository devices = mock(HelperDeviceRepository.class);
    private AsideSourceObserver observer;
    private ScheduledAsideJob job;

    @BeforeEach
    void setUp() {
        HelperDevice device = new HelperDevice();
        device.setId(UUID.randomUUID());
        device.setExpiresAt(Instant.now().plus(Duration.ofDays(1)));
        when(devices.findByOrgIdAndRevokedAtIsNullOrderByCreatedAtDesc(ORG)).thenReturn(List.of(device));
        job = new ScheduledAsideJob();
        job.setId(UUID.randomUUID());
        job.setOrgId(ORG);
        job.setRecipe(AsideRecipe.NAVER_REVIEW_OBSERVE_V1);
        when(jobs.enqueue(any(), any(), any(), any(), any())).thenReturn(job);
        when(jobs.byId(job.getId())).thenReturn(Optional.of(job));
        observer = new AsideSourceObserver(jobs, devices, Duration.ofMillis(50), Duration.ofMillis(5),
                Clock.systemUTC());
    }

    private SourceObservation observe() {
        return observer.observe(ORG, UUID.randomUUID(), "rr-run:x:nr", AsideRecipe.NAVER_REVIEW_OBSERVE_V1,
                AsideSourceObserver.Prior.NONE);
    }

    @Test
    @DisplayName("a proved read is BOUNDED, counts what ingest inserted and changed, and carries its identity")
    void aProvedReadIsBoundedAndQuotesIngest() {
        job.recordDelivery(52, 0);
        job.settle(AsideJobOutcome.OBSERVED, 52, "c".repeat(64), Instant.now());

        SourceObservation o = observe();

        assertThat(o.completeness()).isEqualTo(SourceCompleteness.BOUNDED);
        assertThat(o.observedCount()).isEqualTo(52);
        assertThat(o.newCount()).isEqualTo(52);
        assertThat(o.changedCount()).isZero();
        assertThat(o.identityVerdict()).isEqualTo(IdentityVerdict.MATCH);
        assertThat(o.recipeVersion()).isEqualTo("NAVER_REVIEW_OBSERVE_V1");
    }

    @Test
    @DisplayName("the same page again: observed the same, new 0 — because ingest inserted none, not because a digest matched")
    void aRepeatReadIsNewZeroFromIngest() {
        job.recordDelivery(0, 0);
        job.settle(AsideJobOutcome.OBSERVED, 52, "c".repeat(64), Instant.now());

        SourceObservation o = observer.observe(ORG, UUID.randomUUID(), "rr-run:y:nr",
                AsideRecipe.NAVER_REVIEW_OBSERVE_V1, new AsideSourceObserver.Prior("d".repeat(64), 51));

        assertThat(o.completeness()).isEqualTo(SourceCompleteness.BOUNDED);
        assertThat(o.observedCount()).isEqualTo(52);
        assertThat(o.newCount()).isZero();
        assertThat(o.changedCount()).isZero();
    }

    @Test
    @DisplayName("an inquiry page the backend could not show was gap-free is PARTIAL — its counts are real, it is not settled")
    void aPartialInquiryDeliveryIsPartial() {
        job.setRecipe(AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1);
        job.recordDelivery(8, 0, SourceCompleteness.PARTIAL);
        job.settle(AsideJobOutcome.OBSERVED, 8, "c".repeat(64), Instant.now());

        SourceObservation o = observer.observe(ORG, UUID.randomUUID(), "rr-run:x:ni",
                AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1, AsideSourceObserver.Prior.NONE);

        assertThat(o.completeness()).isEqualTo(SourceCompleteness.PARTIAL);
        assertThat(o.completeness().settled()).isFalse();
        assertThat(o.observedCount()).isEqualTo(8);
        assertThat(o.newCount()).isEqualTo(8);
        assertThat(o.recipeVersion()).isEqualTo("NAVER_PRODUCT_INQUIRY_OBSERVE_V1");

        job.recordDelivery(0, 0, SourceCompleteness.BOUNDED);
        assertThat(observer.observe(ORG, UUID.randomUUID(), "rr-run:y:ni",
                AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1, AsideSourceObserver.Prior.NONE).completeness())
                .isEqualTo(SourceCompleteness.BOUNDED);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> job.recordDelivery(1, 0, SourceCompleteness.COMPLETE))
                .as("a page of a marketplace screen is never COMPLETE").isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a sign-in wall is NONE · AUTH_REQUIRED with no count — never «0 reviews»")
    void aSignInWallIsAuthRequired() {
        job.settle(AsideJobOutcome.AUTH_REQUIRED, 99, null, Instant.now());

        SourceObservation o = observe();

        assertThat(o.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(o.failureReason()).isEqualTo(SourceFailureReason.AUTH_REQUIRED);
        assertThat(o.observedCount()).isNull();
        assertThat(o.newCount()).isNull();
        assertThat(o.changedCount()).isNull();
    }

    @Test
    @DisplayName("an unproven store is NONE with the verdict on the row; a proved different store says MISMATCH")
    void anUnprovenStoreIsNamed() {
        job.refuseDelivery(IdentityVerdict.UNRESOLVED);
        job.settle(AsideJobOutcome.STORE_UNRESOLVED, null, null, Instant.now());
        SourceObservation unresolved = observe();
        assertThat(unresolved.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(unresolved.failureReason()).isEqualTo(SourceFailureReason.STORE_UNRESOLVED);
        assertThat(unresolved.identityVerdict()).isEqualTo(IdentityVerdict.UNRESOLVED);
        assertThat(unresolved.observedCount()).isNull();

        job.refuseDelivery(IdentityVerdict.MISMATCH);
        SourceObservation mismatch = observe();
        assertThat(mismatch.failureReason()).isEqualTo(SourceFailureReason.STORE_MISMATCH);
        assertThat(mismatch.identityVerdict()).isEqualTo(IdentityVerdict.MISMATCH);
    }

    @Test
    @DisplayName("a helper that claims OBSERVED with no recorded delivery is not trusted — NONE, no count")
    void anUndeliveredObservationIsNotTrusted() {
        job.settle(AsideJobOutcome.OBSERVED, 52, "c".repeat(64), Instant.now());

        SourceObservation o = observe();

        assertThat(o.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(o.failureReason()).isEqualTo(SourceFailureReason.EXECUTION_FAILED);
        assertThat(o.observedCount()).isNull();
    }
}
