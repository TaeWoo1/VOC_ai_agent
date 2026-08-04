package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.DataType;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Single-flight admission + orphaned-run recovery logic for {@link SyncRunGate}, over a real (H2) DB.
 * The <b>concurrent</b> race (two starts colliding on the account row lock) needs committed
 * cross-thread transactions and is proven in {@code SyncRunSingleFlightPostgresProofIT}; here we pin
 * the sequential semantics the gate guarantees: create when idle, coalesce onto a fresh RUNNING run,
 * reclaim an orphaned RUNNING run past the stale limit (never a fresh one), and stay independent per
 * account and per data type.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class SyncRunGateTest {

    private static final long STALE_MINUTES = 60;

    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired SyncJobRepository syncJobs;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private SyncRunGate gate;
    private UUID accountId;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        gate = new SyncRunGate(accounts, syncJobs, txManager, STALE_MINUTES);
        Channel ch = channel("NAVER");
        channelId = ch.getId();
        accountId = account(channelId).getId();
    }

    @Test
    void createsANewRunWhenNoneIsInFlight() {
        AtomicInteger created = new AtomicInteger();
        SyncRunGate.RunStart start = gate.beginRunOrCoalesce(
                accountId, DataType.ORDER_SUMMARY, () -> { created.incrementAndGet(); return newRunning(DataType.ORDER_SUMMARY, Instant.now()); });

        assertThat(start.coalesced()).isFalse();
        assertThat(created.get()).isEqualTo(1);
        assertThat(runningCount(accountId, DataType.ORDER_SUMMARY)).isEqualTo(1);
    }

    @Test
    void coalescesOntoAFreshRunningRunWithoutCreatingASecond() {
        SyncJob inFlight = newRunning(DataType.ORDER_SUMMARY, Instant.now());
        AtomicInteger created = new AtomicInteger();

        SyncRunGate.RunStart start = gate.beginRunOrCoalesce(
                accountId, DataType.ORDER_SUMMARY, () -> { created.incrementAndGet(); return newRunning(DataType.ORDER_SUMMARY, Instant.now()); });

        assertThat(start.coalesced()).isTrue();
        assertThat(start.job().getId()).isEqualTo(inFlight.getId()); // returns the in-flight run
        assertThat(created.get()).isZero(); // factory never invoked
        assertThat(runningCount(accountId, DataType.ORDER_SUMMARY)).isEqualTo(1);
    }

    @Test
    void reclaimsAnOrphanedStaleRunThenStartsAFreshOne() {
        SyncJob orphan = newRunning(DataType.ORDER_SUMMARY,
                Instant.now().minus(Duration.ofMinutes(STALE_MINUTES + 5)));

        SyncRunGate.RunStart start = gate.beginRunOrCoalesce(
                accountId, DataType.ORDER_SUMMARY, () -> newRunning(DataType.ORDER_SUMMARY, Instant.now()));

        // The orphan is failed closed with a stable sanitized message + finishedAt; a new run starts.
        SyncJob reclaimed = syncJobs.findById(orphan.getId()).orElseThrow();
        assertThat(reclaimed.getStatus()).isEqualTo("FAILED");
        assertThat(reclaimed.getFinishedAt()).isNotNull();
        assertThat(reclaimed.getErrorMessage()).isEqualTo(SyncRunGate.STALE_ERROR);
        assertThat(start.coalesced()).isFalse();
        assertThat(runningCount(accountId, DataType.ORDER_SUMMARY)).isEqualTo(1);
    }

    @Test
    void aFreshRunningRunIsNeverReclaimed() {
        SyncJob fresh = newRunning(DataType.ORDER_SUMMARY,
                Instant.now().minus(Duration.ofMinutes(5))); // well within the stale window

        SyncRunGate.RunStart start = gate.beginRunOrCoalesce(
                accountId, DataType.ORDER_SUMMARY, () -> newRunning(DataType.ORDER_SUMMARY, Instant.now()));

        assertThat(start.coalesced()).isTrue();
        assertThat(syncJobs.findById(fresh.getId()).orElseThrow().getStatus()).isEqualTo("RUNNING");
    }

    @Test
    void multipleOrphansAreAllReclaimedBeforeStarting() {
        newRunning(DataType.ORDER_SUMMARY, Instant.now().minus(Duration.ofMinutes(STALE_MINUTES + 10)));
        newRunning(DataType.ORDER_SUMMARY, Instant.now().minus(Duration.ofMinutes(STALE_MINUTES + 30)));

        SyncRunGate.RunStart start = gate.beginRunOrCoalesce(
                accountId, DataType.ORDER_SUMMARY, () -> newRunning(DataType.ORDER_SUMMARY, Instant.now()));

        assertThat(start.coalesced()).isFalse();
        assertThat(runningCount(accountId, DataType.ORDER_SUMMARY)).isEqualTo(1); // both orphans failed
    }

    @Test
    void aRunningJobWithNoStartedAtIsReclaimedViaCreatedAtFallback() {
        // Defensive: a RUNNING row carrying no startedAt must still be reclaimable (via createdAt),
        // not block coalescing forever. Persist an old createdAt so it falls past the stale window.
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setChannelId(channelId);
        job.setSellerAccountId(accountId);
        job.setDataType(DataType.ORDER_SUMMARY.name());
        job.setStatus("RUNNING");
        job.setTrigger("MANUAL");
        job.setJobType("TEST");
        job.setStartedAt(null);
        job.setCreatedAt(Instant.now().minus(Duration.ofMinutes(STALE_MINUTES + 10)));
        SyncJob orphan = syncJobs.save(job);

        SyncRunGate.RunStart start = gate.beginRunOrCoalesce(
                accountId, DataType.ORDER_SUMMARY, () -> newRunning(DataType.ORDER_SUMMARY, Instant.now()));

        assertThat(syncJobs.findById(orphan.getId()).orElseThrow().getStatus()).isEqualTo("FAILED");
        assertThat(start.coalesced()).isFalse();
        assertThat(runningCount(accountId, DataType.ORDER_SUMMARY)).isEqualTo(1);
    }

    @Test
    void singleFlightIsIndependentPerAccountAndPerDataType() {
        newRunning(DataType.ORDER_SUMMARY, Instant.now()); // in-flight for (this account, ORDER_SUMMARY)

        // Different account, same data type → not coalesced (its own run).
        UUID otherAccount = account(channelId).getId();
        SyncRunGate.RunStart other = gate.beginRunOrCoalesce(
                otherAccount, DataType.ORDER_SUMMARY, () -> newRunning(otherAccount, DataType.ORDER_SUMMARY, Instant.now()));
        assertThat(other.coalesced()).isFalse();

        // Same account, different data type → not coalesced.
        SyncRunGate.RunStart review = gate.beginRunOrCoalesce(
                accountId, DataType.REVIEW, () -> newRunning(DataType.REVIEW, Instant.now()));
        assertThat(review.coalesced()).isFalse();
    }

    // --- helpers ---

    private int runningCount(UUID account, DataType dataType) {
        return syncJobs.findRunningBySellerAccountIdAndDataType(account, dataType.name()).size();
    }

    private SyncJob newRunning(DataType dataType, Instant startedAt) {
        return newRunning(accountId, dataType, startedAt);
    }

    private SyncJob newRunning(UUID account, DataType dataType, Instant startedAt) {
        SyncJob job = new SyncJob();
        job.setOrgId(org);
        job.setChannelId(channelId);
        job.setSellerAccountId(account);
        job.setDataType(dataType.name());
        job.setStatus("RUNNING");
        job.setTrigger("MANUAL");
        job.setJobType("TEST");
        job.setStartedAt(startedAt);
        return syncJobs.save(job);
    }

    private Channel channel(String code) {
        return channels.findByCode(code).orElseGet(() -> {
            Channel c = new Channel();
            c.setCode(code);
            c.setNameKo(code);
            c.setStatus(ChannelStatus.AVAILABLE);
            c.setSortOrder(0);
            return channels.save(c);
        });
    }

    private SellerAccount account(UUID channel) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channel);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return accounts.save(acc);
    }
}
