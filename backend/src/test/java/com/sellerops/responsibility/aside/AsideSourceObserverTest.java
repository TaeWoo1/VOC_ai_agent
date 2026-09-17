package com.sellerops.responsibility.aside;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.auth.device.HelperDevice;
import com.sellerops.auth.device.HelperDeviceRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.responsibility.SourceFailureReason;
import com.sellerops.responsibility.SourceObservation;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
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
 * <b>The scheduled unattended lane, as a sequence of runs.</b>
 *
 * <p>This is the acceptance the Scheduled Aside proof is judged by, written where it can be checked every build
 * rather than only on a machine with a helper installed: first read finds everything new, an unchanged surface
 * reports nothing new, a changed surface reports exactly what changed, an absent helper reports <em>nothing</em>
 * rather than zero, and the next run after the helper returns succeeds again.
 *
 * <p>The helper is played by settling its job the way a real one reports — through the same service, with the
 * same closed outcome tokens and the same digest rule. What is being proved here is the backend's reading of
 * those reports; that the report can only say these things is proved by the job schema and by the collector's
 * own guards.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.ANY)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:aside_observe;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class AsideSourceObserverTest {

    @Autowired ScheduledAsideJobRepository jobRepository;
    @Autowired HelperDeviceRepository devices;
    @Autowired OrganizationRepository organizations;
    @Autowired UserRepository users;

    /** The surface's refs, digested. Opaque here on purpose: what matters is same-vs-different. */
    private static final String DIGEST_A = "a".repeat(64);
    private static final String DIGEST_B = "b".repeat(64);

    private UUID org;
    private UUID deviceId;
    private ScheduledAsideJobService jobs;
    private AsideSourceObserver observer;

    @BeforeEach
    void setUp() {
        jobRepository.deleteAll();
        Organization organization = new Organization();
        organization.setName("aside-" + UUID.randomUUID());
        org = organizations.saveAndFlush(organization).getId();
        User user = new User();
        user.setOrgId(org);
        user.setEmail("aside-" + UUID.randomUUID() + "@example.invalid");
        user.setName("QA");
        user.setRole("OWNER");
        UUID userId = users.saveAndFlush(user).getId();
        HelperDevice device = new HelperDevice();
        device.setOrgId(org);
        device.setUserId(userId);
        device.setTokenHash(UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", ""));
        device.setDeviceName("helper");
        device.setExpiresAt(Instant.now().plus(180, ChronoUnit.DAYS));
        deviceId = devices.saveAndFlush(device).getId();

        jobs = new ScheduledAsideJobService(jobRepository, Clock.systemUTC());
        observer = new AsideSourceObserver(jobs, devices, Duration.ofSeconds(5), Duration.ofMillis(25),
                Clock.systemUTC(), true, java.util.Set.of(org));
    }

    /** A helper that wakes, takes its job and reports — the unattended path, with no press anywhere in it. */
    private void helperReports(AsideJobOutcome outcome, Integer count, String digest) {
        CompletableFuture.runAsync(() -> {
            for (int i = 0; i < 400; i++) {
                var claimed = jobs.claim(org, deviceId);
                if (claimed.isPresent()) {
                    jobs.settle(org, deviceId, claimed.get().jobId(), outcome, count, digest);
                    return;
                }
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        });
    }

    private SourceObservation runOnce(UUID runId, AsideSourceObserver.Prior prior) {
        return observer.observe(org, runId, "rr-run:" + runId, AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1,
                prior);
    }

    @Test
    @DisplayName("run 1 — the first read of the surface finds everything on it")
    void initialReadIsAllNew() {
        helperReports(AsideJobOutcome.OBSERVED, 3, DIGEST_A);

        SourceObservation first = runOnce(UUID.randomUUID(), AsideSourceObserver.Prior.NONE);

        assertThat(first.completeness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(first.observedCount()).isEqualTo(3);
        assertThat(first.newCount()).isEqualTo(3);
        assertThat(first.failureReason()).isNull();
        assertThat(first.cursorTo()).isEqualTo(DIGEST_A);
        assertThat(first.recipeVersion()).isEqualTo(AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.name());
    }

    @Test
    @DisplayName("run 2 — an unchanged surface reports nothing new and nothing changed")
    void unchangedReadIsZeroNew() {
        helperReports(AsideJobOutcome.OBSERVED, 3, DIGEST_A);

        SourceObservation second = runOnce(UUID.randomUUID(), new AsideSourceObserver.Prior(DIGEST_A, 3));

        assertThat(second.completeness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(second.observedCount()).as("it still read the whole surface").isEqualTo(3);
        assertThat(second.newCount()).isZero();
        assertThat(second.changedCount()).isZero();
        assertThat(second.failureReason()).isNull();
    }

    @Test
    @DisplayName("run 3 — a changed surface reports exactly what changed")
    void changedReadReportsTheExactChange() {
        helperReports(AsideJobOutcome.OBSERVED, 4, DIGEST_B);

        SourceObservation third = runOnce(UUID.randomUUID(), new AsideSourceObserver.Prior(DIGEST_A, 3));

        assertThat(third.completeness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(third.observedCount()).isEqualTo(4);
        assertThat(third.newCount()).as("one item appeared").isEqualTo(1);
        assertThat(third.changedCount()).isEqualTo(1);
        assertThat(third.cursorFrom()).isEqualTo(DIGEST_A);
        assertThat(third.cursorTo()).isEqualTo(DIGEST_B);
    }

    // ── the failure the whole design exists to keep honest ───────────────────────────────────────────────────

    @Test
    @DisplayName("no helper linked — nothing was read, and nothing is not zero")
    void anAbsentHelperIsNoneNotZero() {
        devices.deleteAll();

        SourceObservation absent = runOnce(UUID.randomUUID(), new AsideSourceObserver.Prior(DIGEST_A, 3));

        assertThat(absent.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(absent.failureReason()).isEqualTo(SourceFailureReason.DEVICE_OFFLINE);
        assertThat(absent.observedCount()).isNull();
        assertThat(absent.newCount()).isNull();
        assertThat(absent.changedCount()).isNull();
    }

    @Test
    @DisplayName("the helper is there but its executor is not — still NONE, still no count")
    void anUnavailableExecutorIsNoneNotZero() {
        helperReports(AsideJobOutcome.EXECUTOR_UNAVAILABLE, null, null);

        SourceObservation failed = runOnce(UUID.randomUUID(), new AsideSourceObserver.Prior(DIGEST_A, 3));

        assertThat(failed.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(failed.failureReason()).isEqualTo(SourceFailureReason.DEVICE_OFFLINE);
        assertThat(failed.observedCount()).isNull();
    }

    @Test
    @DisplayName("it opened something that did not identify itself — never «the surface was empty»")
    void anUnreadableSurfaceIsNoneNotZero() {
        helperReports(AsideJobOutcome.SURFACE_UNREADABLE, null, null);

        SourceObservation failed = runOnce(UUID.randomUUID(), AsideSourceObserver.Prior.NONE);

        assertThat(failed.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(failed.failureReason()).isEqualTo(SourceFailureReason.EXECUTION_FAILED);
        assertThat(failed.observedCount()).isNull();
    }

    @Test
    @DisplayName("the helper refused the target — a configuration fact, and still no count")
    void aRefusedTargetIsNoneNotZero() {
        helperReports(AsideJobOutcome.REFUSED, null, null);

        SourceObservation refused = runOnce(UUID.randomUUID(), AsideSourceObserver.Prior.NONE);

        assertThat(refused.completeness()).isEqualTo(SourceCompleteness.NONE);
        assertThat(refused.failureReason()).isEqualTo(SourceFailureReason.CONFIGURATION_REQUIRED);
        assertThat(refused.observedCount()).isNull();
    }

    @Test
    @DisplayName("recovery — the run after the helper comes back succeeds, with no human step between")
    void theNextScheduledRunAfterRecoverySucceeds() {
        devices.deleteAll();
        SourceObservation offline = runOnce(UUID.randomUUID(), new AsideSourceObserver.Prior(DIGEST_A, 3));
        assertThat(offline.completeness()).isEqualTo(SourceCompleteness.NONE);

        // The seller's helper is running again. Nothing else happens: the next window simply comes round.
        HelperDevice back = new HelperDevice();
        back.setOrgId(org);
        back.setUserId(users.findAll().get(0).getId());
        back.setTokenHash(UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", ""));
        back.setDeviceName("helper");
        back.setExpiresAt(Instant.now().plus(180, ChronoUnit.DAYS));
        deviceId = devices.saveAndFlush(back).getId();
        helperReports(AsideJobOutcome.OBSERVED, 4, DIGEST_B);

        SourceObservation recovered = runOnce(UUID.randomUUID(), new AsideSourceObserver.Prior(DIGEST_A, 3));

        assertThat(recovered.completeness()).isEqualTo(SourceCompleteness.COMPLETE);
        assertThat(recovered.observedCount()).isEqualTo(4);
        assertThat(recovered.newCount()).isEqualTo(1);
    }

    // ── the lane opens for nobody by default ─────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("off, or on for other organisations, opens nothing here")
    void theLaneIsNamedPerOrganisation() {
        AsideSourceObserver off = new AsideSourceObserver(jobs, devices, Duration.ofSeconds(1),
                Duration.ofMillis(25), Clock.systemUTC(), false, java.util.Set.of(org));
        AsideSourceObserver elsewhere = new AsideSourceObserver(jobs, devices, Duration.ofSeconds(1),
                Duration.ofMillis(25), Clock.systemUTC(), true, java.util.Set.of(UUID.randomUUID()));

        assertThat(off.enabledFor(org)).isFalse();
        assertThat(elsewhere.enabledFor(org)).isFalse();
        assertThat(observer.enabledFor(org)).isTrue();
        assertThat(observer.enabledFor(UUID.randomUUID())).as("another seller's machine is never opened").isFalse();
    }
}
