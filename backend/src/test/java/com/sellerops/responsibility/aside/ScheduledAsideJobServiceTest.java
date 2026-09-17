package com.sellerops.responsibility.aside;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>What an unattended job may and may not do, over real repositories.</b>
 *
 * <p>Every assertion here is a line of the unattended security contract asked as a question: can the same
 * hand-out queue two jobs? can two helpers both take one? can a device settle a job it does not hold? can an
 * outcome that observed nothing carry a number? The answers have to be no in code, because the schema's own
 * versions of these rules (the partial unique index, the recipe and count checks in V108) do not exist on H2 —
 * those belong to a Postgres proof, and code that leaned on them here would be untested where it actually runs.
 *
 * <p>The clock is fixed so a lease and a TTL can be crossed deliberately rather than waited out.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.ANY)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:aside_job;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class ScheduledAsideJobServiceTest {

    @Autowired ScheduledAsideJobRepository repository;

    private static final Instant T0 = Instant.parse("2026-09-16T01:00:00Z");

    private UUID org;
    private UUID device;
    private UUID otherDevice;
    private ScheduledAsideJobService service;

    private ScheduledAsideJobService at(Instant now) {
        return new ScheduledAsideJobService(repository, Clock.fixed(now, ZoneOffset.UTC));
    }

    @BeforeEach
    void setUp() {
        repository.deleteAll();
        org = UUID.randomUUID();
        device = UUID.randomUUID();
        otherDevice = UUID.randomUUID();
        service = at(T0);
    }

    private ScheduledAsideJob enqueue(String clientJobId) {
        return service.enqueue(org, device, null, clientJobId, AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);
    }

    // ── handing work out ────────────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("the same hand-out re-finds its job rather than queueing a second one")
    void enqueueIsIdempotent() {
        ScheduledAsideJob first = enqueue("job-1");
        ScheduledAsideJob again = enqueue("job-1");

        assertThat(again.getId()).isEqualTo(first.getId());
        assertThat(repository.findAll()).hasSize(1);
        assertThat(first.getStatus()).isEqualTo(ScheduledAsideJobStatus.QUEUED);
        assertThat(first.getExpiresAt()).isEqualTo(T0.plus(ScheduledAsideJob.TTL));
    }

    @Test
    @DisplayName("one helper is one desk: a device with live work takes no second job")
    void oneActiveJobPerDevice() {
        enqueue("job-1");

        assertThatThrownBy(() -> enqueue("job-2")).isInstanceOf(ApiException.class);
        assertThat(repository.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("a claimed job still counts as live work")
    void aClaimedJobBlocksTheNextOne() {
        enqueue("job-1");
        assertThat(service.claim(org, device)).isPresent();

        assertThatThrownBy(() -> enqueue("job-2")).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("another device's queue is unaffected")
    void devicesDoNotShareAQueue() {
        enqueue("job-1");
        service.enqueue(org, otherDevice, null, "job-1", AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);

        assertThat(repository.findAll()).hasSize(2);
        assertThat(service.claim(org, otherDevice)).isPresent();
    }

    // ── taking it, exactly once ─────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a job leaves QUEUED exactly once")
    void claimIsSingleUse() {
        ScheduledAsideJob queued = enqueue("job-1");

        Optional<ScheduledAsideJobService.ClaimedJob> first = service.claim(org, device);
        Optional<ScheduledAsideJobService.ClaimedJob> second = service.claim(org, device);

        assertThat(first).isPresent();
        assertThat(first.orElseThrow().jobId()).isEqualTo(queued.getId());
        assertThat(first.orElseThrow().recipe()).isEqualTo(AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);
        assertThat(second).as("the second helper to ask is told there is nothing").isEmpty();
        assertThat(repository.findById(queued.getId()).orElseThrow().getStatus())
                .isEqualTo(ScheduledAsideJobStatus.CLAIMED);
    }

    @Test
    @DisplayName("a device is only ever answered with its own work")
    void aDeviceCannotClaimAnothersJob() {
        enqueue("job-1");

        assertThat(service.claim(org, otherDevice)).isEmpty();
        assertThat(service.claim(UUID.randomUUID(), device)).as("another organisation's caller gets nothing")
                .isEmpty();
    }

    @Test
    @DisplayName("a job nobody took in time expired — which is not «it ran and found nothing»")
    void anExpiredJobIsNotClaimable() {
        ScheduledAsideJob queued = enqueue("job-1");

        Instant late = T0.plus(ScheduledAsideJob.TTL).plusSeconds(1);
        assertThat(at(late).claim(org, device)).isEmpty();

        ScheduledAsideJob after = repository.findById(queued.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(ScheduledAsideJobStatus.EXPIRED);
        assertThat(after.getOutcome()).as("it never ran, so it reported nothing").isNull();
        assertThat(after.getObservedCount()).isNull();
    }

    // ── reporting what it came to ───────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("an observation carries its count, including a real zero")
    void settleRecordsAnObservation() {
        ScheduledAsideJob queued = enqueue("job-1");
        service.claim(org, device);

        ScheduledAsideJob settled = service.settle(org, device, queued.getId(), AsideJobOutcome.OBSERVED, 3, null);

        assertThat(settled.getStatus()).isEqualTo(ScheduledAsideJobStatus.SETTLED);
        assertThat(settled.getOutcome()).isEqualTo(AsideJobOutcome.OBSERVED);
        assertThat(settled.getObservedCount()).isEqualTo(3);
        assertThat(settled.getSettledAt()).isEqualTo(T0);

        ScheduledAsideJob zero = enqueueAndClaim("job-2");
        assertThat(service.settle(org, device, zero.getId(), AsideJobOutcome.OBSERVED, 0, null).getObservedCount())
                .as("a surface that really is empty is an observation of zero").isZero();
    }

    @Test
    @DisplayName("every other outcome carries no number at all")
    void onlyAnObservationHasACount() {
        for (AsideJobOutcome outcome : new AsideJobOutcome[] {
                AsideJobOutcome.SURFACE_UNREADABLE, AsideJobOutcome.EXECUTOR_UNAVAILABLE, AsideJobOutcome.REFUSED}) {
            ScheduledAsideJob job = enqueueAndClaim("job-" + outcome.name());
            ScheduledAsideJob settled = service.settle(org, device, job.getId(), outcome, 99, null);

            assertThat(settled.getOutcome()).isEqualTo(outcome);
            assertThat(settled.getObservedCount())
                    .as("%s did not read the surface, so it has no number to report", outcome).isNull();
        }
    }

    @Test
    @DisplayName("a device cannot report on a job it does not hold")
    void settleRefusesWhatThisDeviceDoesNotHold() {
        ScheduledAsideJob queued = enqueue("job-1");
        service.claim(org, device);

        assertThatThrownBy(() -> service.settle(org, otherDevice, queued.getId(), AsideJobOutcome.OBSERVED, 1, null))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.settle(UUID.randomUUID(), device, queued.getId(),
                AsideJobOutcome.OBSERVED, 1, null)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("a report arrives once, and not after the lease has run out")
    void settleIsSingleUseAndLeaseBound() {
        ScheduledAsideJob queued = enqueueAndClaim("job-1");
        service.settle(org, device, queued.getId(), AsideJobOutcome.OBSERVED, 1, null);

        assertThatThrownBy(() -> service.settle(org, device, queued.getId(), AsideJobOutcome.OBSERVED, 1, null))
                .as("a settled job is not one a second report can describe").isInstanceOf(ApiException.class);

        ScheduledAsideJob late = enqueueAndClaim("job-2");
        Instant afterLease = T0.plus(ScheduledAsideJob.LEASE).plusSeconds(1);
        assertThatThrownBy(() -> at(afterLease).settle(org, device, late.getId(), AsideJobOutcome.OBSERVED, 1, null))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("an unclaimed job cannot be reported on")
    void settleRefusesAnUnclaimedJob() {
        ScheduledAsideJob queued = enqueue("job-1");

        assertThatThrownBy(() -> service.settle(org, device, queued.getId(), AsideJobOutcome.OBSERVED, 1, null))
                .isInstanceOf(ApiException.class);
    }

    // ── what a run can read back ────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a run can find the work it handed out")
    void aRunFindsItsJobs() {
        UUID runId = UUID.randomUUID();
        service.enqueue(org, device, runId, "job-1", AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);

        assertThat(service.forRun(runId)).hasSize(1);
        assertThat(service.forRun(UUID.randomUUID())).isEmpty();
    }

    private ScheduledAsideJob enqueueAndClaim(String clientJobId) {
        ScheduledAsideJob job = service.enqueue(org, device, null, clientJobId,
                AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);
        service.claim(org, device);
        return job;
    }
}
