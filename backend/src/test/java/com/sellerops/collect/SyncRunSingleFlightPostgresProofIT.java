package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.DataType;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Disposable-Postgres proof that {@link SyncRunGate}'s single-flight admission is race-free under a
 * real concurrent start. The H2 suite ({@code SyncRunGateTest}) runs each test in one rolled-back
 * transaction and cannot exercise the {@code PESSIMISTIC_WRITE} account-row lock across threads, so
 * the actual race — N starts colliding on the same (account, data type) — is proven here against a
 * throwaway PostgreSQL where the lock truly serializes the check-then-create.
 *
 * <p><b>Opt-in only.</b> Gated by {@code SELLEROPS_PG_PROOF=1}; skipped otherwise, so the normal H2
 * gate and CI (no Postgres) are unaffected. Point it at the disposable DB with {@code SELLEROPS_PG_URL}
 * (default {@code jdbc:postgresql://localhost:55432/sellerops}); never a real DB. Not
 * {@code @Transactional}: each start commits so the racers contend over real rows.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class SyncRunSingleFlightPostgresProofIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String url = System.getenv().getOrDefault("SELLEROPS_PG_URL",
                "jdbc:postgresql://localhost:55432/sellerops");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> "sellerops");
        registry.add("spring.datasource.password", () -> "sellerops_local_pw");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired SyncRunGate gate;
    @Autowired SyncJobRepository syncJobs;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired OrganizationRepository organizations;

    // N concurrent starts for one (account, data type) → exactly one job is created; the rest coalesce.
    @Test
    void concurrentStartsCollapseToASingleRunningJob() throws Exception {
        UUID org = seedOrg();
        UUID account = seedAccount(org, seedChannel("SF-RACE"));

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger created = new AtomicInteger();
        AtomicInteger coalesced = new AtomicInteger();

        List<Callable<Void>> tasks = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            tasks.add(() -> {
                start.await();
                SyncRunGate.RunStart result = gate.beginRunOrCoalesce(
                        account, DataType.ORDER_SUMMARY, () -> newRunning(org, account));
                if (result.coalesced()) {
                    coalesced.incrementAndGet();
                } else {
                    created.incrementAndGet();
                }
                return null;
            });
        }
        List<Future<Void>> futures = new ArrayList<>();
        for (Callable<Void> t : tasks) {
            futures.add(pool.submit(t));
        }
        start.countDown(); // release all racers at once
        for (Future<Void> f : futures) {
            f.get();
        }
        pool.shutdown();

        // Exactly one racer created a run; every other coalesced onto it; one RUNNING row exists.
        assertThat(created.get()).isEqualTo(1);
        assertThat(coalesced.get()).isEqualTo(threads - 1);
        assertThat(syncJobs.findRunningBySellerAccountIdAndDataType(account, "ORDER_SUMMARY")).hasSize(1);
    }

    // Concurrency on two different accounts is independent — each gets exactly one run.
    @Test
    void concurrentStartsOnDifferentAccountsAreIndependent() throws Exception {
        UUID org = seedOrg();
        // Distinct channels: the V35 partial unique index allows only one API account per (org,
        // channel), and single-flight keys on (account, dataType) regardless of channel anyway.
        UUID accountA = seedAccount(org, seedChannel("SF-INDEP-A"));
        UUID accountB = seedAccount(org, seedChannel("SF-INDEP-B"));

        int perAccount = 4;
        ExecutorService pool = Executors.newFixedThreadPool(perAccount * 2);
        CountDownLatch start = new CountDownLatch(1);

        List<Callable<Void>> tasks = new ArrayList<>();
        for (UUID acct : List.of(accountA, accountB)) {
            for (int i = 0; i < perAccount; i++) {
                tasks.add(() -> {
                    start.await();
                    gate.beginRunOrCoalesce(acct, DataType.ORDER_SUMMARY, () -> newRunning(org, acct));
                    return null;
                });
            }
        }
        List<Future<Void>> futures = new ArrayList<>();
        for (Callable<Void> t : tasks) {
            futures.add(pool.submit(t));
        }
        start.countDown();
        for (Future<Void> f : futures) {
            f.get();
        }
        pool.shutdown();

        assertThat(syncJobs.findRunningBySellerAccountIdAndDataType(accountA, "ORDER_SUMMARY")).hasSize(1);
        assertThat(syncJobs.findRunningBySellerAccountIdAndDataType(accountB, "ORDER_SUMMARY")).hasSize(1);
    }

    // --- helpers ---

    private SyncJob newRunning(UUID org, UUID account) {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setSellerAccountId(account);
        job.setDataType(DataType.ORDER_SUMMARY.name());
        job.setStatus("RUNNING");
        job.setTrigger("MANUAL");
        job.setJobType("PG-PROOF");
        job.setStartedAt(Instant.now());
        return syncJobs.saveAndFlush(job);
    }

    private UUID seedOrg() {
        Organization o = new Organization();
        o.setName("sf-" + UUID.randomUUID().toString().substring(0, 8));
        return organizations.save(o).getId();
    }

    private UUID seedChannel(String code) {
        return channels.findByCode(code).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode(code);
            c.setNameKo(code);
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSortOrder(0);
            return channels.save(c);
        }).getId();
    }

    private UUID seedAccount(UUID org, UUID channel) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(org);
        a.setChannelId(channel);
        a.setConnectionStatus(ChannelStatus.PENDING);
        a.setFileUpload(false);
        return accounts.save(a).getId();
    }
}
