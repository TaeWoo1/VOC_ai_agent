package com.sellerops.attention.triage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.AdditionalAnswers.delegatesTo;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.triage.dto.TriageDecisionResponse;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The races, driven to an exact interleaving.
 *
 * <p><b>Why {@code @SpringBootTest} and not {@code @DataJpaTest}.</b> {@code @DataJpaTest}
 * wraps each test in a transaction and rolls it back, so two "concurrent" calls would share
 * one transaction and never contend: every race here would be structurally unreachable and
 * every test would pass green while proving nothing.
 *
 * <p><b>Deterministic, not hopeful.</b> An earlier version of this class started both
 * threads behind a {@link CountDownLatch} start gate and trusted them to collide. They
 * usually did — but a start gate is not a rendezvous, and when the threads happened to
 * serialize, every assertion still passed via the service's fast path. Measured against a
 * deliberately reverted fix, roughly one repetition in six proved nothing, and no assertion
 * could tell the difference. So the tests below do not race and hope: they stall one caller
 * at a known point via a gated repository, drive the other to commit, and then release the
 * first — forcing the exact interleaving under test, every run. Each also asserts that the
 * recovery path ACTUALLY RAN, so a test that stops exercising it fails rather than passes
 * quietly. The {@link RepeatedTest} stress cases at the end are kept only as extra shaking;
 * they are not the proof.
 *
 * <p>The gate is a test-side decorator over a repository — production code has no test hook
 * and no knowledge of any of this.
 *
 * <p><b>Which means this test commits — into its own database.</b> The shared
 * {@code sellerops_test} instance is JVM-wide ({@code DB_CLOSE_DELAY=-1}) and every
 * {@code @DataJpaTest} rolls back into it; a committing class there leaks, and
 * {@code channel.code} is globally UNIQUE, so one stranded row fails a dozen unrelated
 * classes. Same pattern as {@code InquiryWorkItemDismissalRollbackTest}. That containment
 * matters most exactly here: a test that deliberately parks a thread on a row lock has
 * failure modes a shared database would turn into someone else's problem.
 *
 * <p><b>{@code sellerops.seed.enabled=false}</b> is not optional for this one.
 * {@code @SpringBootTest} loads {@code MockDataSeeder} (a {@code @Component}, which the
 * {@code @DataJpaTest} slice excludes — so no existing test has ever run it), and its
 * baseline group seeds a demo org, user, and 13-channel catalog on an empty DB regardless of
 * the demo-content flag. Those rows COMMIT and collide with this class's own NAVER channel.
 *
 * <p><b>Teardown order is load-bearing</b>, see {@link #cleanUp}: gates are released and
 * workers terminated BEFORE any delete, because a parked worker holds a row lock and would
 * otherwise deadlock the cleanup that is supposed to contain it.
 *
 * <p>Hermetic: no network, no marketplace, no credentials; every review body is synthetic.
 */
@SpringBootTest
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ReviewTriageConcurrencyTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_review_triage_concurrency;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    /** Stress only — the deterministic tests above it are what prove the behaviour. */
    private static final int STRESS_REPEATS = 8;
    /** Generous: these only bound a hang, never a happy path. */
    private static final int GATE_TIMEOUT_SEC = 20;

    @Autowired ReviewTriageService service;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewTriageAuditRepository audits;
    @Autowired ReviewRepository reviews;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;
    @Autowired Environment env;

    /**
     * Per-test, not static: a worker parked on a gate must not be able to outlive the test
     * that created it and surface inside the next one.
     */
    private ExecutorService pool;
    /** Every gate handed out this test, so teardown can release them without the test's help. */
    private final List<Gate> gates = new ArrayList<>();
    /** Every future submitted this test, so teardown can cancel any that never returned. */
    private final List<Future<?>> submitted = new ArrayList<>();

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private static final String BODY = "합성-리뷰-본문-불만";

    private UUID channel;
    private UUID account;
    private Review review;
    private String ref;

    @BeforeEach
    void setUp() {
        pool = Executors.newFixedThreadPool(4);
        channel = seedChannel();
        account = seedAccount();
        review = seedReview();
        ref = VocItemRef.forReview(review.getId());
    }

    /**
     * Teardown in a strict order, because getting it wrong turns one failure into a suite.
     *
     * <p>A gated worker parks INSIDE the writer's transaction holding a {@code FOR UPDATE}
     * row lock. If a test fails before releasing it — which is exactly what the lock
     * assertions are built to do — then deleting {@code review_triage} first would block on
     * that lock until H2's timeout, throw, and skip the remaining deletes. The last of those
     * is {@code channels}, whose {@code code} is UNIQUE, so the class's own next test would
     * fail on seeding rather than on anything real.
     *
     * <p>So: release every gate, cancel and terminate every worker, and only then touch the
     * database. Release-and-terminate is the {@code finally} for the whole class — the tests
     * also release their own gates on their way out, but nothing depends on them getting
     * there.
     */
    @AfterEach
    void cleanUp() throws InterruptedException {
        gates.forEach(Gate::releaseAll);
        submitted.forEach(f -> f.cancel(true));
        pool.shutdownNow();
        boolean terminated = pool.awaitTermination(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);
        gates.clear();
        submitted.clear();

        audits.deleteAll();
        triages.deleteAll();
        reviews.deleteAll();
        sellerAccounts.deleteAll();
        channels.deleteAll();

        // Asserted after the deletes so a stuck worker is reported, not silently tolerated —
        // and so the deletes still run and leave the next test a clean database.
        assertThat(terminated)
                .withFailMessage("a worker thread outlived its test; it could still commit "
                        + "after this cleanup and corrupt the next test's fixture")
                .isTrue();
    }

    // --- the configuration the recovery silently depends on ---------------------

    /**
     * {@code open-in-view} must stay off, and this is the only thing that says so.
     *
     * <p>It reads like a performance setting and is load-bearing for correctness. With OSIV
     * on, a request-bound EntityManager is reused by the writer's transaction, so the
     * locking read would return the already-cached instance instead of the freshly locked
     * row — and {@code disposition_from} could be stale even WITH the lock held. That is an
     * untruthful audit row that no constraint and no retry can detect. Nobody flipping this
     * for an unrelated lazy-loading reason would connect it to audit integrity, so the link
     * is asserted rather than left to be rediscovered.
     */
    @Test
    void openInViewMustStayDisabledBecauseTheAuditChainDependsOnIt() {
        assertThat(env.getProperty("spring.jpa.open-in-view")).isEqualTo("false");
    }

    /**
     * The writer owns its transaction boundary even when a caller already has one.
     *
     * <p>This pins {@code REQUIRES_NEW}, which is the structural half of the recovery
     * contract and the half nothing else would notice losing. Under the default
     * {@code REQUIRED} the writer joins the caller's transaction instead: its commit — and
     * therefore the constraint violation — moves out to the caller's boundary, past
     * {@code resolveRace}'s catch, and a concurrent replay silently answers 500 again. No
     * other test would fail, because {@code decide} has no ambient transaction today. That
     * is exactly the kind of guarantee that has to be asserted while it is true.
     *
     * <p>Driven through a caller that rolls back: only a decision committed in its OWN
     * transaction survives.
     */
    @Test
    void theWriterCommitsInItsOwnTransactionEvenWhenTheCallerLaterRollsBack() {
        TransactionTemplate caller = new TransactionTemplate(txManager);

        try {
            caller.executeWithoutResult(status -> {
                service.decide(org, account, ref, "MONITOR", "cmd-1", user);
                throw new IllegalStateException("caller fails after the decision was recorded");
            });
        } catch (IllegalStateException expected) {
            // The caller's transaction rolled back.
        }

        assertThat(triages.findByOrgIdAndReviewId(org, review.getId()))
                .withFailMessage("the decision was rolled back with the caller — the writer joined the "
                        + "caller's transaction instead of owning one, which also makes resolveRace's "
                        + "catch dead code and reverts concurrent replays to 500")
                .isPresent();
        assertThat(audits.findByOrgIdAndCommandId(org, "cmd-1")).isPresent();
    }

    // --- deterministic: the unique-conflict recovery path -----------------------

    /**
     * An identical replay that loses the race recovers as a replay — the blocker this whole
     * arrangement exists for.
     *
     * <p>Forced, not hoped for: the loser is stalled immediately after its fast-path lookup
     * has returned empty, the winner is then driven to commit, and only then is the loser
     * released. Its write MUST hit {@code uq_review_triage_audit_org_command}, so it MUST go
     * through {@code resolveRace}. Proven, not assumed: the fast path is recorded as having
     * seen nothing, and the only way to answer {@code replayed=true} after an empty fast-path
     * read is the recovery path.
     */
    @Test
    void aLosingIdenticalReplayRecoversThroughTheConflictPathAndReturns200() throws Exception {
        AuditGate gate = new AuditGate();
        ReviewTriageService gated = gate.serviceGatedOnFastPathLookup();

        Future<Outcome> loser = submit(() ->
                call(() -> gated.decide(org, account, ref, "RESPONSE_NEEDED", "cmd-1", user)));
        Outcome o;
        try {
            gate.awaitStalled();
            // The winner commits while the loser is held past its fast path.
            decide(ref, "RESPONSE_NEEDED", "cmd-1");
        } finally {
            gate.releaseAll();
        }

        o = await(loser);
        assertNoServerError(o);
        assertThat(gate.fastPathSawNothing()).isTrue();      // it could not have short-circuited
        assertThat(o.response.replayed()).isTrue();          // ...so this came from resolveRace
        assertThat(o.response.disposition()).isEqualTo("RESPONSE_NEEDED");
        // Applied exactly once.
        assertThat(audits.findAll()).hasSize(1);
        assertThat(triages.findAll()).hasSize(1);
        assertThat(currentDisposition()).isEqualTo(TriageDisposition.RESPONSE_NEEDED);
    }

    /**
     * A losing FIRST decision is retried as an update rather than dropped. The loser's
     * command is legitimate and unapplied; it only ever attempted an INSERT because the row
     * did not exist when it looked.
     *
     * <p><b>Gated on the LOCKING read, not the fast-path lookup</b> — and that distinction is
     * the whole test. Stalling at the fast-path lookup looks equivalent but is not: by the
     * time such a loser reached the writer, the winner's row would already exist, so it would
     * take the ordinary UPDATE branch and never conflict at all. That version of this test
     * passed against a deliberately broken {@code resolveRace}, because it was quietly
     * exercising a sequential update. The loser has to be held AFTER it has looked for the
     * row and found none — committed to inserting — for the {@code review_id} conflict to be
     * the thing under test.
     *
     * <p>The {@code from} assertion is what proves the retry: it can only be the winner's
     * disposition if the retry re-read under the lock. Had it reused what it saw before the
     * failed insert, it would record {@code null} and the history would claim two first
     * decisions.
     */
    @Test
    void aLosingFirstDecisionIsRetriedAsAnUpdateAndRecordsTheWinnerAsItsPredecessor() throws Exception {
        LockGate gate = new LockGate();
        ReviewTriageService gated = gate.serviceGatedOnLockingRead();

        Future<Outcome> loser = submit(() ->
                call(() -> gated.decide(org, account, ref, "NO_ACTION", "cmd-b", user)));
        try {
            gate.awaitHoldingLock();   // loser has read, found no row, and is committed to INSERT
            decide(ref, "RESPONSE_NEEDED", "cmd-a");   // winner creates the row underneath it
        } finally {
            gate.releaseAll();
        }

        Outcome o = await(loser);
        assertNoServerError(o);
        // It genuinely intended an INSERT, so its write genuinely hit uq_review_triage_review.
        assertThat(gate.firstReadFoundNoRow()).isTrue();
        assertThat(o.response.replayed()).isFalse();     // a fresh decision, not a replay
        assertThat(o.response.disposition()).isEqualTo("NO_ACTION");

        assertThat(triages.findAll()).hasSize(1);
        assertThat(audits.findAll()).hasSize(2);
        assertThat(currentDisposition()).isEqualTo(TriageDisposition.NO_ACTION);
        // The retry re-read under the lock: its predecessor is the winner's value, not null.
        assertThat(auditFor("cmd-b").getDispositionFrom()).isEqualTo(TriageDisposition.RESPONSE_NEEDED);
        assertThat(auditFor("cmd-a").getDispositionFrom()).isNull();
        assertTruthfulChain();
    }

    /**
     * One command id, two different decisions, with the loser forced through the conflict
     * path: exactly one 409, never a 500, never a second effect.
     */
    @Test
    void aLosingConflictingReuseOfOneCommandIdIsRejectedWith409() throws Exception {
        AuditGate gate = new AuditGate();
        ReviewTriageService gated = gate.serviceGatedOnFastPathLookup();

        Future<Outcome> loser = submit(() ->
                call(() -> gated.decide(org, account, ref, "NO_ACTION", "cmd-1", user)));
        try {
            gate.awaitStalled();
            decide(ref, "RESPONSE_NEEDED", "cmd-1");   // same id, other decision, commits first
        } finally {
            gate.releaseAll();
        }

        Outcome o = await(loser);
        assertThat(gate.fastPathSawNothing()).isTrue();
        assertThat(o.response).isNull();
        assertThat(o.error).isInstanceOf(ApiException.class);
        assertThat(((ApiException) o.error).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        // One command id, one effect — the loser's decision was refused, not applied.
        assertThat(audits.findAll()).hasSize(1);
        assertThat(currentDisposition()).isEqualTo(TriageDisposition.RESPONSE_NEEDED);
    }

    // --- deterministic: the lock actually serializes -----------------------------

    /**
     * Concurrent updates to an EXISTING decision are serialized by the writer's row lock.
     *
     * <p>This is the case no constraint can catch — the command ids differ, so nothing
     * collides — and the only reason the trail stays honest. The interleaving is forced: A
     * is held INSIDE its transaction with the lock already taken and {@code from} already
     * read, and B is only released to attempt its own locking read while A still holds it.
     *
     * <p><b>Asserted on the state, not on the mechanism.</b> An earlier version also asserted
     * that B had not finished while A was held — a {@code sleep} plus {@code isDone()}. It is
     * gone for two reasons: it pinned HOW serialization is achieved rather than WHAT must be
     * true, so a correct implementation using optimistic versioning or SERIALIZABLE retries
     * would fail it despite keeping the trail honest; and under load it could false-fail by
     * blaming the lock for a starved thread. What remains proves the same thing more
     * directly — B's recorded predecessor is A's value, and the chain composes. Without the
     * lock B reads MONITOR (A has not committed), both rows claim MONITOR, and all three
     * assertions below fail independently.
     */
    @Test
    void concurrentUpdatesToAnExistingDecisionAreSerializedByTheRowLock() throws Exception {
        decide(ref, "MONITOR", "cmd-seed");   // ungated: the row must exist to be locked

        LockGate gate = new LockGate();
        ReviewTriageService gated = gate.serviceGatedOnLockingRead();

        Future<Outcome> a = submit(() ->
                call(() -> gated.decide(org, account, ref, "RESPONSE_NEEDED", "cmd-a", user)));
        Future<Outcome> b;
        try {
            gate.awaitHoldingLock();   // A is inside its tx, lock taken, `from` read
            b = submit(() ->
                    call(() -> gated.decide(org, account, ref, "NO_ACTION", "cmd-b", user)));
            // B has entered its locking read while A still holds the row. This is the window
            // in which an unlocked read would return the value A is about to replace.
            gate.awaitAtLockingRead();
        } finally {
            gate.releaseAll();
        }

        Outcome oa = await(a);
        Outcome ob = await(b);
        assertNoServerError(oa);
        assertNoServerError(ob);

        assertThat(audits.findAll()).hasSize(3);
        assertThat(triages.findAll()).hasSize(1);
        // B waited, then read what A actually left behind.
        assertThat(auditFor("cmd-b").getDispositionFrom()).isEqualTo(TriageDisposition.RESPONSE_NEEDED);
        assertThat(auditFor("cmd-a").getDispositionFrom()).isEqualTo(TriageDisposition.MONITOR);
        assertThat(currentDisposition()).isEqualTo(TriageDisposition.NO_ACTION);
        assertTruthfulChain();
    }

    // --- stress: extra shaking, not proof ---------------------------------------

    /**
     * The one surviving stress case, and the only one that was ever safe to run.
     *
     * <p>The three insert-racing stress tests that sat here are gone. They raced two callers
     * into a concurrent INSERT on a UNIQUE index, and H2 does not wait for an uncommitted
     * conflicting entry the way Postgres does — it raises {@code 90131 CONCURRENT_UPDATE_1}
     * immediately. {@code H2Dialect} does not map that code, so it would arrive as an
     * uncategorized exception, escape {@code resolveRace}'s catch, and fail the test. They got
     * MORE likely to fail the better they raced, for a reason with nothing to do with the code
     * under test — the same "green tells you nothing" failure this class exists to end,
     * inverted. Production is unaffected (Postgres blocks, then raises 23505), and the
     * deterministic tests above are immune because the winner has always committed by the time
     * the loser writes. They also cover every path those three did, and prove it.
     *
     * <p>This case is different: the seeded row means the writers serialize on the row lock
     * rather than colliding on an index, so there is no uncommitted-conflict window to hit.
     */
    @RepeatedTest(STRESS_REPEATS)
    void stressSimultaneousUpdatesKeepTheChainTruthful() {
        decide(ref, "MONITOR", "cmd-seed");
        List<Outcome> outcomes = raceTwo(
                () -> decide(ref, "RESPONSE_NEEDED", "cmd-a"),
                () -> decide(ref, "NO_ACTION", "cmd-b"));

        outcomes.forEach(ReviewTriageConcurrencyTest::assertNoServerError);
        assertThat(audits.findAll()).hasSize(3);
        assertTruthfulChain();
    }

    // --- gates ------------------------------------------------------------------

    /**
     * Stalls the FIRST {@code findByOrgIdAndCommandId} — the service's fast-path idempotency
     * lookup — so a second caller can commit underneath it, forcing the stalled caller's
     * write into a UNIQUE conflict and thus into {@code resolveRace}.
     *
     * <p>Only the first call is gated: {@code resolveRace} re-reads through the same
     * repository, and stalling that would deadlock the very path under test.
     */
    /** Anything that can park a worker, and must therefore be releasable from teardown. */
    private interface Gate {
        void releaseAll();
    }

    private final class AuditGate implements Gate {
        private final CountDownLatch stalled = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private final AtomicBoolean firstCall = new AtomicBoolean(true);
        private final AtomicBoolean sawNothing = new AtomicBoolean(false);

        AuditGate() {
            gates.add(this);
        }

        @Override
        public void releaseAll() {
            release.countDown();
        }

        ReviewTriageService serviceGatedOnFastPathLookup() {
            ReviewTriageAuditRepository gated = mock(ReviewTriageAuditRepository.class, delegatesTo(audits));
            doAnswer(inv -> {
                Optional<ReviewTriageAudit> real =
                        audits.findByOrgIdAndCommandId(inv.getArgument(0), inv.getArgument(1));
                if (firstCall.getAndSet(false)) {
                    sawNothing.set(real.isEmpty());
                    stalled.countDown();
                    if (!release.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("fast-path gate was never released");
                    }
                }
                return real;
            }).when(gated).findByOrgIdAndCommandId(any(), any());
            return new ReviewTriageService(triages, gated, reviews, sellerAccounts,
                    new ReviewTriageWriter(triages, gated, txManager));
        }

        void awaitStalled() throws InterruptedException {
            assertThat(stalled.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS))
                    .withFailMessage("the gated caller never reached its fast-path lookup")
                    .isTrue();
        }

        /** True if the stalled caller's fast path found nothing — i.e. it could not short-circuit. */
        boolean fastPathSawNothing() {
            return sawNothing.get();
        }
    }

    /**
     * Holds the FIRST caller inside the writer's transaction with the row lock taken and
     * {@code from} already read, and signals when a SECOND caller has entered its own locking
     * read. That is the exact window in which an unlocked read would return a stale value.
     */
    private final class LockGate implements Gate {
        private final CountDownLatch holdingLock = new CountDownLatch(1);
        private final CountDownLatch atLockingRead = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private final AtomicInteger calls = new AtomicInteger();
        private final AtomicBoolean firstReadEmpty = new AtomicBoolean(false);

        LockGate() {
            gates.add(this);
        }

        @Override
        public void releaseAll() {
            release.countDown();
        }

        ReviewTriageService serviceGatedOnLockingRead() {
            ReviewTriageRepository gated = mock(ReviewTriageRepository.class, delegatesTo(triages));
            doAnswer(inv -> {
                int n = calls.incrementAndGet();
                // Signalled BEFORE the real call, because the real call is where B blocks.
                if (n == 2) {
                    atLockingRead.countDown();
                }
                Optional<ReviewTriage> real =
                        triages.lockByOrgIdAndReviewId(inv.getArgument(0), inv.getArgument(1));
                if (n == 1) {
                    firstReadEmpty.set(real.isEmpty());
                    holdingLock.countDown();
                    if (!release.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("lock-holder gate was never released");
                    }
                }
                return real;
            }).when(gated).lockByOrgIdAndReviewId(any(), any());
            return new ReviewTriageService(gated, audits, reviews, sellerAccounts,
                    new ReviewTriageWriter(gated, audits, txManager));
        }

        /**
         * True if the held caller's locking read found no row — i.e. it was committed to an
         * INSERT, so a row appearing underneath it must produce a {@code review_id} conflict.
         */
        boolean firstReadFoundNoRow() {
            return firstReadEmpty.get();
        }

        void awaitHoldingLock() throws InterruptedException {
            assertThat(holdingLock.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS))
                    .withFailMessage("caller A never took the row lock").isTrue();
        }

        void awaitAtLockingRead() throws InterruptedException {
            assertThat(atLockingRead.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS))
                    .withFailMessage("caller B never reached its locking read").isTrue();
        }
    }

    // --- helpers ----------------------------------------------------------------

    /**
     * The whole trail must form ONE contiguous path from null (the review's first decision)
     * to the row's current disposition, consuming every row exactly once.
     *
     * <p>Structural rather than timestamp-ordered, deliberately: what has to hold is that
     * the history COMPOSES. Sorting by {@code created_at} would assert that two clock reads
     * agree — flakier, and weaker, since a trail can be perfectly ordered and still name a
     * predecessor that was never the row's value.
     */
    private void assertTruthfulChain() {
        List<ReviewTriageAudit> rows = new ArrayList<>(audits.findAll());
        TriageDisposition cursor = null;
        // Bound captured up front: the loop removes as it walks, so `rows.size()` would
        // shrink under the condition and stop it half way through the chain.
        int hops = rows.size();
        for (int step = 0; step < hops; step++) {
            final TriageDisposition from = cursor;
            ReviewTriageAudit next = rows.stream()
                    .filter(r -> r.getDispositionFrom() == from)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError(
                            "audit trail has no row transitioning FROM " + from
                                    + " — the chain is broken, so some row records a predecessor that "
                                    + "was never the row's value. Remaining: " + describe(rows)));
            rows.remove(next);
            cursor = next.getDispositionTo();
        }
        assertThat(cursor).isEqualTo(currentDisposition());
    }

    private static String describe(List<ReviewTriageAudit> rows) {
        return rows.stream().map(r -> r.getDispositionFrom() + "->" + r.getDispositionTo()).toList().toString();
    }

    private ReviewTriageAudit auditFor(String commandId) {
        return audits.findByOrgIdAndCommandId(org, commandId).orElseThrow();
    }

    private TriageDisposition currentDisposition() {
        return triages.findByOrgIdAndReviewId(org, review.getId()).orElseThrow().getDisposition();
    }

    /** Fails on anything that is not a deliberate ApiException — a 500 is the bug. */
    private static void assertNoServerError(Outcome o) {
        if (o.error != null && !(o.error instanceof ApiException)) {
            throw new AssertionError(
                    "a concurrent caller got a non-ApiException, which the handler turns into a 500: "
                            + o.error, o.error);
        }
    }

    private static Outcome call(Callable<TriageDecisionResponse> c) {
        try {
            return new Outcome(c.call(), null);
        } catch (Throwable t) {
            return new Outcome(null, t);
        }
    }

    /** Submit a worker, remembering it so teardown can cancel it if it never returns. */
    private Future<Outcome> submit(Callable<Outcome> work) {
        Future<Outcome> f = pool.submit(work);
        submitted.add(f);
        return f;
    }

    /**
     * Wait for a worker, and CANCEL it if it does not arrive.
     *
     * <p>A bare {@code Future.get(timeout)} throws without cancelling: the worker keeps
     * running, the test fails, cleanup deletes everything, and then the orphan commits its
     * rows into a database that is supposed to be empty — corrupting the NEXT test rather
     * than this one. The interrupt is what stops that.
     */
    private Outcome await(Future<Outcome> f) {
        try {
            return f.get(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            f.cancel(true);
            throw new AssertionError("a gated caller never returned within " + GATE_TIMEOUT_SEC
                    + "s — deadlocked, or a gate was never released", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("interrupted waiting for a gated caller", e);
        } catch (ExecutionException e) {
            throw new AssertionError("a gated caller threw outside its Outcome wrapper", e);
        }
    }

    /** Stress only: a start gate, which is why this cannot be the proof. */
    private List<Outcome> raceTwo(Callable<TriageDecisionResponse> a, Callable<TriageDecisionResponse> b) {
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Outcome>> futures = List.of(
                submit(() -> { start.await(); return call(a); }),
                submit(() -> { start.await(); return call(b); }));
        start.countDown();
        return futures.stream().map(this::await).toList();
    }

    /** Exactly one of the two is set. */
    private record Outcome(TriageDecisionResponse response, Throwable error) {
    }

    private TriageDecisionResponse decide(String actionRef, String disposition, String commandId) {
        return service.decide(org, account, actionRef, disposition, commandId, user);
    }

    private UUID seedChannel() {
        Channel ch = new Channel();
        ch.setCode("NAVER");
        ch.setNameKo("네이버 스마트스토어");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    private UUID seedAccount() {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(channel);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        return sellerAccounts.save(acc).getId();
    }

    /** A synthetic ingested review; {@code receivedAt} is explicit, never a clock read. */
    private Review seedReview() {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(channel);
        r.setRating(2);
        r.setBody(BODY);
        r.setNegative(true);
        r.setReceivedAt(Instant.parse("2026-05-10T03:00:00Z"));
        return reviews.save(r);
    }
}
