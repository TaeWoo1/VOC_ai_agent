package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.reply.dto.ReviewReplyPrepView;
import com.sellerops.attention.triage.ReviewTriageAuditRepository;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.ReviewTriageService;
import com.sellerops.attention.triage.ReviewTriageWriter;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.review.Review;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
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
 * Review response preparation end to end: the gate, the freeze, the copy contract, and what
 * an operator may do at each point — driven through the real services against a real (H2) DB.
 *
 * <p>Not mocked, on purpose, for the reason {@code ReviewTriageServiceTest} records: almost
 * everything this slice adds is about what the DATABASE enforces and what a second call
 * observes. Mocked repositories would restate the implementation.
 *
 * <p>The isolation recipe ({@code NOT_SUPPORTED} + a dedicated H2 URL + {@link #cleanUp}) is
 * the triage tests' and is required for the same reason: {@link ReviewReplyApprovalWriter} runs
 * {@code REQUIRES_NEW} and commits regardless of any ambient transaction, so a rollback-based
 * test would clean up the fixture while leaving the writer's rows behind, and the fixture
 * would be invisible to the writer's own transaction.
 *
 * <p>Hermetic: no network, no marketplace, no credentials. Every review body is synthetic.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ReviewReplyServiceTest {

    @DynamicPropertySource
    static void isolatedDatabase(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:h2:mem:sellerops_review_reply_service;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;"
                        + "DB_CLOSE_DELAY=-1");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired ReviewReplyDraftRepository draftRepo;
    @Autowired ReviewReplyApprovalRepository approvalRepo;
    @Autowired ReviewReplyApprovalAuditRepository approvalAudits;
    @Autowired ReviewReplySubmissionRefRepository submissionRefRepo;
    @Autowired ReviewReplyOutcomeRepository outcomeRepo;
    @Autowired ReviewTriageRepository triages;
    @Autowired ReviewTriageAuditRepository triageAudits;
    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private ReviewReplyService service;
    private ReviewTriageService triageService;

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    /** Pins the KST as-of date the recency bucket is computed against: 2026-05-12 KST. */
    private static final Clock FIXED_CLOCK = Clock.fixed(Instant.parse("2026-05-12T00:00:00Z"), ZoneOffset.UTC);

    /** A synthetic review body — never captured content. */
    private static final String BODY = "합성-리뷰-본문: 배송이 너무 늦었습니다";

    private UUID naverChannel;
    private UUID account;
    private Review review;
    private String ref;

    @BeforeEach
    void setUp() {
        // Hand-constructed, exactly as Spring would wire it — the writers take explicit
        // TransactionTemplates rather than relying on a @Transactional proxy, so their
        // atomicity holds here too.
        service = new ReviewReplyService(reviews, products, sellerAccounts, triages,
                new ReviewReplyDraftService(draftRepo),
                new ReviewReplyApprovalService(approvalRepo, approvalAudits,
                        new ReviewReplyApprovalWriter(approvalRepo, approvalAudits, txManager)),
                new ReviewReplyOutcomeService(submissionRefRepo, outcomeRepo,
                        new ReviewReplyOutcomeWriter(outcomeRepo, txManager)),
                new RuleBasedReviewReplyProvider(), FIXED_CLOCK);
        triageService = new ReviewTriageService(triages, triageAudits, reviews, sellerAccounts,
                new ReviewTriageWriter(triages, triageAudits, txManager));
        naverChannel = seedChannel("NAVER", "네이버 스마트스토어");
        account = seedAccount(org, naverChannel);
        review = seedReview(org, naverChannel, 2);
        ref = VocItemRef.forReview(review.getId());
    }

    @AfterEach
    void cleanUp() {
        // Everything here commits (see the class note), so this replaces the rollback.
        outcomeRepo.deleteAll();
        submissionRefRepo.deleteAll();
        approvalAudits.deleteAll();
        approvalRepo.deleteAll();
        draftRepo.deleteAll();
        triageAudits.deleteAll();
        triages.deleteAll();
        reviews.deleteAll();
        sellerAccounts.deleteAll();
        channels.deleteAll();
    }

    // --- fixtures -------------------------------------------------------------------

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

    private void triage(TriageDisposition d) {
        triageService.decide(org, account, ref, d.name(), UUID.randomUUID().toString(), user);
    }

    private ReviewReplyPrepView view() {
        return service.view(org, account, ref);
    }

    private void approveHead() {
        int version = service.view(org, account, ref).draft().version();
        service.decideApproval(org, account, ref, "APPROVED", version,
                UUID.randomUUID().toString(), user);
    }

    /** Triage → save → approve, then mint a submission ref for the approved head. */
    private String approveAndStart() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        return service.startSubmissionRun(org, account, ref, user).submissionRef();
    }

    private com.sellerops.attention.reply.dto.ReviewReplyOutcomeResponse record(
            String submissionRef, OperatorOutcome outcome, String commandId) {
        return service.recordSubmissionReported(org, account, ref, submissionRef, outcome.name(),
                "awrun-synthetic-01", commandId, user);
    }

    @Test
    void aManualPostRecordsWithNoRunRefRatherThanAFabricatedOne() {
        // Production has no wired guided runtime, so this is the shipped path. Before V24 the column
        // was NOT NULL and the client had to supply something — every build sent a locally-minted
        // `run_<hex>` for a run that never happened, indistinguishable in the table from a real one.
        String submissionRef = approveAndStart();

        service.recordSubmissionReported(org, account, ref, submissionRef,
                OperatorOutcome.OPERATOR_REPORTED_SUBMITTED.name(), null,
                UUID.randomUUID().toString(), user);

        var outcome = service.view(org, account, ref).outcome();
        assertThat(outcome.operatorOutcome()).isEqualTo("OPERATOR_REPORTED_SUBMITTED");
        assertThat(outcome.awRunRef()).isNull();
        // Still UNVERIFIED, and still a real recorded outcome: the absent run ref narrows what is
        // claimed, it does not weaken the record.
        assertThat(outcome.verification()).isEqualTo("UNVERIFIED");
    }

    @Test
    void aBlankRunRefIsNormalisedToAbsentRatherThanStored() {
        // A caller with no run says so by OMISSION. Storing "" would create a third state that is
        // neither a run nor an honest absence, and no placeholder it could send would be true.
        String submissionRef = approveAndStart();

        service.recordSubmissionReported(org, account, ref, submissionRef,
                OperatorOutcome.OPERATOR_REPORTED_SUBMITTED.name(), "   ",
                UUID.randomUUID().toString(), user);

        assertThat(service.view(org, account, ref).outcome().awRunRef()).isNull();
    }

    // --- guided submission: the channel already answered ------------------------------

    @Test
    void aChannelAnsweredReviewCannotStartAGuidedRun() {
        // THE DUPLICATE-REPLY GATE. The guided run is the step immediately before a public post, and
        // the post cannot be taken back. Enforced server-side, not merely hidden: a client that
        // ignores `canStartSubmissionRun` still cannot start one.
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        markChannelAnswered();

        assertThatThrownBy(() -> service.startSubmissionRun(org, account, ref, user))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void aChannelAnsweredReviewWithholdsTheGuidedCapabilityButKeepsTheRest() {
        // Copy, approval and withdrawal stay open: the harm being prevented is specifically the
        // guided double-post, not the operator's own record or their clipboard.
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        markChannelAnswered();

        var caps = view().capabilities();
        assertThat(caps.canStartSubmissionRun()).isFalse();
        assertThat(caps.canCopy()).isTrue();
        assertThat(caps.canWithdraw()).isTrue();
        // …and the surface is told WHY, rather than being left with a control that vanished.
        assertThat(view().channelReplyState()).isEqualTo("ANSWERED");
    }

    @Test
    void anUnknownChannelStateNeverBlocksTheGuidedRun() {
        // Absence of a statement is not evidence of an answer. Blocking on UNKNOWN would strand
        // every review imported before reply-state preservation existed.
        approveAndStart();

        assertThat(view().channelReplyState()).isEqualTo("UNKNOWN");
        assertThat(view().capabilities().canStartSubmissionRun()).isTrue();
    }

    /** The channel now reports a reply on this review — the state an import would have written. */
    private void markChannelAnswered() {
        Review r = reviews.findById(review.getId()).orElseThrow();
        r.setReplyState(com.sellerops.review.ReviewReplyState.ANSWERED);
        reviews.save(r);
    }

    // --- guided submission: mint (start run) ----------------------------------------

    @Test
    void startingASubmissionRunNeedsAnApproval() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        assertThatThrownBy(() -> service.startSubmissionRun(org, account, ref, user))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void startingASubmissionRunRequiresResponseNeeded() {
        approveAndStart();               // now approved under RESPONSE_NEEDED
        triage(TriageDisposition.MONITOR);
        assertThatThrownBy(() -> service.startSubmissionRun(org, account, ref, user))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void startingASubmissionRunMintsAnOpaqueRefBoundToTheApprovedHead() {
        String submissionRef = approveAndStart();
        assertThat(submissionRef).matches("[0-9a-f]{16}");
    }

    @Test
    void guidedStartDerivesTheReviewTargetHintAndAnExplicitAsOfDate() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        var response = service.startSubmissionRun(org, account, ref, user, true);

        assertThat(response.submissionRef()).matches("[0-9a-f]{16}");
        assertThat(response.asOfDate()).isEqualTo("2026-05-12"); // FIXED_CLOCK, KST date-only
        assertThat(response.targetHint()).isNotNull();
        assertThat(response.targetHint().rating()).isEqualTo(2);
        // review receivedAt 2026-05-10 (KST) vs as-of 2026-05-12 → 2 days → THIS_WEEK.
        assertThat(response.targetHint().recencyBucket()).isEqualTo("THIS_WEEK");
        assertThat(response.targetHint().bodyFingerprint())
                .isEqualTo(ReviewBodyFingerprint.of(BODY))
                .matches("[0-9a-f]{64}");
    }

    @Test
    void guidedStartValidatesTheHintBeforeMintingSoNoUnusableRefIsEverCreated() {
        // A rating-less review cannot produce a valid hint. Approve it, then request a GUIDED run.
        Review noRating = seedReview(org, naverChannel, null);
        String ref0 = VocItemRef.forReview(noRating.getId());
        triageService.decide(org, account, ref0, TriageDisposition.RESPONSE_NEEDED.name(),
                UUID.randomUUID().toString(), user);
        service.saveDraft(org, account, ref0, "합성-답변 초안", 0, user);
        int version = service.view(org, account, ref0).draft().version();
        service.decideApproval(org, account, ref0, "APPROVED", version, UUID.randomUUID().toString(), user);

        assertThatThrownBy(() -> service.startSubmissionRun(org, account, ref0, user, true))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        // The 409 fired BEFORE the mint — no submission-ref row was ever created.
        assertThat(submissionRefRepo.count()).isZero();
    }

    @Test
    void guidedStartResponseCarriesTheFingerprintButNeverTheRawBody() throws Exception {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        var response = service.startSubmissionRun(org, account, ref, user, true);
        String json = new ObjectMapper().writeValueAsString(response);

        assertThat(json).contains(ReviewBodyFingerprint.of(BODY)).doesNotContain(BODY);
    }

    // --- guided submission: record (operator-reported, UNVERIFIED) -------------------

    @Test
    void recordingSeparatesTheReportedOutcomeFromVerificationAndNeverClaimsCompleted() {
        String submissionRef = approveAndStart();
        var response = record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString());
        assertThat(response.recorded()).isTrue();
        assertThat(response.replayed()).isFalse();

        var outcome = view().outcome();
        assertThat(outcome).isNotNull();
        assertThat(outcome.operatorOutcome()).isEqualTo("OPERATOR_REPORTED_SUBMITTED");
        assertThat(outcome.verification()).isEqualTo("UNVERIFIED");
        // The two are separate facts; there is no COMPLETED anywhere in the vocabulary.
        assertThat(outcome.verification()).isNotEqualTo("COMPLETED");
    }

    @Test
    void anAbortIsARecordedOutcomeNotAFault() {
        String submissionRef = approveAndStart();
        record(submissionRef, OperatorOutcome.SUBMISSION_ABORTED, UUID.randomUUID().toString());
        assertThat(view().outcome().operatorOutcome()).isEqualTo("SUBMISSION_ABORTED");
        assertThat(view().outcome().verification()).isEqualTo("UNVERIFIED");
    }

    @Test
    void aSubmissionRefIsSingleUse() {
        String submissionRef = approveAndStart();
        record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, UUID.randomUUID().toString());
        // A different command reusing the spent binding is refused — the anti-double-post guard.
        assertThatThrownBy(() -> record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString()))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void aRetryAfterAReportedSubmissionNeedsAFreshRef() {
        String first = approveAndStart();
        record(first, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, UUID.randomUUID().toString());
        // A fresh mint (same approved head) gives a new ref that can be recorded.
        String second = service.startSubmissionRun(org, account, ref, user).submissionRef();
        assertThat(second).isNotEqualTo(first);
        var response = record(second, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString());
        assertThat(response.recorded()).isTrue();
    }

    @Test
    void recordingIsIdempotentOnTheCommandId() {
        String submissionRef = approveAndStart();
        String command = UUID.randomUUID().toString();
        assertThat(record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, command).replayed())
                .isFalse();
        var replay = record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, command);
        assertThat(replay.recorded()).isTrue();
        assertThat(replay.replayed()).isTrue();
    }

    @Test
    void reusingACommandIdForADifferentOutcomeIsAConflict() {
        String first = approveAndStart();
        String command = UUID.randomUUID().toString();
        record(first, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, command);
        String second = service.startSubmissionRun(org, account, ref, user).submissionRef();
        assertThatThrownBy(() -> record(second, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, command))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void recordingIsRefusedOutsideResponseNeededWhileTheOutcomeStaysReadable() {
        String submissionRef = approveAndStart();
        triage(TriageDisposition.MONITOR);
        assertThatThrownBy(() -> record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString()))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void aBindingStaleAfterWithdrawalIsRefused() {
        String submissionRef = approveAndStart();
        service.decideApproval(org, account, ref, "WITHDRAWN", null, UUID.randomUUID().toString(), user);
        assertThatThrownBy(() -> record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString()))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void anUnknownSubmissionRefIsRefusedAndAMalformedOneIsRejected() {
        approveAndStart();
        // well-formed but never minted → no binding → 409
        assertThatThrownBy(() -> record("0123456789abcdef", OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString()))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT);
        // malformed (not 16-hex) → 400
        assertThatThrownBy(() -> record("not-a-ref", OperatorOutcome.OPERATOR_REPORTED_SUBMITTED,
                UUID.randomUUID().toString()))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void theOutcomeIsAppendOnlyHistoryAndTheApprovalStaysRevocable() {
        String submissionRef = approveAndStart();
        record(submissionRef, OperatorOutcome.OPERATOR_REPORTED_SUBMITTED, UUID.randomUUID().toString());
        // Withdrawal still works — the outcome did not consume the approval.
        service.decideApproval(org, account, ref, "WITHDRAWN", null, UUID.randomUUID().toString(), user);
        // The recorded outcome persists as history: re-approving the same version surfaces it again.
        approveHead();
        assertThat(view().outcome()).isNotNull();
        assertThat(view().outcome().operatorOutcome()).isEqualTo("OPERATOR_REPORTED_SUBMITTED");
    }

    @Test
    void canStartSubmissionRunFollowsTheCopyGate() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        assertThat(view().capabilities().canStartSubmissionRun()).isFalse(); // not yet approved
        approveHead();
        assertThat(view().capabilities().canStartSubmissionRun()).isTrue();
        assertThat(view().capabilities().canStartSubmissionRun())
                .isEqualTo(view().capabilities().canCopy());
    }

    // --- the gate -------------------------------------------------------------------

    @Test
    void anUntriagedReviewIsReadableButOffersNothing() {
        ReviewReplyPrepView v = view();
        assertThat(v.triageDisposition()).isNull();
        assertThat(v.capabilities().canSave()).isFalse();
        assertThat(v.capabilities().canApprove()).isFalse();
        assertThat(v.capabilities().canWithdraw()).isFalse();
        assertThat(v.capabilities().canCopy()).isFalse();
        // Readable: the operator can see the review and the suggestion regardless.
        assertThat(v.redactedBody()).contains("배송이 너무 늦었습니다");
        assertThat(v.suggestion().providerKind()).isEqualTo("RULE_BASED");
    }

    @Test
    void savingRequiresResponseNeeded() {
        triage(TriageDisposition.MONITOR);
        assertThatThrownBy(() -> service.saveDraft(org, account, ref, "합성-답변", 0, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void responseNeededUnlocksSaving() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        ReviewReplyPrepView v = view();
        assertThat(v.capabilities().canSave()).isTrue();
        // Nothing to approve until something is saved.
        assertThat(v.capabilities().canApprove()).isFalse();
        assertThat(v.draft()).isNull();

        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        assertThat(view().capabilities().canApprove()).isTrue();
    }

    /**
     * The invariant that makes triage a record rather than a filter: an operator who changes
     * their mind never loses the work they already did.
     */
    @Test
    void aDraftSurvivesADispositionChangeAndStaysReadable() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);

        triage(TriageDisposition.MONITOR);

        ReviewReplyPrepView v = view();
        assertThat(v.draft()).isNotNull();
        assertThat(v.draft().body()).isEqualTo("합성-답변 초안");
        assertThat(v.capabilities().canSave()).isFalse();
        assertThat(v.capabilities().canApprove()).isFalse();
    }

    // --- the asymmetry: the exit is never blocked ------------------------------------

    /**
     * The sequence that would strand a review if the gate were symmetric: approved, then
     * re-triaged. The approval freezes editing; if the gate also blocked withdrawal there
     * would be no way out of APPROVED at all.
     */
    @Test
    void withdrawalIsAllowedOutsideResponseNeededSoAnApprovalIsNeverStranded() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        triage(TriageDisposition.MONITOR);

        ReviewReplyPrepView frozen = view();
        assertThat(frozen.capabilities().canWithdraw()).isTrue();
        assertThat(frozen.capabilities().canSave()).isFalse();
        assertThat(frozen.capabilities().canCopy()).isFalse();

        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);
        assertThat(view().approval().state()).isEqualTo("WITHDRAWN");

        // And once the operator restores the disposition, editing re-opens.
        triage(TriageDisposition.RESPONSE_NEEDED);
        assertThat(view().capabilities().canSave()).isTrue();
        service.saveDraft(org, account, ref, "합성-답변 수정본", 1, user);
        assertThat(view().draft().body()).isEqualTo("합성-답변 수정본");
    }

    @Test
    void approvingRequiresResponseNeeded() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        triage(TriageDisposition.NO_ACTION);

        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 1,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void withdrawingWithNothingApprovedIsAConflict() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    // --- every capability means what the write path does ------------------------------

    /**
     * The capability object promises that "the server still enforces every rule independently".
     * These pair each flag with the write it denies, in the states where the flag is false.
     *
     * <p>Worth having as its own group rather than trusting the flags: the flags and the guards
     * are separate code, and a test that only reads a flag proves the flag's arithmetic, not
     * that anything honours it. Both `canApprove` and `canWithdraw` were once false while the
     * write succeeded, and every flag assertion in this file still passed.
     */
    @Test
    void canApproveFalseBecauseAlreadyApprovedMeansApprovingIsRefused() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        assertThat(view().capabilities().canApprove()).isFalse();
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 1,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
        // And nothing was appended for the refused attempt.
        assertThat(approvalAudits.findAll()).hasSize(1);
    }

    /**
     * Withdrawing an already-withdrawn reply changes nothing and says so, rather than failing.
     *
     * <p>This asserted a 409 until 2026-08-16, and that is what made the endpoint answer
     * differently depending on thread scheduling: the gate deciding it is a check-then-act, so of
     * two identical concurrent withdrawals the loser got 200 when it read before the winner
     * committed and 409 when it read after. A caller cannot see which side of a commit its read
     * landed on, so the answer must not depend on it — the exit is idempotent.
     *
     * <p>{@code canWithdraw} stays FALSE, and that is not a contradiction of the "every capability
     * means what the write path does" rule below: the flag says there is nothing to withdraw, and
     * the write path agrees by withdrawing nothing. What changed is the answer given to a caller
     * who asks anyway — 200 with an empty trail rather than an error — not what the server does.
     */
    @Test
    void withdrawingWhatIsAlreadyWithdrawnChangesNothingAndSaysSo() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);

        assertThat(view().capabilities().canWithdraw()).isFalse();
        var again = service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);
        assertThat(again.state()).isEqualTo("WITHDRAWN");
        assertThat(again.replayed()).isTrue();
        // No WITHDRAWN -> WITHDRAWN edge: the trail records transitions, not re-assertions, and
        // the standing decision is not reattributed to whoever asked last.
        assertThat(approvalAudits.findAll()).hasSize(2);
    }

    @Test
    void canWithdrawFalseBecauseNothingWasEverApprovedMeansWithdrawingIsRefused() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);

        assertThat(view().capabilities().canWithdraw()).isFalse();
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void canApproveFalseBecauseThereIsNoDraftMeansApprovingIsRefused() {
        triage(TriageDisposition.RESPONSE_NEEDED);

        assertThat(view().capabilities().canApprove()).isFalse();
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 1,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    // --- the freeze -----------------------------------------------------------------

    @Test
    void anApprovedDraftIsFrozenUntilWithdrawn() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        assertThat(view().capabilities().canSave()).isFalse();
        assertThatThrownBy(() -> service.saveDraft(org, account, ref, "합성-답변 수정본", 1, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));

        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);
        service.saveDraft(org, account, ref, "합성-답변 수정본", 1, user);
        assertThat(view().draft().version()).isEqualTo(2);
    }

    @Test
    void withdrawingDoesNotDeleteDrafts() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);

        assertThat(draftRepo.countByReviewId(review.getId())).isEqualTo(1);
        assertThat(view().draft().body()).isEqualTo("합성-답변 초안");
    }

    // --- the copy contract ----------------------------------------------------------

    @Test
    void thereIsNothingToCopyUntilSomethingIsApproved() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);

        ReviewReplyPrepView v = view();
        assertThat(v.capabilities().canCopy()).isFalse();
        assertThat(v.approval()).isNull();
    }

    @Test
    void copyServesTheApprovedVersionBoundToItsFingerprint() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        ReviewReplyPrepView v = view();
        assertThat(v.capabilities().canCopy()).isTrue();
        assertThat(v.approval().state()).isEqualTo("APPROVED");
        assertThat(v.approval().approvedVersion()).isEqualTo(1);
        assertThat(v.approval().approvedBody()).isEqualTo("합성-답변 초안");
        assertThat(v.approval().approvedFingerprint())
                .isEqualTo(v.draft().contentFingerprint());
    }

    /**
     * Copyable text is withheld the moment copying is not allowed, so a client cannot hold a
     * body it is not permitted to paste. The draft stays readable — this is a contract measure,
     * not a secrecy one.
     */
    @Test
    void theCopyableBodyIsWithheldWhenCopyingIsNotAllowed() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        triage(TriageDisposition.MONITOR);

        ReviewReplyPrepView v = view();
        assertThat(v.capabilities().canCopy()).isFalse();
        assertThat(v.approval().state()).isEqualTo("APPROVED");
        assertThat(v.approval().approvedBody()).isNull();
        // Still readable, so the operator can see what they approved before withdrawing it.
        assertThat(v.draft().body()).isEqualTo("합성-답변 초안");
    }

    @Test
    void aWithdrawnApprovalCarriesNoBinding() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);

        ReviewReplyPrepView v = view();
        assertThat(v.approval().state()).isEqualTo("WITHDRAWN");
        assertThat(v.approval().approvedVersion()).isNull();
        assertThat(v.approval().approvedFingerprint()).isNull();
        assertThat(v.approval().approvedBody()).isNull();
        assertThat(v.capabilities().canCopy()).isFalse();
    }

    // --- approving the version you saw ----------------------------------------------

    @Test
    void approvingAStaleVersionIsRefused() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 v1", 0, user);
        service.saveDraft(org, account, ref, "합성-답변 v2", 1, user);

        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 1,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    /**
     * A draft version above {@code Integer.valueOf}'s cache is still approvable.
     *
     * <p>Every other test here passes an {@code int} literal small enough to land in that cache
     * (−128..127), where two independently-boxed {@code Integer}s happen to be the same object —
     * so a {@code baseVersion != head} written as a REFERENCE comparison passes all of them and
     * then refuses every approval from version 128 on, telling the operator to refresh when
     * refreshing cannot possibly help. 128 is the exact boundary, so that is the version pinned.
     *
     * <p>The draft is inserted directly rather than saved 128 times: what is under test is the
     * comparison at the boundary, not the versioning loop that reaches it.
     */
    @Test
    void aDraftVersionAboveTheIntegerCacheIsStillApprovable() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        ReviewReplyDraft high = new ReviewReplyDraft();
        high.setOrgId(org);
        high.setReviewId(review.getId());
        high.setVersion(128);
        high.setBody("합성-답변 128번째");
        high.setContentFingerprint(ReviewReplyFingerprint.of("합성-답변 128번째"));
        high.setFingerprintAlgorithm(ReviewReplyValidation.FINGERPRINT_ALGORITHM);
        high.setCreatedBy("SELLER:" + user);
        draftRepo.save(high);

        assertThat(view().draft().version()).isEqualTo(128);
        assertThat(view().capabilities().canApprove()).isTrue();

        service.decideApproval(org, account, ref, "APPROVED", 128,
                UUID.randomUUID().toString(), user);

        ReviewReplyPrepView v = view();
        assertThat(v.approval().state()).isEqualTo("APPROVED");
        assertThat(v.approval().approvedVersion()).isEqualTo(128);
        assertThat(v.approval().approvedBody()).isEqualTo("합성-답변 128번째");
        assertThat(v.capabilities().canCopy()).isTrue();
    }

    @Test
    void approvingWithNoDraftIsAConflict() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 1,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    // --- idempotency ----------------------------------------------------------------

    @Test
    void anExactApprovalReplayWritesNothing() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        String command = UUID.randomUUID().toString();

        var first = service.decideApproval(org, account, ref, "APPROVED", 1, command, user);
        var second = service.decideApproval(org, account, ref, "APPROVED", 1, command, user);

        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(second.state()).isEqualTo("APPROVED");
        assertThat(approvalAudits.findAll()).hasSize(1);
    }

    @Test
    void aCommandIdReusedForADifferentDecisionIsAConflict() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        String command = UUID.randomUUID().toString();
        service.decideApproval(org, account, ref, "APPROVED", 1, command, user);

        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "WITHDRAWN", null,
                command, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    /**
     * A command id reused for the same STATE but a different BINDING is still a different
     * decision, and must conflict rather than read as a replay.
     *
     * <p>The one above varies the state, so comparing state alone catches it. This one does not:
     * both are APPROVED, and only the version differs. Without the binding in the comparison the
     * approval of v2 silently never happens while the response reports success — the operator
     * believes they approved their corrected text, and what stands is either nothing or the old
     * text. approve → withdraw → fix a typo → approve is an ordinary operator flow, and the
     * request DTO tells clients to mint one id "per user intent", which someone can reasonably
     * read as "approving this review".
     */
    @Test
    void aCommandIdReusedForTheSameStateButADifferentVersionIsAConflict() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 v1", 0, user);
        String command = UUID.randomUUID().toString();
        service.decideApproval(org, account, ref, "APPROVED", 1, command, user);
        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);
        service.saveDraft(org, account, ref, "합성-답변 v2 정정본", 1, user);

        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 2,
                command, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));

        // The refused command changed nothing: the review is still withdrawn, not silently
        // "approved" at a version nobody bound.
        assertThat(view().approval().state()).isEqualTo("WITHDRAWN");
        assertThat(view().capabilities().canCopy()).isFalse();
    }

    /** A genuine replay of a withdrawal (null binding on both sides) still replays. */
    @Test
    void anExactWithdrawalReplayWritesNothing() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        String command = UUID.randomUUID().toString();

        var first = service.decideApproval(org, account, ref, "WITHDRAWN", null, command, user);
        var second = service.decideApproval(org, account, ref, "WITHDRAWN", null, command, user);

        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(second.state()).isEqualTo("WITHDRAWN");
        assertThat(approvalAudits.findAll()).hasSize(2);
    }

    @Test
    void anExactDraftRetryInsertsNoDuplicateVersion() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);

        assertThat(draftRepo.countByReviewId(review.getId())).isEqualTo(1);
    }

    @Test
    void aStaleDraftBaseIsRefused() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 v1", 0, user);

        assertThatThrownBy(() -> service.saveDraft(org, account, ref, "합성-답변 v2", 0, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.CONFLICT));
    }

    // --- the schema enforces what the writer delegates to it -------------------------

    /**
     * The binding invariant is real under test, not only in production.
     *
     * <p>{@code ReviewReplyApprovalWriter} states that the database enforces "APPROVED iff a
     * binding" and that the caller is responsible for not asking for the impossible — while
     * taking state, version and fingerprint as three independent parameters. That delegation is
     * only true if V19's check is mirrored on the entity, because tests build the schema from
     * the annotations and never run the migration. Without the mirror this write would be
     * accepted here and rejected in production — and worse, rejected as a
     * {@code DataIntegrityViolationException} that the service reads as a lost race.
     *
     * <p>Driven through the writer rather than the facade on purpose: the facade cannot express
     * this request, which is exactly why the constraint has to exist for the next caller who can.
     */
    @Test
    void theSchemaRefusesAnApprovalWithNoBinding() {
        ReviewReplyApprovalWriter writer =
                new ReviewReplyApprovalWriter(approvalRepo, approvalAudits, txManager);
        assertThatThrownBy(() -> writer.applyApproval(org, review.getId(),
                ReviewReplyApprovalState.APPROVED, null, null, "cmd-impossible", "SELLER:" + user))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(approvalRepo.findAll()).isEmpty();
    }

    /** The mirror image: a withdrawal may not carry a binding. */
    @Test
    void theSchemaRefusesAWithdrawalThatCarriesABinding() {
        ReviewReplyApprovalWriter writer =
                new ReviewReplyApprovalWriter(approvalRepo, approvalAudits, txManager);
        assertThatThrownBy(() -> writer.applyApproval(org, review.getId(),
                ReviewReplyApprovalState.WITHDRAWN, 1, "f".repeat(64), "cmd-impossible",
                "SELLER:" + user))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(approvalRepo.findAll()).isEmpty();
    }

    // --- the trail ------------------------------------------------------------------

    @Test
    void theTrailRecordsTheRealPredecessorAndWhatEachTransitionBound() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();
        service.decideApproval(org, account, ref, "WITHDRAWN", null,
                UUID.randomUUID().toString(), user);

        var trail = approvalAudits.findAll().stream()
                .sorted((a, b) -> a.getCreatedAt().compareTo(b.getCreatedAt())).toList();
        assertThat(trail).hasSize(2);
        assertThat(trail.get(0).getStateFrom()).isNull();
        assertThat(trail.get(0).getStateTo()).isEqualTo(ReviewReplyApprovalState.APPROVED);
        assertThat(trail.get(0).getApprovedVersion()).isEqualTo(1);
        assertThat(trail.get(1).getStateFrom()).isEqualTo(ReviewReplyApprovalState.APPROVED);
        assertThat(trail.get(1).getStateTo()).isEqualTo(ReviewReplyApprovalState.WITHDRAWN);
        // A withdrawal binds nothing — but the trail still remembers what the approval bound.
        assertThat(trail.get(1).getApprovedVersion()).isNull();
        assertThat(trail.get(0).getApprovedVersion()).isEqualTo(1);
    }

    @Test
    void theActorIsTaggedWithoutPii() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        approveHead();

        assertThat(approvalRepo.findAll().get(0).getDecidedBy()).isEqualTo("SELLER:" + user);
        assertThat(draftRepo.findAll().get(0).getCreatedBy()).isEqualTo("SELLER:" + user);
    }

    // --- authorization --------------------------------------------------------------

    @Test
    void anotherOrgsReviewIsNotAddressable() {
        UUID otherOrg = UUID.randomUUID();
        assertThatThrownBy(() -> service.view(otherOrg, account, ref))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.NOT_FOUND));
    }

    /** A review on another account's channel gives the same 404 as an absent one — non-disclosure. */
    @Test
    void aReviewOnAnotherChannelIsNotAddressableFromThisAccount() {
        UUID cafe24 = seedChannel("CAFE24", "카페24");
        UUID cafe24Account = seedAccount(org, cafe24);

        assertThatThrownBy(() -> service.view(org, cafe24Account, ref))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void aMalformedRefIsRejectedBeforeAnyLookup() {
        assertThatThrownBy(() -> service.view(org, account, "not-a-ref"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void anUnsupportedRefSourceSaysSoRatherThanNotFound() {
        assertThatThrownBy(() -> service.view(org, account, "article:" + UUID.randomUUID()))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
    }

    // --- validation -----------------------------------------------------------------

    @Test
    void aBlankBodyIsRejected() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        assertThatThrownBy(() -> service.saveDraft(org, account, ref, "   ", 0, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void anOverLongBodyIsRejected() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        String tooLong = "가".repeat(ReviewReplyValidation.BODY_MAX_BYTES);
        assertThatThrownBy(() -> service.saveDraft(org, account, ref, tooLong, 0, user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void theBodyIsNormalizedBeforeItIsStoredAndFingerprinted() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "  합성\r\n답변  ", 0, user);
        assertThat(view().draft().body()).isEqualTo("합성\n답변");
        // The same intent through a different line ending is the same content, so it replays.
        service.saveDraft(org, account, ref, "합성\r답변", 1, user);
        assertThat(draftRepo.countByReviewId(review.getId())).isEqualTo(1);
    }

    @Test
    void anUnknownApprovalStateIsRejected() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "PROPOSED", 1,
                UUID.randomUUID().toString(), user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void aMissingCommandIdIsRejected() {
        triage(TriageDisposition.RESPONSE_NEEDED);
        service.saveDraft(org, account, ref, "합성-답변 초안", 0, user);
        assertThatThrownBy(() -> service.decideApproval(org, account, ref, "APPROVED", 1, "  ",
                user))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus())
                        .isEqualTo(HttpStatus.BAD_REQUEST));
    }

    // --- the redacted body ----------------------------------------------------------

    @Test
    void theBodyIsRedactedButNotTruncated() {
        Review chatty = seedReview(org, naverChannel, 1);
        chatty.setBody("합성-리뷰-본문: 연락처 010-1234-5678 입니다. " + "가".repeat(200));
        reviews.save(chatty);
        String chattyRef = VocItemRef.forReview(chatty.getId());

        ReviewReplyPrepView v = service.view(org, account, chattyRef);
        assertThat(v.bodyRedacted()).isTrue();
        assertThat(v.redactedBody()).contains("[전화번호]").doesNotContain("1234");
        // Not the 60-char preview: the operator gets the whole complaint.
        assertThat(v.redactedBody().length()).isGreaterThan(200);
    }

    // --- channel review-id identity (review-id-fingerprint/v1) -----------------------

    @Test
    void prepViewCarriesAOneWayIdentityFingerprintAndNeverTheRawChannelId() {
        // A 10-digit id, the shape a NAVER review export's 리뷰글번호 column carries.
        String channelReviewId = "4185720931";
        review.setExternalId(channelReviewId);
        reviews.save(review);

        ReviewReplyPrepView v = view();

        assertThat(v.channelReviewIdFingerprint())
                .isEqualTo(ReviewIdFingerprint.of(channelReviewId))
                .matches("[0-9a-f]{64}");
        // The whole point: the raw id must not be reachable from this response.
        assertThat(v.toString()).doesNotContain(channelReviewId);
        // And it is a DIFFERENT contract from the body fingerprint, for the same review.
        assertThat(v.channelReviewIdFingerprint()).isNotEqualTo(ReviewBodyFingerprint.of(BODY));
    }

    @Test
    void prepViewIdentityIsNullWhenTheReviewWasIngestedWithoutAChannelId() {
        // The seeded review has no external id — the runtime must see "no identity", never a fabricated one.
        assertThat(view().channelReviewIdFingerprint()).isNull();
    }

    @Test
    void prepViewCarriesTheCoarseRatingAsTheSecondaryFact() {
        assertThat(view().rating()).isEqualTo(2);
    }
}
