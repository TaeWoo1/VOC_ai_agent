package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.AdditionalAnswers.delegatesTo;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalResponse;
import com.sellerops.attention.triage.ReviewTriageAuditRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.ReviewTriageService;
import com.sellerops.attention.triage.ReviewTriageWriter;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The approval races, driven to an exact interleaving. A focused mirror of
 * {@code ReviewTriageConcurrencyTest}, whose class notes explain the arrangement in full; the
 * essentials are restated here only where this class would be unreadable without them.
 *
 * <p><b>{@code @SpringBootTest}, not {@code @DataJpaTest}</b>: the latter wraps each test in
 * one transaction and rolls it back, so two "concurrent" calls would share a transaction and
 * never contend — every race would be structurally unreachable and every test would pass green
 * while proving nothing.
 *
 * <p><b>Deterministic, not hopeful</b>: each test stalls one caller at a known point via a
 * test-side gated repository decorator, drives the other to commit, then releases the first.
 * Each also asserts the recovery path ACTUALLY RAN, so a test that stops exercising it fails
 * rather than passes quietly. Production code has no test hook.
 *
 * <p>Its own database, because it commits — see the triage class's note on why a committing
 * class on the shared {@code sellerops_test} instance breaks unrelated suites.
 *
 * <p>Hermetic: no network, no marketplace, no credentials; every body is synthetic.
 */
@SpringBootTest
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ReviewReplyApprovalConcurrencyTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_review_reply_concurrency;MODE=PostgreSQL;"
                        + "DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    /** Generous: these only bound a hang, never a happy path. */
    private static final int GATE_TIMEOUT_SEC = 20;
    private static final String BODY = "합성-리뷰-본문-불만";
    private static final String DRAFT = "합성-답변-초안";

    @Autowired ReviewReplyService service;
    @Autowired ReviewReplyDraftRepository draftRepo;
    @Autowired ReviewReplyApprovalRepository approvalRepo;
    @Autowired ReviewReplyApprovalAuditRepository approvalAudits;
    @Autowired ReviewReplySubmissionRefRepository submissionRefRepo;
    @Autowired ReviewReplyOutcomeRepository outcomeRepo;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewTriageAuditRepository triageAudits;
    @Autowired ReviewRepository reviews;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;
    @Autowired Environment env;

    private ExecutorService pool;
    private final List<Releasable> gates = new ArrayList<>();
    private final List<Future<?>> submitted = new ArrayList<>();

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    private UUID channel;
    private UUID account;
    private Review review;
    private String ref;

    private interface Releasable {
        void releaseAll();
    }

    @BeforeEach
    void setUp() {
        pool = Executors.newFixedThreadPool(4);
        channel = seedChannel();
        account = seedAccount();
        review = seedReview();
        ref = VocItemRef.forReview(review.getId());
        // The gate is only reachable once a draft exists and the review is RESPONSE_NEEDED.
        new ReviewTriageService(triages, triageAudits, reviews, sellerAccounts,
                new ReviewTriageWriter(triages, triageAudits, txManager))
                .decide(org, account, ref, TriageDisposition.RESPONSE_NEEDED.name(),
                        UUID.randomUUID().toString(), user);
        service.saveDraft(org, account, ref, DRAFT, 0, user);
    }

    /**
     * Teardown in a strict order: a gated worker parks INSIDE the writer's transaction holding
     * a {@code FOR UPDATE} row lock, so deleting first would block on that lock until H2's
     * timeout and skip the remaining deletes — the last of which is {@code channels}, whose
     * {@code code} is UNIQUE. Release, terminate, then delete.
     */
    @AfterEach
    void cleanUp() throws InterruptedException {
        gates.forEach(Releasable::releaseAll);
        submitted.forEach(f -> f.cancel(true));
        pool.shutdownNow();
        boolean terminated = pool.awaitTermination(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);
        gates.clear();
        submitted.clear();

        approvalAudits.deleteAll();
        approvalRepo.deleteAll();
        draftRepo.deleteAll();
        triageAudits.deleteAll();
        triages.deleteAll();
        reviews.deleteAll();
        sellerAccounts.deleteAll();
        channels.deleteAll();

        assertThat(terminated)
                .withFailMessage("a worker thread outlived its test; it could still commit "
                        + "after this cleanup and corrupt the next test's fixture")
                .isTrue();
    }

    // --- the configuration the recovery silently depends on --------------------------

    /**
     * The writer owns its transaction boundary even when a caller already has one.
     *
     * <p>This pins {@code REQUIRES_NEW}, the structural half of the recovery contract and the
     * half nothing else would notice losing. Under the default {@code REQUIRED} the writer
     * joins the caller's transaction: its commit — and therefore the constraint violation —
     * moves out to the caller's boundary, past {@code resolveRace}'s catch, and a concurrent
     * replay silently answers 500. No other test would fail, because
     * {@code decideApproval} has no ambient transaction today.
     */
    @Test
    void theWriterCommitsInItsOwnTransactionEvenWhenTheCallerLaterRollsBack() {
        TransactionTemplate caller = new TransactionTemplate(txManager);
        try {
            caller.executeWithoutResult(status -> {
                service.decideApproval(org, account, ref, "APPROVED", 1, "cmd-1", user);
                throw new IllegalStateException("caller fails after the approval was recorded");
            });
        } catch (IllegalStateException expected) {
            // The caller's transaction rolled back.
        }

        assertThat(approvalRepo.findByOrgIdAndReviewId(org, review.getId()))
                .withFailMessage("the approval was rolled back with the caller — the writer joined "
                        + "the caller's transaction instead of owning one, which also makes "
                        + "resolveRace's catch dead code and reverts concurrent replays to 500")
                .isPresent();
        assertThat(approvalAudits.findByOrgIdAndCommandId(org, "cmd-1")).isPresent();
    }

    // --- deterministic: the unique-conflict recovery paths ---------------------------

    /**
     * An identical replay that loses the race recovers as a replay rather than a 500 — the
     * blocker this whole arrangement exists for.
     *
     * <p>Forced, not hoped for: the loser is stalled immediately after its fast-path lookup has
     * returned empty, the winner is driven to commit, and only then is the loser released. Its
     * write MUST hit {@code uq_review_reply_approval_audit_org_command}, so it MUST go through
     * {@code resolveRace}. Proven, not assumed: the fast path is recorded as having seen
     * nothing, and the only way to answer {@code replayed=true} after an empty fast-path read
     * is the recovery path.
     */
    @Test
    void aLosingIdenticalReplayRecoversThroughTheConflictPathAndReturns200() throws Exception {
        AuditGate gate = new AuditGate();
        ReviewReplyService gated = gate.serviceGatedOnFastPathLookup();

        Future<ReviewReplyApprovalResponse> loser = submit(() ->
                gated.decideApproval(org, account, ref, "APPROVED", 1, "cmd-1", user));
        try {
            gate.awaitStalled();
            // The winner commits while the loser is held past its fast path.
            service.decideApproval(org, account, ref, "APPROVED", 1, "cmd-1", user);
        } finally {
            gate.releaseAll();
        }

        ReviewReplyApprovalResponse r = loser.get(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);
        assertThat(gate.fastPathSawNothing()).isTrue();   // it could not have short-circuited
        assertThat(r.replayed()).isTrue();                // ...so this came from resolveRace
        assertThat(r.state()).isEqualTo("APPROVED");
        // Applied exactly once.
        assertThat(approvalAudits.findAll()).hasSize(1);
        assertThat(approvalRepo.findAll()).hasSize(1);
    }

    /**
     * A losing FIRST approval is retried as an update rather than dropped, and records the
     * winner as its predecessor.
     *
     * <p><b>Gated on the LOCKING read, not the fast-path lookup</b>, and that distinction is the
     * whole test: a loser stalled at the fast path would find the winner's row already present
     * by the time it reached the writer, take the ordinary UPDATE branch, and never conflict at
     * all — passing without exercising {@code resolveRace}. The loser has to be held AFTER it
     * has looked for the row and found none, i.e. committed to inserting.
     *
     * <p>The {@code stateFrom} assertion is what proves the retry re-read under the lock: had it
     * reused what it saw before the failed insert, it would record {@code null} and the history
     * would claim two first approvals.
     */
    @Test
    void aLosingFirstApprovalIsRetriedAsAnUpdateAndRecordsTheWinnerAsItsPredecessor()
            throws Exception {
        LockGate gate = new LockGate();
        ReviewReplyService gated = gate.serviceGatedOnLockingRead();

        // A is held inside the writer with no row found — committed to an INSERT.
        Future<ReviewReplyApprovalResponse> a = submit(() ->
                gated.decideApproval(org, account, ref, "APPROVED", 1, "cmd-a", user));
        try {
            gate.awaitHoldingLock();
            assertThat(gate.firstReadFoundNoRow()).isTrue();
            // B commits a DIFFERENT command underneath A.
            service.decideApproval(org, account, ref, "APPROVED", 1, "cmd-b", user);
        } finally {
            gate.releaseAll();
        }

        ReviewReplyApprovalResponse r = a.get(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);
        assertThat(r.replayed()).isFalse();
        assertThat(r.state()).isEqualTo("APPROVED");

        // Both commands landed, exactly once each, and the trail composes: null -> APPROVED
        // (the winner) -> APPROVED (the retried loser, naming the winner as its predecessor).
        assertThat(approvalRepo.findAll()).hasSize(1);
        List<ReviewReplyApprovalAudit> trail = approvalAudits.findAll().stream()
                .sorted((x, y) -> x.getCreatedAt().compareTo(y.getCreatedAt())).toList();
        assertThat(trail).hasSize(2);
        assertThat(trail).extracting(ReviewReplyApprovalAudit::getCommandId)
                .containsExactlyInAnyOrder("cmd-a", "cmd-b");
        ReviewReplyApprovalAudit retried = trail.stream()
                .filter(t -> t.getCommandId().equals("cmd-a")).findFirst().orElseThrow();
        assertThat(retried.getStateFrom())
                .withFailMessage("the retried loser recorded a predecessor it never really had — "
                        + "it did not re-read under the lock")
                .isEqualTo(ReviewReplyApprovalState.APPROVED);
    }

    /**
     * The lock is what keeps {@code state_from} truthful when two callers transition the SAME
     * existing row. Without it both read APPROVED and both append "from APPROVED" — two rows,
     * one predecessor, an impossible history that no constraint can catch because the command
     * ids differ.
     */
    @Test
    void concurrentTransitionsOnAnExistingRowRecordAContiguousHistory() throws Exception {
        // Establish the row so the lock (not the review_id constraint) is what serializes.
        service.decideApproval(org, account, ref, "APPROVED", 1, "cmd-seed", user);

        CountDownLatch start = new CountDownLatch(1);
        Future<?> w1 = submit(() -> {
            start.await();
            return service.decideApproval(org, account, ref, "WITHDRAWN", null, "cmd-w1", user);
        });
        Future<?> w2 = submit(() -> {
            start.await();
            return service.decideApproval(org, account, ref, "WITHDRAWN", null, "cmd-w2", user);
        });
        start.countDown();
        w1.get(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);
        w2.get(GATE_TIMEOUT_SEC, TimeUnit.SECONDS);

        assertTruthfulChain();
    }

    /**
     * The whole trail must form ONE contiguous path from null (the first decision) to the row's
     * current state, consuming every row exactly once.
     *
     * <p>Structural rather than timestamp-ordered, deliberately: what has to hold is that the
     * history COMPOSES. Sorting by {@code created_at} would assert that two clock reads agree —
     * flakier, and weaker, since a trail can be perfectly ordered and still name a predecessor
     * that was never the row's value.
     */
    private void assertTruthfulChain() {
        ReviewReplyApproval current = approvalRepo.findByOrgIdAndReviewId(org, review.getId())
                .orElseThrow();
        List<ReviewReplyApprovalAudit> rows =
                new ArrayList<>(approvalAudits.findAllByReviewReplyApprovalIdOrderByCreatedAtAsc(
                        current.getId()));

        ReviewReplyApprovalState cursor = null;
        int consumed = 0;
        while (true) {
            final ReviewReplyApprovalState from = cursor;
            Optional<ReviewReplyApprovalAudit> next = rows.stream()
                    .filter(r -> r.getStateFrom() == from).findFirst();
            if (next.isEmpty()) {
                break;
            }
            rows.remove(next.get());
            cursor = next.get().getStateTo();
            consumed++;
        }
        assertThat(rows)
                .withFailMessage("the trail does not compose: %s row(s) name a predecessor that "
                        + "was never the row's value", rows.size())
                .isEmpty();
        assertThat(consumed).isGreaterThan(0);
        assertThat(cursor)
                .withFailMessage("the trail ends somewhere other than the row's current state")
                .isEqualTo(current.getState());
    }

    // --- the gated repository harness ------------------------------------------------

    /** Holds a caller immediately after its fast-path idempotency lookup. */
    private final class AuditGate implements Releasable {
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

        ReviewReplyService serviceGatedOnFastPathLookup() {
            ReviewReplyApprovalAuditRepository gated =
                    mock(ReviewReplyApprovalAuditRepository.class, delegatesTo(approvalAudits));
            doAnswer(inv -> {
                Optional<ReviewReplyApprovalAudit> real =
                        approvalAudits.findByOrgIdAndCommandId(inv.getArgument(0), inv.getArgument(1));
                if (firstCall.getAndSet(false)) {
                    sawNothing.set(real.isEmpty());
                    stalled.countDown();
                    if (!release.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("fast-path gate was never released");
                    }
                }
                return real;
            }).when(gated).findByOrgIdAndCommandId(any(), any());
            return serviceWith(approvalRepo, gated);
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
     * {@code from} already read — the exact window in which an unlocked read would go stale.
     */
    private final class LockGate implements Releasable {
        private final CountDownLatch holdingLock = new CountDownLatch(1);
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

        ReviewReplyService serviceGatedOnLockingRead() {
            ReviewReplyApprovalRepository gated =
                    mock(ReviewReplyApprovalRepository.class, delegatesTo(approvalRepo));
            doAnswer(inv -> {
                int n = calls.incrementAndGet();
                Optional<ReviewReplyApproval> real =
                        approvalRepo.lockByOrgIdAndReviewId(inv.getArgument(0), inv.getArgument(1));
                if (n == 1) {
                    firstReadEmpty.set(real.isEmpty());
                    holdingLock.countDown();
                    if (!release.await(GATE_TIMEOUT_SEC, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("lock-holder gate was never released");
                    }
                }
                return real;
            }).when(gated).lockByOrgIdAndReviewId(any(), any());
            return serviceWith(gated, approvalAudits);
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
    }

    /** A service wired exactly as Spring would, but over the given (possibly gated) repositories. */
    private ReviewReplyService serviceWith(ReviewReplyApprovalRepository approvals,
                                           ReviewReplyApprovalAuditRepository audits) {
        return new ReviewReplyService(reviews, sellerAccounts, triages,
                new ReviewReplyDraftService(draftRepo),
                new ReviewReplyApprovalService(approvals, audits,
                        new ReviewReplyApprovalWriter(approvals, audits, txManager)),
                new ReviewReplyOutcomeService(submissionRefRepo, outcomeRepo,
                        new ReviewReplyOutcomeWriter(outcomeRepo, txManager)),
                new RuleBasedReviewReplyProvider());
    }

    // --- helpers ---------------------------------------------------------------------

    private <T> Future<T> submit(Callable<T> task) {
        Future<T> f = pool.submit(task);
        submitted.add(f);
        return f;
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
