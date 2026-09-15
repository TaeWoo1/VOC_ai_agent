package com.sellerops.responsibility;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.SyncRunGate;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Disposable-Postgres proof of what the H2 suite cannot show: two database sessions racing.
 *
 * <ul>
 *   <li>concurrent first activations → one responsibility, one initial run;</li>
 *   <li>concurrent scheduler ticks → each window materialized once (R1);</li>
 *   <li>concurrent claims across coordinator instances → exactly one RUNNING run (R2);</li>
 *   <li>the database itself refuses a second RUNNING run of one responsibility (partial unique index);</li>
 *   <li>an expired lease moves the same run to another instance, and the old holder is fenced out.</li>
 * </ul>
 *
 * <p><b>Opt-in only.</b> Gated by {@code SELLEROPS_PG_PROOF=1}; point it at a throwaway database with
 * {@code SELLEROPS_PG_URL} — never a real one. Flyway runs V106 there, so the constraints under test are the
 * migration's, not Hibernate's.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class ResponsibilityPostgresProofIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String url = System.getenv().getOrDefault("SELLEROPS_PG_URL", "jdbc:postgresql://localhost:55432/sellerops");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username",
                () -> System.getenv().getOrDefault("SELLEROPS_PG_USER", "sellerops"));
        registry.add("spring.datasource.password",
                () -> System.getenv().getOrDefault("SELLEROPS_PG_PASSWORD", "sellerops_local_pw"));
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired ResponsibilityRepository responsibilities;
    @Autowired ResponsibilityRunRepository runs;
    @Autowired ResponsibilityRunSourceRepository sourceRows;
    @Autowired ResponsibilitySources sources;
    @Autowired ResponsibilitySourceObserver observer;
    @Autowired SyncRunGate gate;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired OrganizationRepository organizations;
    @Autowired PlatformTransactionManager txManager;
    @Autowired JdbcTemplate jdbc;

    private static final Duration LEASE = Duration.ofMinutes(3);
    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void quietOtherRuns() {
        // Claims are global; earlier methods' queued runs must not be picked up by this method's claimers.
        jdbc.update("update responsibility_run set status = 'CANCELLED', lease_owner = null, lease_until = null, "
                + "next_attempt_at = null where status in ('PENDING', 'RUNNING', 'PARTIAL', 'FAILED')");
    }

    @Test
    void concurrentFirstActivationsCreateOneResponsibilityAndOneInitialRun() throws Exception {
        UUID org = seedOrgWithCafe24();
        MutableTestClock clock = new MutableTestClock(now());
        race(8, () -> service(clock).activate(org, user));

        Responsibility r = responsibilities.findByOrgIdAndTemplateCode(org, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1)
                .orElseThrow();
        assertThat(jdbc.queryForObject("select count(*) from responsibility where org_id = ?", Integer.class, org))
                .isEqualTo(1);
        assertThat(runs.findByResponsibilityIdOrderByWindowStartAsc(r.getId())).hasSize(1);
    }

    @Test
    void concurrentTicksMaterializeEachWindowExactlyOnce() throws Exception {
        UUID org = seedOrgWithCafe24();
        MutableTestClock clock = new MutableTestClock(now());
        service(clock).activate(org, user);
        Responsibility r = responsibilities.findByOrgIdAndTemplateCode(org, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1)
                .orElseThrow();
        // The scheduler was down for ten windows: next_run_at is twenty hours behind.
        Instant open = ResponsibilityWindows.slotStart(clock.instant());
        jdbc.update("update responsibility set next_run_at = ? where id = ?",
                java.sql.Timestamp.from(open.minus(Duration.ofHours(20))), r.getId());

        AtomicInteger materialized = new AtomicInteger();
        race(8, () -> {
            int[] counts = coordinator(clock).materializeDue();
            materialized.addAndGet(counts[0] + counts[1]);
            return null;
        });

        List<ResponsibilityRun> all = runs.findByResponsibilityIdOrderByWindowStartAsc(r.getId());
        // ten passed windows (MISSED) plus the open one, which the activation already created
        assertThat(all).hasSize(11);
        assertThat(all.stream().map(ResponsibilityRun::getWindowStart).distinct().count()).isEqualTo(11);
        assertThat(all.stream().filter(x -> x.getFailureReason() == RunFailureReason.MISSED).count()).isEqualTo(10);
        assertThat(materialized.get()).isEqualTo(10);
        assertThat(responsibilities.findById(r.getId()).orElseThrow().getNextRunAt())
                .isEqualTo(ResponsibilityWindows.slotEnd(open));
    }

    @Test
    void concurrentClaimsAcrossInstancesLeaveExactlyOneRunningRun() throws Exception {
        UUID org = seedOrgWithCafe24();
        MutableTestClock clock = new MutableTestClock(now());
        service(clock).activate(org, user);
        Responsibility r = responsibilities.findByOrgIdAndTemplateCode(org, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1)
                .orElseThrow();
        Instant open = ResponsibilityWindows.slotStart(clock.instant());
        // Two more queued windows of the same responsibility — claimable rows the racers could split between.
        runs.save(ResponsibilityRun.materialized(r, ResponsibilityWindows.slotEnd(open), RunTrigger.SCHEDULED));
        runs.save(ResponsibilityRun.materialized(r, open.plus(Duration.ofHours(4)), RunTrigger.SCHEDULED));

        AtomicInteger claimed = new AtomicInteger();
        AtomicInteger refused = new AtomicInteger();
        race(8, () -> {
            try {
                if (coordinator(clock).claimNext(Set.of()).isPresent()) {
                    claimed.incrementAndGet();
                }
            } catch (DataIntegrityViolationException e) {
                refused.incrementAndGet();
            }
            return null;
        });

        assertThat(jdbc.queryForObject(
                "select count(*) from responsibility_run where responsibility_id = ? and status = 'RUNNING'",
                Integer.class, r.getId())).isEqualTo(1);
        assertThat(claimed.get()).isEqualTo(1);
    }

    @Test
    void theDatabaseRefusesASecondRunningRunOfOneResponsibility() {
        UUID org = seedOrgWithCafe24();
        MutableTestClock clock = new MutableTestClock(now());
        service(clock).activate(org, user);
        Responsibility r = responsibilities.findByOrgIdAndTemplateCode(org, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1)
                .orElseThrow();
        ResponsibilityRun first = coordinator(clock).claimNext(Set.of()).orElseThrow();
        assertThat(first.getResponsibilityId()).isEqualTo(r.getId());

        ResponsibilityRun second = ResponsibilityRun.materialized(r,
                ResponsibilityWindows.slotEnd(first.getWindowStart()), RunTrigger.SCHEDULED);
        second.claim("someone-else", clock.instant(), clock.instant().plus(LEASE));
        assertThatThrownBy(() -> runs.saveAndFlush(second)).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void anExpiredLeaseMovesTheSameRunToAnotherInstance_andTheOldHolderIsFenced() {
        UUID org = seedOrgWithCafe24();
        MutableTestClock clock = new MutableTestClock(now());
        service(clock).activate(org, user);
        ResponsibilityRunCoordinator a = coordinator(clock);
        ResponsibilityRunCoordinator b = coordinator(clock);

        ResponsibilityRun held = a.claimNext(Set.of()).orElseThrow();
        assertThat(b.claimNext(Set.of())).isEmpty();

        clock.advance(LEASE.plusSeconds(1));
        Optional<ResponsibilityRun> taken = b.claimNext(Set.of());
        assertThat(taken).isPresent();
        assertThat(taken.get().getId()).isEqualTo(held.getId());
        assertThat(taken.get().getAttempt()).isEqualTo(2);
        assertThat(taken.get().getLeaseOwner()).isEqualTo(b.owner());

        Integer renewed = new TransactionTemplate(txManager).execute(s ->
                runs.renewLease(held.getId(), a.owner(), clock.instant().plus(LEASE)));
        assertThat(renewed).isZero();
        a.finish(held.getId(), null, List.of());
        ResponsibilityRun after = runs.findById(held.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(RunStatus.RUNNING);
        assertThat(after.getLeaseOwner()).isEqualTo(b.owner());
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────

    private ResponsibilityService service(MutableTestClock clock) {
        return new ResponsibilityService(responsibilities, runs, sourceRows, sources, txManager, clock);
    }

    private ResponsibilityRunCoordinator coordinator(MutableTestClock clock) {
        return new ResponsibilityRunCoordinator(responsibilities, runs, sourceRows, sources, observer, gate, accounts,
                txManager, clock, LEASE, Duration.ZERO);
    }

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private void race(int threads, Callable<?> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            futures.add(pool.submit(() -> {
                start.await();
                return task.call();
            }));
        }
        start.countDown();
        for (Future<?> f : futures) {
            f.get();
        }
        pool.shutdown();
    }

    private UUID seedOrgWithCafe24() {
        Organization o = new Organization();
        o.setName("rr-" + UUID.randomUUID().toString().substring(0, 8));
        UUID org = organizations.save(o).getId();
        Channel cafe24 = channels.findByCode("CAFE24").orElseGet(() -> {
            Channel c = new Channel();
            c.setCode("CAFE24");
            c.setNameKo("카페24");
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSortOrder(0);
            return channels.save(c);
        });
        SellerAccount a = new SellerAccount();
        a.setOrgId(org);
        a.setChannelId(cafe24.getId());
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        accounts.save(a);
        return org;
    }
}
