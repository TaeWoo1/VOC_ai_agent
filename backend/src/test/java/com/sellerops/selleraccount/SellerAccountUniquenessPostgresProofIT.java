package com.sellerops.selleraccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
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
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Disposable-Postgres proof for the seller-account uniqueness hardening (V36). The H2 suite cannot host
 * a filtered index and runs with Flyway off, so the actual DB enforcement is proven here: boot the real
 * context against a throwaway PostgreSQL where <b>real Flyway applies V1..V36</b> and assert the partial
 * unique index {@code uq_seller_accounts_api_org_channel} behaves — one API-mode account per
 * (org, channel), file-upload accounts unrestricted (ESM), independent per org/channel, a true concurrent
 * insert race collapsing to a single row, and a fail-closed migration on pre-existing duplicates.
 *
 * <p><b>Opt-in only.</b> Gated by {@code SELLEROPS_PG_PROOF=1}; without it the class is skipped, so the
 * normal H2 gate and CI (no Postgres) are unaffected. Point it at the disposable DB with
 * {@code SELLEROPS_PG_URL} (default {@code jdbc:postgresql://localhost:55432/sellerops}); never a real DB.
 *
 * <p>Not {@code @Transactional}: rows/commits persist so the concurrency threads race over real commits.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class SellerAccountUniquenessPostgresProofIT {

    private static final String INDEX = "uq_seller_accounts_api_org_channel";

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

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired OrganizationRepository organizations;
    @Autowired JdbcTemplate jdbc;

    // 1 — real Flyway applied V36 and the partial unique index exists on Postgres.
    @Test
    void flywayAppliedV36AndPartialIndexExists() {
        Integer maxVersion = jdbc.queryForObject(
                "select max(cast(version as integer)) from flyway_schema_history where success", Integer.class);
        assertThat(maxVersion).isGreaterThanOrEqualTo(35);

        Integer idx = jdbc.queryForObject(
                "select count(*) from pg_indexes where indexname = ?", Integer.class, INDEX);
        assertThat(idx).isEqualTo(1);
        // It is a PARTIAL index (predicate present) — file-upload rows are outside its scope.
        String predicate = jdbc.queryForObject(
                "select pg_get_expr(i.indpred, i.indrelid) from pg_class c "
                        + "join pg_index i on i.indexrelid = c.oid where c.relname = ?", String.class, INDEX);
        assertThat(predicate).isNotNull();
        assertThat(predicate.replace(" ", "").toLowerCase())
                .as("index must be filtered to is_file_upload = false")
                .contains("is_file_upload=false");
    }

    // 2 — a second API-mode account for the same (org, channel) is rejected by the DB.
    @Test
    void secondApiAccountForSameOrgChannelIsRejected() {
        UUID org = seedOrg();
        UUID channel = seedChannel("PG-UNIQ-A").getId();
        accounts.saveAndFlush(account(org, channel, false));

        assertThatThrownBy(() -> accounts.saveAndFlush(account(org, channel, false)))
                .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(apiCount(org, channel)).isEqualTo(1);
    }

    // 3 — ESM safety: several FILE-UPLOAD accounts on one (org, channel) are ALLOWED (outside the index).
    @Test
    void multipleFileUploadAccountsOnOneChannelAreAllowed() {
        UUID org = seedOrg();
        UUID channel = seedChannel("PG-UNIQ-B").getId();

        accounts.saveAndFlush(account(org, channel, true));
        accounts.saveAndFlush(account(org, channel, true));
        accounts.saveAndFlush(account(org, channel, true));

        Integer fileCount = jdbc.queryForObject(
                "select count(*) from seller_accounts where org_id = ? and channel_id = ? and is_file_upload = true",
                Integer.class, org, channel);
        assertThat(fileCount).isEqualTo(3);
    }

    // 4 — independence: the same API-mode uniqueness is per (org, channel), so different org or channel is fine.
    @Test
    void apiAccountsInDifferentOrgOrChannelAreIndependent() {
        UUID orgA = seedOrg();
        UUID orgB = seedOrg();
        UUID chan1 = seedChannel("PG-UNIQ-C1").getId();
        UUID chan2 = seedChannel("PG-UNIQ-C2").getId();

        accounts.saveAndFlush(account(orgA, chan1, false));
        accounts.saveAndFlush(account(orgB, chan1, false)); // different org — allowed
        accounts.saveAndFlush(account(orgA, chan2, false)); // different channel — allowed

        assertThat(apiCount(orgA, chan1)).isEqualTo(1);
        assertThat(apiCount(orgB, chan1)).isEqualTo(1);
        assertThat(apiCount(orgA, chan2)).isEqualTo(1);
    }

    // 5 — a real concurrent insert race collapses to exactly one surviving API account.
    @Test
    void concurrentApiInsertRaceLeavesExactlyOneAccount() throws Exception {
        UUID org = seedOrg();
        UUID channel = seedChannel("PG-UNIQ-RACE").getId();

        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger ok = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();

        List<Callable<Void>> tasks = new java.util.ArrayList<>();
        for (int i = 0; i < threads; i++) {
            tasks.add(() -> {
                start.await();
                try {
                    accounts.saveAndFlush(account(org, channel, false));
                    ok.incrementAndGet();
                } catch (DataIntegrityViolationException race) {
                    rejected.incrementAndGet(); // the DB rejected this racer's duplicate insert
                }
                return null;
            });
        }
        List<Future<Void>> futures = new java.util.ArrayList<>();
        for (Callable<Void> t : tasks) {
            futures.add(pool.submit(t));
        }
        start.countDown(); // release all racers at once
        for (Future<Void> f : futures) {
            f.get();
        }
        pool.shutdown();

        // Exactly one insert won; every other racer was rejected by the unique index; one row persisted.
        assertThat(ok.get()).isEqualTo(1);
        assertThat(rejected.get()).isEqualTo(threads - 1);
        assertThat(apiCount(org, channel)).isEqualTo(1);
    }

    // 6 — fail closed: adding the index on a table that already carries duplicate API rows fails loudly.
    // NOTE: this method drops and recreates the shared index; it is safe under JUnit's default sequential
    // execution + the finally-restore below, but would need isolation if class-parallel execution were on.
    @Test
    void recreatingTheIndexOverExistingDuplicatesFailsClosed() {
        UUID org = seedOrg();
        UUID channel = seedChannel("PG-UNIQ-DUP").getId();
        jdbc.execute("drop index " + INDEX);
        try {
            // With the index gone, two API rows for one (org, channel) can be inserted — the "dirty data".
            accounts.saveAndFlush(account(org, channel, false));
            accounts.saveAndFlush(account(org, channel, false));

            // Re-adding the migration's index (as V36 does) must ABORT on the duplicate, not silently dedup.
            assertThatThrownBy(() -> jdbc.execute("create unique index " + INDEX
                    + " on seller_accounts (org_id, channel_id) where is_file_upload = false"))
                    .isInstanceOf(DataAccessException.class);
        } finally {
            // Restore a clean DB: drop the duplicates, then recreate the index so the schema + re-runs are sound.
            jdbc.update("delete from seller_accounts where org_id = ? and channel_id = ?", org, channel);
            jdbc.execute("create unique index if not exists " + INDEX
                    + " on seller_accounts (org_id, channel_id) where is_file_upload = false");
        }
    }

    // --- helpers ---

    private Integer apiCount(UUID org, UUID channel) {
        return jdbc.queryForObject(
                "select count(*) from seller_accounts where org_id = ? and channel_id = ? and is_file_upload = false",
                Integer.class, org, channel);
    }

    private UUID seedOrg() {
        Organization o = new Organization();
        o.setName("pg-uniq-" + UUID.randomUUID().toString().substring(0, 8));
        return organizations.save(o).getId();
    }

    private Channel seedChannel(String code) {
        return channels.findByCode(code).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode(code);
            c.setNameKo(code);
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSortOrder(0);
            return channels.save(c);
        });
    }

    private static SellerAccount account(UUID org, UUID channel, boolean fileUpload) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(org);
        a.setChannelId(channel);
        a.setConnectionStatus(ChannelStatus.PENDING);
        a.setFileUpload(fileUpload);
        return a;
    }
}
