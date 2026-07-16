package com.sellerops.attention.triage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

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
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The decision itself: authorization, idempotency, and the evidence trail, driven through
 * the real {@link ReviewTriageService} against a real (H2) DB.
 *
 * <p>Not mocked, on purpose. What this slice adds is almost entirely about what the DATABASE
 * enforces and what a second call observes — a unique index, a replay reading back a prior
 * row, an append-only trail accumulating. Mocked repositories would assert that the service
 * calls the methods this service happens to call, which is a restatement of the
 * implementation rather than a test of the behaviour.
 *
 * <p><b>{@code NOT_SUPPORTED}: no ambient transaction, on purpose.</b> {@code @DataJpaTest}
 * normally wraps each test in one and rolls it back. That is incompatible with what is under
 * test here: {@link ReviewTriageWriter} runs {@code REQUIRES_NEW}, so it would suspend the
 * test's transaction and commit anyway — the rollback would clean up the fixture while
 * leaving the writer's rows behind, committed. Worse, the fixture would be invisible to the
 * writer's own transaction, so these tests would exercise an arrangement production never
 * has. Removing the ambient transaction makes the test agree with production; {@link #cleanUp}
 * then does what the rollback used to.
 *
 * <p><b>A dedicated database, because this class commits.</b> The shared {@code sellerops_test}
 * instance is JVM-wide ({@code DB_CLOSE_DELAY=-1}) and every other {@code @DataJpaTest} rolls
 * back into it; a committing class there would leak — and {@code channel.code} is globally
 * UNIQUE, so a single stranded row fails a dozen unrelated classes. This is the pattern
 * {@code InquiryWorkItemDismissalRollbackTest} and {@code EsmInquiryImportRollbackTest}
 * already use for exactly this reason. It makes {@link #cleanUp} a within-class concern
 * rather than a suite-wide one: if cleanup ever fails, the blast radius is this file.
 *
 * <p>{@code sellerops.seed.enabled=false} is inert for a {@code @DataJpaTest} (the slice
 * excludes {@code @Component}, so {@code MockDataSeeder} never loads) and is registered
 * anyway, so the three triage classes share one isolation recipe and converting any of them
 * to {@code @SpringBootTest} cannot silently reintroduce a seeded 13-channel catalog.
 *
 * <p>Hermetic: no network, no marketplace, no credentials, no clock dependence beyond the
 * decision's own {@code decided_at}. Every review body is synthetic.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ReviewTriageServiceTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_review_triage_service;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewTriageAuditRepository audits;
    @Autowired ReviewRepository reviews;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private ReviewTriageService service;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    /** A synthetic review body — never captured content. */
    private static final String BODY = "합성-리뷰-본문-불만";

    private UUID naverChannel;
    private UUID account;
    private Review review;
    private String ref;

    @BeforeEach
    void setUp() {
        // Hand-constructed, exactly as Spring would wire it. The writer takes an explicit
        // TransactionTemplate rather than relying on a @Transactional proxy, so its atomicity
        // holds here too — that is the point of the arrangement (see ReviewTriageWriter).
        service = new ReviewTriageService(triages, audits, reviews, sellerAccounts,
                new ReviewTriageWriter(triages, audits, txManager));
        naverChannel = seedChannel("NAVER", "네이버 스마트스토어");
        account = seedAccount(org, naverChannel);
        review = seedReview(org, naverChannel, 2);
        ref = VocItemRef.forReview(review.getId());
    }

    @AfterEach
    void cleanUp() {
        // Everything here commits (see the class note), so this replaces the rollback
        // @DataJpaTest would otherwise do. Still needed with a dedicated database: this
        // class asserts on unscoped findAll() and re-seeds a UNIQUE channel.code per test,
        // so residue would fail its own next test. What the dedicated database buys is that
        // it can fail no one else's.
        audits.deleteAll();
        triages.deleteAll();
        reviews.deleteAll();
        sellerAccounts.deleteAll();
        channels.deleteAll();
    }

    // --- recording a decision ---------------------------------------------------

    @Test
    void aFirstDecisionIsRecordedAsCurrentStateAndAsEvidence() {
        TriageDecisionResponse res = decide(ref, "RESPONSE_NEEDED", "cmd-1");

        assertThat(res.actionRef()).isEqualTo(ref);
        assertThat(res.disposition()).isEqualTo("RESPONSE_NEEDED");
        assertThat(res.replayed()).isFalse();

        ReviewTriage saved = triages.findByOrgIdAndReviewId(org, review.getId()).orElseThrow();
        assertThat(saved.getDisposition()).isEqualTo(TriageDisposition.RESPONSE_NEEDED);
        assertThat(saved.getReviewId()).isEqualTo(review.getId());
        // The review's channel, copied onto the decision — the finest scope this store has.
        assertThat(saved.getChannelId()).isEqualTo(naverChannel);
        assertThat(saved.getDecidedAt()).isNotNull();
        // Actor is a tag plus the user id — never an email or any other PII.
        assertThat(saved.getDecidedBy()).isEqualTo("SELLER:" + user);
        assertThat(saved.getDecidedBy()).doesNotContain("@");

        // phase_from's analogue: null on the first decision, because there was no prior.
        assertThat(audits.findAllByReviewTriageIdOrderByCreatedAtAsc(saved.getId()))
                .extracting(ReviewTriageAudit::getDispositionFrom, ReviewTriageAudit::getDispositionTo,
                        ReviewTriageAudit::getCommandId)
                .containsExactly(tuple(null, TriageDisposition.RESPONSE_NEEDED, "cmd-1"));
    }

    @Test
    void everyDispositionIsRecordable() {
        // The enum is the contract; a value that parses but cannot be stored would be a
        // contract that only half exists.
        for (TriageDisposition d : TriageDisposition.values()) {
            Review r = seedReview(org, naverChannel, 2);
            TriageDecisionResponse res = decide(VocItemRef.forReview(r.getId()), d.name(), "cmd-" + d);
            assertThat(res.disposition()).isEqualTo(d.name());
        }
        assertThat(triages.findAll()).hasSize(TriageDisposition.values().length);
    }

    @Test
    void changingAMindReplacesCurrentStateAndAppendsRatherThanRewrites() {
        decide(ref, "RESPONSE_NEEDED", "cmd-1");
        TriageDecisionResponse res = decide(ref, "NO_ACTION", "cmd-2");

        assertThat(res.disposition()).isEqualTo("NO_ACTION");
        assertThat(res.replayed()).isFalse();

        ReviewTriage saved = triages.findByOrgIdAndReviewId(org, review.getId()).orElseThrow();
        assertThat(saved.getDisposition()).isEqualTo(TriageDisposition.NO_ACTION);
        // Still ONE current-state row: review_id is unique, so a change updates in place.
        assertThat(triages.findAll()).hasSize(1);

        // ...and the history is intact. This is the property the trail exists for: "it was
        // RESPONSE_NEEDED before someone closed it out" must stay answerable, which an
        // in-place update alone would erase.
        assertThat(audits.findAllByReviewTriageIdOrderByCreatedAtAsc(saved.getId()))
                .extracting(ReviewTriageAudit::getDispositionFrom, ReviewTriageAudit::getDispositionTo)
                .containsExactly(
                        tuple(null, TriageDisposition.RESPONSE_NEEDED),
                        tuple(TriageDisposition.RESPONSE_NEEDED, TriageDisposition.NO_ACTION));
    }

    @Test
    void reaffirmingTheSameDispositionWithANewCommandIsRecordedRatherThanSwallowed() {
        decide(ref, "MONITOR", "cmd-1");
        TriageDecisionResponse res = decide(ref, "MONITOR", "cmd-2");

        assertThat(res.replayed()).isFalse(); // a new command is a new decision, not a replay
        ReviewTriage saved = triages.findByOrgIdAndReviewId(org, review.getId()).orElseThrow();
        // from == to: someone looked again and reached the same conclusion. That is a fact
        // about the operator's attention, and dropping it would silently lose it.
        assertThat(audits.findAllByReviewTriageIdOrderByCreatedAtAsc(saved.getId()))
                .extracting(ReviewTriageAudit::getDispositionFrom, ReviewTriageAudit::getDispositionTo)
                .containsExactly(
                        tuple(null, TriageDisposition.MONITOR),
                        tuple(TriageDisposition.MONITOR, TriageDisposition.MONITOR));
    }

    // --- idempotency ------------------------------------------------------------

    @Test
    void anExactReplayWritesNothingAndReportsItself() {
        decide(ref, "RESPONSE_NEEDED", "cmd-1");
        TriageDecisionResponse res = decide(ref, "RESPONSE_NEEDED", "cmd-1");

        assertThat(res.replayed()).isTrue();
        assertThat(res.disposition()).isEqualTo("RESPONSE_NEEDED");
        // The whole point: a retried request adds no second effect and no second row.
        assertThat(audits.findAll()).hasSize(1);
        assertThat(triages.findAll()).hasSize(1);
    }

    @Test
    void aReplayOfASupersededCommandReportsWhereThingsActuallyStand() {
        decide(ref, "RESPONSE_NEEDED", "cmd-1");
        decide(ref, "NO_ACTION", "cmd-2");

        // cmd-1 retried late (a client's network retry landing after the operator already
        // changed their mind). It was applied, so it is a replay — but reporting
        // RESPONSE_NEEDED back would describe a state that no longer exists and invite the
        // client to render a stale decision as live.
        TriageDecisionResponse res = decide(ref, "RESPONSE_NEEDED", "cmd-1");

        assertThat(res.replayed()).isTrue();
        assertThat(res.disposition()).isEqualTo("NO_ACTION");
        assertThat(audits.findAll()).hasSize(2); // nothing appended
    }

    @Test
    void reusingACommandIdForADifferentDispositionIsRejectedNotApplied() {
        decide(ref, "RESPONSE_NEEDED", "cmd-1");

        assertThatThrownBy(() -> decide(ref, "NO_ACTION", "cmd-1"))
                .isInstanceOf(ApiException.class)
                .extracting(t -> ((ApiException) t).getStatus()).isEqualTo(HttpStatus.CONFLICT);

        // Rejected means rejected: the earlier decision stands untouched.
        assertThat(triages.findByOrgIdAndReviewId(org, review.getId()).orElseThrow().getDisposition())
                .isEqualTo(TriageDisposition.RESPONSE_NEEDED);
        assertThat(audits.findAll()).hasSize(1);
    }

    @Test
    void reusingACommandIdOnADifferentReviewIsRejected() {
        // The failure the org-scoped key exists to catch, and the reason it is org-scoped
        // rather than (triage_id, command_id): under the narrower key BOTH writes would be
        // accepted — each unique within its own triage row — and one command would have
        // silently had two effects.
        Review other = seedReview(org, naverChannel, 1);
        decide(ref, "MONITOR", "cmd-1");

        assertThatThrownBy(() -> decide(VocItemRef.forReview(other.getId()), "MONITOR", "cmd-1"))
                .isInstanceOf(ApiException.class)
                .extracting(t -> ((ApiException) t).getStatus()).isEqualTo(HttpStatus.CONFLICT);

        assertThat(triages.findByOrgIdAndReviewId(org, other.getId())).isEmpty();
        assertThat(audits.findAll()).hasSize(1);
    }

    /**
     * The unique index, exercised directly rather than through the service.
     *
     * <p>Every idempotency test above passes because of the service's
     * {@code findByOrgIdAndCommandId} lookup, not because of the index — narrowing or
     * dropping the index leaves them all green. The index only fires when two callers race
     * past that lookup, which nothing in THIS class can produce: {@code @DataJpaTest} wraps
     * each test in one transaction and rolls it back, so two "concurrent" calls here would
     * share it and never contend. The race itself is covered by
     * {@code ReviewTriageConcurrencyTest}; what this pins is the storage rule that test
     * depends on.
     */
    @Test
    void theCommandKeyIsEnforcedByTheDatabaseAndNotOnlyByTheServicesLookup() {
        decide(ref, "MONITOR", "cmd-1");
        ReviewTriage saved = triages.findByOrgIdAndReviewId(org, review.getId()).orElseThrow();

        assertThatThrownBy(() -> audits.saveAndFlush(
                auditRow(org, saved.getId(), "cmd-1", TriageDisposition.NO_ACTION)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * And it is ORG-scoped, not per-triage-row — the V16 shape, not V9's.
     *
     * <p>Two different reviews, one org, one command id. Under
     * {@code (review_triage_id, command_id)} this insert would succeed, because each row is
     * unique within its own triage; the reuse would be invisible at the storage layer and
     * the service's lookup would be the only thing standing between a client bug and one
     * command having two effects.
     */
    @Test
    void theDatabaseKeyIsOrgScopedRatherThanPerTriageRow() {
        Review other = seedReview(org, naverChannel, 1);
        decide(ref, "MONITOR", "cmd-1");
        decide(VocItemRef.forReview(other.getId()), "MONITOR", "cmd-2");

        UUID otherTriage = triages.findByOrgIdAndReviewId(org, other.getId()).orElseThrow().getId();

        assertThatThrownBy(() -> audits.saveAndFlush(
                auditRow(org, otherTriage, "cmd-1", TriageDisposition.MONITOR)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void aCommandIdIsRequired() {
        assertThatThrownBy(() -> decide(ref, "MONITOR", null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> decide(ref, "MONITOR", "   ")).isInstanceOf(ApiException.class);
        assertThat(triages.findAll()).isEmpty();
    }

    @Test
    void anOverLongCommandIdIsA400RatherThanAStorageFailure() {
        // The column is varchar(120) in V18. Without the service's own guard this would be
        // a DataIntegrityViolation surfacing as a 500 — and only in production, since the
        // entity's pinned length is the only reason the test schema agrees with V18.
        String tooLong = "c".repeat(ReviewTriageService.MAX_COMMAND_ID_LEN + 1);

        assertThatThrownBy(() -> decide(ref, "MONITOR", tooLong)).isInstanceOf(ApiException.class);
        assertThat(triages.findAll()).isEmpty();

        // The boundary itself is valid — the guard rejects longer, not long.
        assertThat(decide(ref, "MONITOR", "c".repeat(ReviewTriageService.MAX_COMMAND_ID_LEN)).replayed())
                .isFalse();
    }

    @Test
    void theSameCommandIdInAnotherOrgIsUnrelated() {
        // Idempotency is scoped per org, not global: two tenants minting "cmd-1" are not
        // colliding, and one must never be able to block or observe the other's command.
        UUID otherOrg = UUID.randomUUID();
        UUID otherAccount = seedAccount(otherOrg, naverChannel);
        Review otherOrgReview = seedReview(otherOrg, naverChannel, 2);

        decide(ref, "MONITOR", "cmd-1");
        TriageDecisionResponse res = service.decide(otherOrg, otherAccount,
                VocItemRef.forReview(otherOrgReview.getId()), "MONITOR", "cmd-1", user);

        assertThat(res.replayed()).isFalse();
        assertThat(audits.findAll()).hasSize(2);
    }

    // --- authorization ----------------------------------------------------------

    @Test
    void aCrossOrgReviewIsNotAddressableAndLooksExactlyLikeAnAbsentOne() {
        UUID otherOrg = UUID.randomUUID();
        Review theirs = seedReview(otherOrg, naverChannel, 1);
        UUID nonexistent = UUID.randomUUID();

        // Same status AND same message, both ways: a caller must not be able to distinguish
        // "someone else's review" from "no such review", because the difference is what
        // makes ids enumerable. The status is asserted, not just the exception type — the
        // property is that the two are INDISTINGUISHABLE, and a 403 on one of them would
        // disclose exactly what the shared message is there to withhold.
        Throwable crossOrg = catchDecide(VocItemRef.forReview(theirs.getId()));
        Throwable absent = catchDecide(VocItemRef.forReview(nonexistent));

        assertThat(status(crossOrg)).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(status(absent)).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(crossOrg).hasMessage(absent.getMessage());
        assertThat(triages.findAll()).isEmpty();
    }

    @Test
    void aReviewOnAnotherChannelIsNotAddressableFromThisAccount() {
        // Same org, same everything — except the review sits on a channel this account does
        // not read. In-org, so this is not a tenancy leak; it is scope.
        UUID cafe24 = seedChannel("CAFE24", "카페24");
        UUID cafe24Account = seedAccount(org, cafe24);
        Review naverReview = seedReview(org, naverChannel, 2);

        Throwable wrongChannel = catchDecide(cafe24Account, VocItemRef.forReview(naverReview.getId()));
        Throwable absent = catchDecide(cafe24Account, VocItemRef.forReview(UUID.randomUUID()));

        // The third member of the indistinguishable set: a real, in-org review the caller
        // simply cannot address from this account must look exactly like one that does not
        // exist.
        assertThat(status(wrongChannel)).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(wrongChannel).hasMessage(absent.getMessage());
        assertThat(triages.findAll()).isEmpty();
    }

    @Test
    void anAccountFromAnotherOrgIsNotUsableEvenWithAValidRef() {
        // The account is authorization, not routing decoration: naming someone else's
        // account must fail before the ref is even considered addressable.
        UUID otherOrg = UUID.randomUUID();
        UUID theirAccount = seedAccount(otherOrg, naverChannel);

        assertThat(status(catchDecide(theirAccount, ref))).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(triages.findAll()).isEmpty();
    }

    @Test
    void anUnknownAccountIsRejected() {
        assertThat(status(catchDecide(UUID.randomUUID(), ref))).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(triages.findAll()).isEmpty();
    }

    // --- input validation -------------------------------------------------------

    @Test
    void aMalformedOrUnsupportedRefIsRejectedBeforeAnyRowIsTouched() {
        assertThatThrownBy(() -> decide("not-a-ref", "MONITOR", "cmd-1"))
                .isInstanceOf(ApiException.class)
                .extracting(t -> ((ApiException) t).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThatThrownBy(() -> decide("review:nope", "MONITOR", "cmd-2")).isInstanceOf(ApiException.class);
        // Well-formed, unsupported source — the shape a Cafe24 article would carry.
        assertThatThrownBy(() -> decide("article:" + UUID.randomUUID(), "MONITOR", "cmd-3"))
                .isInstanceOf(ApiException.class);
        assertThat(triages.findAll()).isEmpty();
        assertThat(audits.findAll()).isEmpty();
    }

    @Test
    void anUnknownDispositionIsRejected() {
        assertThatThrownBy(() -> decide(ref, "DEFINITELY_NOT_A_DISPOSITION", "cmd-1"))
                .isInstanceOf(ApiException.class)
                .extracting(t -> ((ApiException) t).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        // Notably NOT an inquiry phase: this surface must not quietly accept the other
        // pipeline's vocabulary just because the strings look interchangeable.
        assertThatThrownBy(() -> decide(ref, "PROPOSED", "cmd-2")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> decide(ref, null, "cmd-3")).isInstanceOf(ApiException.class);
        assertThat(triages.findAll()).isEmpty();
    }

    @Test
    void aDispositionIsMatchedExactlyRatherThanLoosely() {
        assertThatThrownBy(() -> decide(ref, "response_needed", "cmd-1")).isInstanceOf(ApiException.class);
        // Whitespace is transport noise and tolerated; case is meaning and is not.
        assertThat(decide(ref, "  MONITOR  ", "cmd-2").disposition()).isEqualTo("MONITOR");
    }

    // --- helpers ----------------------------------------------------------------

    private TriageDecisionResponse decide(String actionRef, String disposition, String commandId) {
        return service.decide(org, account, actionRef, disposition, commandId, user);
    }

    private Throwable catchDecide(String actionRef) {
        return catchDecide(account, actionRef);
    }

    private Throwable catchDecide(UUID accountId, String actionRef) {
        try {
            service.decide(org, accountId, actionRef, "MONITOR", "cmd-" + UUID.randomUUID(), user);
            return null;
        } catch (Throwable t) {
            return t;
        }
    }

    /** The thrown status, asserting it was a deliberate ApiException and not a leak. */
    private static HttpStatus status(Throwable t) {
        assertThat(t).isInstanceOf(ApiException.class);
        return ((ApiException) t).getStatus();
    }

    /** A raw audit row, to drive the storage constraint without going through the service. */
    private ReviewTriageAudit auditRow(UUID orgId, UUID triageId, String commandId, TriageDisposition to) {
        ReviewTriageAudit a = new ReviewTriageAudit();
        a.setOrgId(orgId);
        a.setReviewTriageId(triageId);
        a.setCommandId(commandId);
        a.setDispositionTo(to);
        a.setActor("SELLER:" + user);
        return a;
    }

    private UUID seedChannel(String code, String nameKo) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(nameKo);
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsReview(true);
        ch.setSortOrder(0);
        return channels.save(ch).getId();
    }

    private UUID seedAccount(UUID orgId, UUID channelId) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(orgId);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(true);
        return sellerAccounts.save(acc).getId();
    }

    /** A synthetic ingested review; {@code receivedAt} is an explicit instant, never a clock read. */
    private Review seedReview(UUID orgId, UUID channelId, Integer rating) {
        Review r = new Review();
        r.setOrgId(orgId);
        r.setChannelId(channelId);
        r.setRating(rating);
        r.setBody(BODY);
        r.setNegative(rating != null && rating <= 2);
        r.setReceivedAt(Instant.parse("2026-05-10T03:00:00Z"));
        return reviews.save(r);
    }
}
