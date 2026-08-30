package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.reviewimport.ReviewImportPlanRepository;
import com.sellerops.reviewimport.ReviewImportSegmentAttemptRepository;
import com.sellerops.reviewimport.ReviewImportSegmentRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.publish.dto.PublishStatusView;
import com.sellerops.inquiry.reply.EsmAnswerValidation;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.ReplyDraftFingerprint;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Channel-neutral seller-confirmed reply flow: confirm → immutable binding → (gated)
 * dispatch → verify. The channel is a {@link FakeChannelReplyAdapter} (a NON-ESM code),
 * proving the core drives publish/verify entirely through the neutral adapter contract:
 * no ESM types, no token rules, no status strings. Fail-closed = no adapter registered
 * (execution disabled OR an unsupported channel).
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryPublishServiceTest {

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository drafts;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryApprovalRepository approvals;
    @Autowired InquiryActionIntentRepository intents;
    @Autowired InquiryExecutionRepository executions;
    @Autowired InquiryVerificationRepository verifications;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired Cafe24CommunityArticleRepository articles;
    @Autowired SyncJobRepository syncJobs;
    @Autowired ReviewImportSegmentAttemptRepository attempts;
    @Autowired ReviewImportSegmentRepository segments;
    @Autowired ReviewImportPlanRepository plans;

    /** The real resolver over the real repositories — the identity gate is exercised, not stubbed. */
    private ExecutableIdentityResolver resolver() {
        return new ExecutableIdentityResolver(sellerAccounts, channels, articles, syncJobs, attempts, segments, plans);
    }

    /** An API-mode account on the channel — what makes a row a marketplace object. */
    private UUID seedApiAccount(UUID orgId, UUID channelId) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(orgId);
        acc.setChannelId(channelId);
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        return sellerAccounts.save(acc).getId();
    }

    static final String CH_CODE = "COUPANG";
    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private static final String APPROVED_TITLE = "승인 제목";
    private static final String APPROVED_COMMENTS = "승인 내용";

    private InquiryPublishBindingWriter writer;
    private FakeChannelReplyAdapter adapter;
    private UUID servedChannelId;

    @BeforeEach
    void setUp() {
        writer = new InquiryPublishBindingWriter(workItems, approvals, intents, executions, audits, txManager);
        adapter = new FakeChannelReplyAdapter();
        servedChannelId = seedChannel(CH_CODE);
    }

    private UUID seedChannel(String code) {
        Channel c = new Channel();
        c.setCode(code);
        c.setNameKo("테스트 채널 " + code);
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        c.setSupportsReview(false);
        c.setSupportsOrder(false);
        c.setSupportsSales(false);
        c.setSupportsProduct(false);
        c.setSortOrder(0);
        return channels.save(c).getId();
    }

    /** Service WITH the fake adapter registered (a channel adapter is available). */
    private InquiryPublishService withAdapter() {
        return new InquiryPublishService(workItems, drafts, inquiries, approvals, executions,
                verifications, audits, writer, new ChannelReplyAdapterRegistry(channels, List.of(adapter)),
                targetState(), new InquiryReplyCapabilityRegistry(), channels, resolver());
    }

    /** Service with NO adapter registered (fail-closed: nothing dispatches). */
    private InquiryPublishService withoutAdapter() {
        return new InquiryPublishService(workItems, drafts, inquiries, approvals, executions,
                verifications, audits, writer, new ChannelReplyAdapterRegistry(channels, List.of()),
                targetState(), new InquiryReplyCapabilityRegistry(), channels, resolver());
    }

    /**
     * A target-state reader that always reports the state as proven, so these tests exercise the
     * dispatch decisions rather than the coverage read. The pre-send check's own behaviour — the
     * refusals, and the unproven-but-allowed path — is covered by {@code InquiryPreSendCheckTest}.
     * Built as an override rather than a mock so it needs no stubbing imports.
     */
    private static InquiryTargetStateReader targetState() {
        return new InquiryTargetStateReader(null, null) {
            @Override
            public PreSendCheck read(java.util.UUID orgId, java.util.UUID channelId) {
                return PreSendCheck.proven();
            }
        };
    }

    private static String approvedFingerprint() {
        return ReplyDraftFingerprint.of(APPROVED_TITLE, APPROVED_COMMENTS);
    }

    private InquiryWorkItem seedProposedWithDraft(UUID orgId, UUID channelId) {
        Inquiry q = new Inquiry();
        q.setOrgId(orgId);
        q.setChannelId(channelId);
        q.setTitle("문의 제목");
        q.setBody("문의 본문");
        q.setStatus("UNANSWERED");
        q.setInformStatus("미처리");
        q.setExternalId("onlineInquiry:123"); // a channel object the resolver can name
        q.setReceivedAt(Instant.parse("2026-06-27T00:00:00Z"));
        UUID accountId = seedApiAccount(orgId, channelId);
        q.setSellerAccountId(accountId);
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(orgId);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(accountId);
        wi.setChannelId(channelId);
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        wi = workItems.save(wi);

        InquiryReplyDraft d = new InquiryReplyDraft();
        d.setOrgId(orgId);
        d.setWorkItemId(wi.getId());
        d.setVersion(1);
        d.setAnswerStatus(2);
        d.setTitle(APPROVED_TITLE);
        d.setComments(APPROVED_COMMENTS);
        d.setContentFingerprint(approvedFingerprint());
        d.setFingerprintAlgorithm(EsmAnswerValidation.FINGERPRINT_ALGORITHM);
        d.setCreatedBy("SELLER:" + user);
        drafts.save(d);
        return wi;
    }

    private InquiryWorkItem seedServed() {
        return seedProposedWithDraft(org, servedChannelId);
    }

    // ---- neutral fake channel ----
    static final class FakeChannelReplyAdapter implements ChannelReplyAdapter {
        ReplyPublishResult publishResult = ReplyPublishResult.confirmed("PROV-1");
        ReplyVerificationResult verifyResult = ReplyVerificationResult.notCompleted("PENDING");
        final List<ReplyPublishCommand> published = new ArrayList<>();

        @Override
        public String channelCode() {
            return CH_CODE;
        }

        @Override
        public ReplyPublishResult publish(ReplyPublishCommand command) {
            published.add(command);
            return publishResult;
        }

        @Override
        public ReplyVerificationResult verify(ReplyVerificationCommand command) {
            return verifyResult;
        }
    }

    @Test
    void confirmBindsTheExactDraftAndFreezesItWhenNoAdapterIsRegistered() {
        InquiryWorkItem wi = seedServed();
        PublishStatusView v = withoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.PENDING);
        assertThat(v.phase()).isEqualTo("ACTION_PENDING");
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.ACTION_PENDING);
        InquiryApproval a = approvals.findByWorkItemId(wi.getId()).orElseThrow();
        assertThat(a.getApprovedDraftVersion()).isEqualTo(1);
        assertThat(a.getApprovedFingerprint()).isEqualTo(approvedFingerprint());
        assertThat(intents.findByWorkItemId(wi.getId())).isPresent();
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.ACTION_PENDING);
        assertThat(adapter.published).isEmpty(); // no adapter → nothing dispatched

        // Draft is frozen: no longer PROPOSED, so the draft service rejects edits.
        InquiryReplyDraftService draftService = new InquiryReplyDraftService(workItems, drafts);
        assertThatThrownBy(() -> draftService.save(org, wi.getId(), user, "새 제목", "새 내용", 1))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void changedFingerprintConflicts() {
        InquiryWorkItem wi = seedServed();
        assertThatThrownBy(() -> withoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", "WRONG-FP"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(approvals.findByWorkItemId(wi.getId())).isEmpty();
    }

    @Test
    void tenantIsolatedByOrg() {
        InquiryWorkItem wi = seedServed();
        assertThatThrownBy(() -> withoutAdapter()
                .confirmAndPublish(UUID.randomUUID(), wi.getId(), user, "cmd1", approvedFingerprint()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void unauditedChannelIsRefusedWithAReasonRatherThanLeftPending() {
        // A work item on a channel SellerOps has never audited a write path for — even though an
        // adapter exists for CH_CODE. This used to sit at ACTION_PENDING indefinitely, which reads on
        // every screen as "still working on it" for something that will never send. The capability
        // answer is permanent until an audit changes it, so it fails with that reason recorded.
        UUID unsupported = seedChannel("UNSUPPORTED_CHANNEL");
        InquiryWorkItem wi = seedProposedWithDraft(org, unsupported);

        PublishStatusView v = withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.PERMANENT_FAILURE);
        assertThat(adapter.published).isEmpty(); // fail closed: nothing dispatched
        InquiryExecution ex = executions.findByWorkItemId(wi.getId()).orElseThrow();
        assertThat(ex.getStatus()).isEqualTo(InquiryExecutionStatus.FAILED);
        assertThat(ex.getFailureReason()).isEqualTo(PreSendCheck.WRITE_NOT_SUPPORTED);
    }

    @Test
    void adapterRetryableRevertsToPendingAndSurfacesRetryable() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.retryableFailure();
        PublishStatusView v = withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.RETRYABLE_FAILURE);
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.ACTION_PENDING); // nothing committed — retryable
    }

    @Test
    void dispatchPublishesTheApprovedPayloadExactlyAndVerifiesToCompleted() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.confirmed("PROV-9");
        adapter.verifyResult = ReplyVerificationResult.completed("DONE");

        PublishStatusView v = withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        assertThat(adapter.published).hasSize(1);
        ReplyPublishCommand c = adapter.published.get(0);
        assertThat(c.externalId()).isEqualTo("onlineInquiry:123");
        assertThat(c.subject()).isEqualTo(APPROVED_TITLE);
        assertThat(c.body()).isEqualTo(APPROVED_COMMENTS);
        assertThat(c.channelId()).isEqualTo(servedChannelId);
        assertThat(c.sellerAccountId()).isEqualTo(wi.getSellerAccountId());

        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.COMPLETED);
        assertThat(v.executionStatus()).isEqualTo("COMPLETED");
        assertThat(v.providerMessageNo()).isEqualTo("PROV-9");
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.COMPLETED);
        // Conversation Object Integrity v1: the verified read-back is the inquiry's answer state too —
        // rows/count (inquiries.status) and workload (work item phase) must never disagree.
        Inquiry answered = inquiries.findById(wi.getInquiryId()).orElseThrow();
        assertThat(answered.getStatus()).isEqualTo("ANSWERED");
        assertThat(answered.getAnsweredAt()).isNotNull();
    }

    @Test
    void executedButNotVerifiedLeavesTheInquiryUnanswered() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.confirmed("PROV-9");
        adapter.verifyResult = ReplyVerificationResult.notCompleted("PENDING");

        withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        // A 2xx is not an answer: only the verified read-back flips the row.
        assertThat(inquiries.findById(wi.getInquiryId()).orElseThrow().getStatus()).isEqualTo("UNANSWERED");
    }

    @Test
    void commonPersistenceHoldsOnlyNeutralProviderFields() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.confirmed("PROV-7");
        adapter.verifyResult = ReplyVerificationResult.completed("DONE");
        withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        InquiryExecution ex = executions.findByWorkItemId(wi.getId()).orElseThrow();
        // The neutral core stores only a provider reference (on success) and a numeric
        // result code (on failure) — never a token or provider free-text message.
        assertThat(ex.getProviderMessageNo()).isEqualTo("PROV-7");
        assertThat(ex.getResultCode()).isNull();
        assertThat(ex.getFailureReason()).isNull();
        // The neutral command the core built exposes no channel-secret components.
        List<String> components = new ArrayList<>();
        for (var rc : ReplyPublishCommand.class.getRecordComponents()) {
            components.add(rc.getName());
        }
        assertThat(components).doesNotContain("token").doesNotContain("answerStatus");
    }

    @Test
    void duplicateCommandDoesNotPublishTwice() {
        InquiryWorkItem wi = seedServed();
        adapter.verifyResult = ReplyVerificationResult.completed("DONE");
        InquiryPublishService svc = withAdapter();
        svc.confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        svc.confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint()); // replay

        assertThat(adapter.published).hasSize(1);
    }

    @Test
    void deliveryUnknownVerifiesBeforeAnyRetryAndNeverResends() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.deliveryUnknown();
        PublishStatusView afterDispatch = withAdapter()
                .confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        assertThat(afterDispatch.executionStatus()).isEqualTo("DELIVERY_UNKNOWN");
        assertThat(afterDispatch.category()).isEqualTo(PublishOutcomeCategory.CHECKING_REQUIRED);
        assertThat(adapter.published).hasSize(1);

        // Verify FIRST (the publish may have landed): COMPLETED ⇒ no resend.
        adapter.verifyResult = ReplyVerificationResult.completed("DONE");
        PublishStatusView afterVerify = withAdapter().verify(org, wi.getId());
        assertThat(afterVerify.category()).isEqualTo(PublishOutcomeCategory.COMPLETED);
        assertThat(adapter.published).hasSize(1); // never resent
    }

    @Test
    void executedButNotVerifiedStaysCheckingUntilVerified() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.confirmed("PROV-1");
        adapter.verifyResult = ReplyVerificationResult.notCompleted("PENDING");
        withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.EXECUTED);

        adapter.verifyResult = ReplyVerificationResult.completed("DONE");
        PublishStatusView v = withAdapter().verify(org, wi.getId());
        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.COMPLETED);
        assertThat(adapter.published).hasSize(1); // verify never publishes
    }

    @Test
    void noResendAfterConfirmedExecution() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.confirmed("PROV-1");
        adapter.verifyResult = ReplyVerificationResult.notCompleted("PENDING");
        InquiryPublishService svc = withAdapter();
        svc.confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint()); // EXECUTED
        svc.confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint()); // replay, no resend
        svc.verify(org, wi.getId()); // verify-only, no resend
        assertThat(adapter.published).hasSize(1);
    }

    @Test
    void pendingConfirmationCanResumeOnceAnAdapterIsAvailable() {
        InquiryWorkItem wi = seedServed();
        adapter.verifyResult = ReplyVerificationResult.completed("DONE");
        // Confirmed with NO adapter → bound, ACTION_PENDING, nothing dispatched.
        withoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        assertThat(adapter.published).isEmpty();
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.ACTION_PENDING);

        // Later, an adapter is registered → resume dispatches the already-bound publish.
        PublishStatusView v = withAdapter().resume(org, wi.getId());
        assertThat(adapter.published).hasSize(1);
        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.COMPLETED);
    }

    @Test
    void resumeWithoutAdapterDoesNotDispatch() {
        InquiryWorkItem wi = seedServed();
        withoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        PublishStatusView v = withoutAdapter().resume(org, wi.getId());
        assertThat(adapter.published).isEmpty();
        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.PENDING);
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.ACTION_PENDING);
    }

    @Test
    void processRestartFromDispatchingVerifiesBeforeAnyResend() {
        InquiryWorkItem wi = seedServed();
        withoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        // Simulate a crash mid-publish: the row is left DISPATCHING.
        InquiryExecution ex = executions.findByWorkItemId(wi.getId()).orElseThrow();
        ex.setStatus(InquiryExecutionStatus.DISPATCHING);
        executions.save(ex);

        adapter.verifyResult = ReplyVerificationResult.completed("DONE"); // the publish had in fact landed
        PublishStatusView v = withAdapter().resume(org, wi.getId());
        // Reclassified to DELIVERY_UNKNOWN then verified — never resent.
        assertThat(adapter.published).isEmpty();
        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.COMPLETED);
    }

    @Test
    void recoverAbandonedDispatchingReclassifiesWithoutResend() {
        InquiryWorkItem wi = seedServed();
        withoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        InquiryExecution ex = executions.findByWorkItemId(wi.getId()).orElseThrow();
        ex.setStatus(InquiryExecutionStatus.DISPATCHING);
        executions.save(ex);

        int recovered = withAdapter().recoverAbandonedDispatching();
        assertThat(recovered).isGreaterThanOrEqualTo(1);
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.DELIVERY_UNKNOWN);
        assertThat(adapter.published).isEmpty();
    }

    @Test
    void verificationCanCompleteAfterARestart() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.confirmed("PROV-1");
        adapter.verifyResult = ReplyVerificationResult.notCompleted("PENDING"); // not resolved at dispatch
        withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.EXECUTED);

        adapter.verifyResult = ReplyVerificationResult.completed("DONE");
        PublishStatusView v = withAdapter().resume(org, wi.getId());
        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.COMPLETED);
        assertThat(adapter.published).hasSize(1);
    }

    @Test
    void providerFailureIsPermanent() {
        InquiryWorkItem wi = seedServed();
        adapter.publishResult = ReplyPublishResult.permanentFailure(9001);
        PublishStatusView v = withAdapter().confirmAndPublish(org, wi.getId(), user, "cmd1", approvedFingerprint());

        assertThat(v.category()).isEqualTo(PublishOutcomeCategory.PERMANENT_FAILURE);
        assertThat(v.resultCode()).isEqualTo(9001);
        InquiryExecution ex = executions.findByWorkItemId(wi.getId()).orElseThrow();
        assertThat(ex.getStatus()).isEqualTo(InquiryExecutionStatus.FAILED);
        assertThat(ex.getFailureReason()).isEqualTo("EXECUTION_FAILED");
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.FAILED);
    }

    @Test
    void commonServiceHasNoEsmSpecificDependencies() {
        for (Constructor<?> ctor : InquiryPublishService.class.getDeclaredConstructors()) {
            for (Class<?> p : ctor.getParameterTypes()) {
                assertThat(p.getName())
                        .doesNotContain("connector.esm")
                        .doesNotContain("Esm");
            }
        }
        for (Field f : InquiryPublishService.class.getDeclaredFields()) {
            assertThat(f.getType().getName())
                    .doesNotContain("connector.esm")
                    .doesNotContain("Esm");
        }
    }
}
