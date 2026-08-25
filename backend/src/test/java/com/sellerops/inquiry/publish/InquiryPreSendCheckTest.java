package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.inquiry.publish.dto.PublishStatusView;
import com.sellerops.inquiry.reply.EsmAnswerValidation;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.ReplyDraftFingerprint;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The last gate before the only marketplace WRITE in the product.
 *
 * <p>Each test moves exactly one thing between the approval and the dispatch and asserts that nothing
 * was sent. That shape is the point: an approval is a statement about a moment, and these are the
 * six ways the world can stop matching it. The counterpart test — that a send DOES happen when
 * nothing moved — lives in {@code InquiryPublishServiceTest}, so a mistake that refused everything
 * would fail there rather than passing quietly here.
 *
 * <p>The last two tests are about the difference between a refusal and an ignorance: a stale channel
 * does not block the send (a quiet channel would make the feature unusable) but is recorded on the
 * row and surfaced, so the human who accepts the risk is the human who was told about it.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryPreSendCheckTest {

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

    private static final String CH_CODE = "COUPANG";
    private static final String TITLE = "승인 제목";
    private static final String BODY = "승인 내용";
    private static final String EXTERNAL_ID = "onlineInquiry:9001";

    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private InquiryPublishBindingWriter writer;
    private RecordingAdapter adapter;
    private UUID channelId;

    @BeforeEach
    void setUp() {
        writer = new InquiryPublishBindingWriter(workItems, approvals, intents, executions, audits, txManager);
        adapter = new RecordingAdapter();
        Channel c = new Channel();
        c.setCode(CH_CODE);
        c.setNameKo("사전확인 테스트 채널");
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        c.setSupportsReview(false);
        c.setSupportsOrder(false);
        c.setSupportsSales(false);
        c.setSupportsProduct(false);
        c.setSortOrder(0);
        channelId = channels.save(c).getId();
    }

    @Test
    @DisplayName("the account moved after approval — nothing is sent")
    void accountChanged() {
        assertRefused(PreSendCheck.ACCOUNT_CHANGED,
                wi -> wi.setSellerAccountId(UUID.randomUUID()), null);
    }

    @Test
    @DisplayName("the marketplace handle moved after approval — nothing is sent")
    void targetChanged() {
        assertRefused(PreSendCheck.TARGET_CHANGED, null,
                q -> q.setExternalId("onlineInquiry:9999"));
    }

    @Test
    @DisplayName("a pre-V66 approval names no target — nothing is sent, and it cannot borrow one")
    void anApprovalWithNoTargetSnapshotIsUnusable() {
        // A real row in the Demo Org is exactly this shape: an ACTION_PENDING execution bound by an
        // approval written before the target columns existed. Dispatch reads the external id from the
        // INQUIRY, not from the approval — so nothing about that read would stop such a row from being
        // sent. What stops it is here: an approval that cannot prove which handle it agreed to is
        // refused, rather than inheriting whatever handle its work item happens to point at now.
        InquiryWorkItem wi = seed();
        serviceWithoutAdapter().confirmAndPublish(org, wi.getId(), user, "cmd-1", fingerprint());

        InquiryApproval approval = approvals.findByWorkItemId(wi.getId()).orElseThrow();
        approval.setTargetExternalId(null);   // as the pre-V66 row carries it
        approvals.save(approval);

        PublishStatusView view = service(PreSendCheck.proven()).resume(org, wi.getId());

        assertThat(adapter.published).as("nothing may reach the marketplace").isEmpty();
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getFailureReason())
                .isEqualTo(PreSendCheck.NO_TARGET_SNAPSHOT);
        assertThat(view.executionStatus()).isEqualTo(InquiryExecutionStatus.FAILED.name());
    }

    @Test
    @DisplayName("the source resource is not the one the approval named — nothing is sent")
    void subtypeChanged() {
        // Approved for the channel's only inquiry resource; the row now claims a named one. Different
        // identifier space, different endpoint: an approval for one is not an approval for the other,
        // and null is a value here rather than a wildcard that matches anything.
        assertRefused(PreSendCheck.SUBTYPE_CHANGED, null,
                q -> q.setSourceSubtype(InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY));
    }

    @Test
    @DisplayName("the target is not the seller's own data — nothing is sent")
    void syntheticTarget() {
        // The queue already refuses to carry manufactured work, so reaching this line means the row
        // was reclassified after its approval was granted. The external id of a DEMO_SEED row is
        // shaped exactly like a real one, and the marketplace would answer whatever that string names
        // over there — which is why this is a refusal at the last gate rather than a warning.
        assertRefused(PreSendCheck.SYNTHETIC_TARGET, null,
                q -> q.setDataOrigin(DataOrigin.DEMO_SEED));
    }

    @Test
    @DisplayName("someone answered it on the marketplace in the meantime — nothing is sent")
    void alreadyAnswered() {
        assertRefused(PreSendCheck.ALREADY_ANSWERED, null,
                q -> q.setAnsweredAt(Instant.parse("2026-08-24T01:00:00Z")));
    }

    @Test
    @DisplayName("an answer body appeared without an answered_at — still already answered")
    void alreadyAnsweredByBody() {
        assertRefused(PreSendCheck.ALREADY_ANSWERED, null,
                q -> q.setAnswerBody("판매자가 이미 남긴 답변"));
    }

    @Test
    @DisplayName("the inquiry is no longer active for this org — nothing is sent")
    void notAnswerable() {
        assertRefused(PreSendCheck.NOT_ANSWERABLE, null,
                q -> q.setOperationalState(InquiryOperationalState.EXCLUDED_SPAM));
    }

    @Test
    @DisplayName("a stale channel does NOT block the send — it is recorded on the row instead")
    void staleStateIsRecordedNotRefused() {
        InquiryWorkItem wi = seed();
        PublishStatusView view = service(PreSendCheck.unproven(PreSendCheck.STATE_NOT_FRESH))
                .confirmAndPublish(org, wi.getId(), user, "cmd-stale", fingerprint());

        assertThat(adapter.published).as("the seller approved it; a quiet channel is not a veto").hasSize(1);
        assertThat(view.presendStateProven()).isFalse();
        assertThat(view.presendNote()).isEqualTo(PreSendCheck.STATE_NOT_FRESH);
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getPresendStateProven()).isFalse();
    }

    @Test
    @DisplayName("a fresh channel records the proof, so the two cases are distinguishable afterwards")
    void freshStateIsRecorded() {
        InquiryWorkItem wi = seed();
        PublishStatusView view = service(PreSendCheck.proven())
                .confirmAndPublish(org, wi.getId(), user, "cmd-fresh", fingerprint());

        assertThat(adapter.published).hasSize(1);
        assertThat(view.presendStateProven()).isTrue();
        assertThat(view.presendNote()).isNull();
    }

    @Test
    @DisplayName("덮어쓰는 채널에서는 '확인 불가'가 경고가 아니라 거절이다 — 남의 답변을 지울 수 있으므로")
    void anUnprovenStateBlocksASendThatWouldOverwrite() {
        UUID naver = naverChannel();
        InquiryWorkItem wi = seedOn(naver, "naver-qna:676568657",
                InquirySourceSubtype.NAVER_PRODUCT_QNA);
        RecordingAdapter qna = new RecordingAdapter(naverCode(), InquirySourceSubtype.NAVER_PRODUCT_QNA);

        serviceFor(qna, PreSendCheck.unproven(PreSendCheck.STATE_NOT_FRESH))
                .confirmAndPublish(org, wi.getId(), user, "cmd-overwrite", fingerprint());

        // PUT /v1/contents/qnas/{questionId} replaces rather than refuses. Sending on a stale reading
        // of "still unanswered" would delete whatever a person typed in the NAVER console.
        assertThat(qna.published).as("nothing may reach the marketplace").isEmpty();
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getFailureReason())
                .isEqualTo(PreSendCheck.OVERWRITE_WITHOUT_PROOF);
    }

    @Test
    @DisplayName("같은 '확인 불가'라도 거절하는 채널에서는 여전히 사람의 판단에 맡긴다")
    void theSameUnprovenStateStillSendsWhereADuplicateIsRefused() {
        UUID naver = naverChannel();
        InquiryWorkItem wi = seedOn(naver, "naver-payinq:322684048",
                InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY);
        RecordingAdapter customer =
                new RecordingAdapter(naverCode(), InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY);

        PublishStatusView view =
                serviceFor(customer, PreSendCheck.unproven(PreSendCheck.STATE_NOT_FRESH))
                        .confirmAndPublish(org, wi.getId(), user, "cmd-dupe-safe", fingerprint());

        // 고객 문의 answers a duplicate with ERR-NC-101010. The worst case is a refusal, not a
        // deletion, so the seller's own approval still decides.
        assertThat(customer.published).hasSize(1);
        assertThat(view.presendStateProven()).isFalse();
        assertThat(view.presendNote()).isEqualTo(PreSendCheck.STATE_NOT_FRESH);
    }

    @Test
    @DisplayName("an inquiry with no marketplace handle cannot be approved at all")
    void noHandleIsRefusedAtApproval() {
        InquiryWorkItem wi = seed();
        mutateInquiry(wi, q -> q.setExternalId(null));

        assertThatThrownBy(() -> service(PreSendCheck.proven())
                .confirmAndPublish(org, wi.getId(), user, "cmd-nohandle", fingerprint()))
                .hasMessageContaining("식별자");
        assertThat(adapter.published).isEmpty();
        assertThat(approvals.findByWorkItemId(wi.getId())).isEmpty();
    }

    // ────────────────────────────────────────── re-arm after a corrected request

    /** Refuses the way a mall refuses a malformed body: permanent, with a status, creating nothing. */
    private static final class RejectingAdapter implements ChannelReplyAdapter {
        int posts;

        @Override
        public String channelCode() {
            return CH_CODE;
        }

        @Override
        public ReplyPublishResult publish(ReplyPublishCommand command) {
            posts++;
            return ReplyPublishResult.permanentFailure(400);
        }

        @Override
        public ReplyVerificationResult verify(ReplyVerificationCommand command) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
    }

    private InquiryWorkItem refusedOnce(RejectingAdapter mall) {
        InquiryWorkItem wi = seed();
        serviceFor(mall, PreSendCheck.proven())
                .confirmAndPublish(org, wi.getId(), user, "cmd-1", fingerprint());
        assertThat(mall.posts).isEqualTo(1);
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getStatus())
                .isEqualTo(InquiryExecutionStatus.FAILED);
        return wi;
    }

    @Test
    @DisplayName("요청을 고친 뒤의 재장전은 거절을 지우기 전에 먼저 기록한다")
    void rearmingWritesTheRefusalDownBeforeClearingIt() {
        RejectingAdapter mall = new RejectingAdapter();
        InquiryWorkItem wi = refusedOnce(mall);

        serviceFor(mall, PreSendCheck.proven())
                .rearmAfterRequestCorrection(org, wi.getId(), user, "7c9b6532");

        // The refused attempt is gone from the row — and present in the audit, which is the point.
        InquiryExecution execution = executions.findByWorkItemId(wi.getId()).orElseThrow();
        assertThat(execution.getStatus()).isEqualTo(InquiryExecutionStatus.ACTION_PENDING);
        assertThat(execution.getResultCode()).isNull();
        assertThat(execution.getFailureReason()).isNull();
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.ACTION_PENDING);

        InquiryWorkItemAudit rearm = audits.findAll().stream()
                .filter(a -> a.getEventType() == InquiryWorkItemEvent.EXECUTION_REARMED)
                .findFirst().orElseThrow();
        assertThat(rearm.getPhaseFrom()).isEqualTo(InquiryWorkItemPhase.FAILED);
        assertThat(rearm.getPhaseTo()).isEqualTo(InquiryWorkItemPhase.ACTION_PENDING);
        assertThat(rearm.getCommandId()).contains("400").contains("created0").contains("7c9b6532");
        assertThat(rearm.getActor()).startsWith("SELLER:");
        // And the first failure's own audit entry is untouched.
        assertThat(audits.findAll()).anyMatch(a ->
                a.getEventType() == InquiryWorkItemEvent.EXECUTION_RECORDED
                        && a.getPhaseTo() == InquiryWorkItemPhase.FAILED);
        // Re-arming sends nothing.
        assertThat(mall.posts).isEqualTo(1);
    }

    @Test
    @DisplayName("두 번째 시도도 자기 결과를 기록한다 — 감사 키가 시도마다 다르다")
    void asecondAttemptRecordsItsOwnOutcome() {
        // Observed live on 2026-08-25: attempt 2 reused attempt 1's audit command id, the unique key
        // (work_item_id, command_id) rejected the insert, and the second attempt's outcome never
        // reached the history at all — the execution row said FAILED/422 and the audit said nothing.
        RejectingAdapter mall = new RejectingAdapter();
        InquiryWorkItem wi = refusedOnce(mall);
        InquiryPublishService service = serviceFor(mall, PreSendCheck.proven());
        service.rearmAfterRequestCorrection(org, wi.getId(), user, "7c9b6532");

        service.resume(org, wi.getId());

        assertThat(mall.posts).as("재장전 뒤의 전송은 정확히 한 번 더").isEqualTo(2);
        List<InquiryWorkItemAudit> recorded = audits.findByWorkItemIdOrderByCreatedAtAsc(wi.getId())
                .stream().filter(a -> a.getEventType() == InquiryWorkItemEvent.EXECUTION_RECORDED)
                .toList();
        assertThat(recorded).as("시도 1과 시도 2가 각각 한 줄씩").hasSize(2);
        assertThat(recorded.get(0).getCommandId()).isEqualTo("execute:" + wi.getId());
        assertThat(recorded.get(1).getCommandId()).isEqualTo("execute:" + wi.getId() + "#2");
        assertThat(recorded).allMatch(a -> a.getPhaseTo() == InquiryWorkItemPhase.FAILED);
    }

    @Test
    @DisplayName("채널이 무언가 만들었을 수 있으면 재장전하지 않는다")
    void aProviderReferenceForbidsRearming() {
        RejectingAdapter mall = new RejectingAdapter();
        InquiryWorkItem wi = refusedOnce(mall);
        InquiryExecution execution = executions.findByWorkItemId(wi.getId()).orElseThrow();
        execution.setProviderMessageNo("901");   // as a partial success would leave it
        executions.save(execution);

        InquiryPublishService service = serviceFor(mall, PreSendCheck.proven());
        assertThatThrownBy(() -> service.rearmAfterRequestCorrection(org, wi.getId(), user, "fix"))
                .hasMessageContaining("생성");
        assertThat(mall.posts).isEqualTo(1);
    }

    @Test
    @DisplayName("승인 당시와 달라졌으면 재장전하지 않는다")
    void rearmingRevalidatesTheApproval() {
        RejectingAdapter mall = new RejectingAdapter();
        InquiryWorkItem wi = refusedOnce(mall);
        mutateInquiry(wi, q -> q.setExternalId("onlineInquiry:9999"));

        InquiryPublishService service = serviceFor(mall, PreSendCheck.proven());
        assertThatThrownBy(() -> service.rearmAfterRequestCorrection(org, wi.getId(), user, "fix"))
                .hasMessageContaining("달라져");
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.FAILED);
    }

    @Test
    @DisplayName("실패하지 않은 전송은 재장전 대상이 아니다")
    void onlyAFailedSendCanBeRearmed() {
        InquiryWorkItem wi = seed();
        InquiryPublishService service = service(PreSendCheck.proven());
        service.confirmAndPublish(org, wi.getId(), user, "cmd-1", fingerprint());

        assertThatThrownBy(() -> service.rearmAfterRequestCorrection(org, wi.getId(), user, "fix"))
                .hasMessageContaining("실패한 전송만");
    }

    // ---- helpers ----

    /**
     * Approve, then move one thing, then dispatch — and assert the dispatch refused for the named
     * reason. The move happens AFTER the binding on purpose: a check that ran before the approval
     * would be testing the confirm, not the gate that protects an approval already granted.
     */
    private void assertRefused(String reason, Consumer<InquiryWorkItem> moveWorkItem,
                               Consumer<Inquiry> moveInquiry) {
        InquiryWorkItem wi = seed();
        InquiryPublishService service = service(PreSendCheck.proven());

        // Bind with no adapter registered, so the approval exists and nothing has dispatched yet.
        InquiryPublishService binder = serviceWithoutAdapter();
        binder.confirmAndPublish(org, wi.getId(), user, "cmd-1", fingerprint());
        assertThat(approvals.findByWorkItemId(wi.getId())).isPresent();

        if (moveWorkItem != null) {
            InquiryWorkItem row = workItems.findById(wi.getId()).orElseThrow();
            moveWorkItem.accept(row);
            workItems.save(row);
        }
        if (moveInquiry != null) {
            mutateInquiry(wi, moveInquiry);
        }

        PublishStatusView view = service.resume(org, wi.getId());

        assertThat(adapter.published).as("nothing may reach the marketplace").isEmpty();
        assertThat(view.executionStatus()).isEqualTo(InquiryExecutionStatus.FAILED.name());
        assertThat(executions.findByWorkItemId(wi.getId()).orElseThrow().getFailureReason())
                .isEqualTo(reason);
        assertThat(workItems.findById(wi.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.FAILED);
    }

    private void mutateInquiry(InquiryWorkItem wi, Consumer<Inquiry> mutation) {
        Inquiry row = inquiries.findById(wi.getInquiryId()).orElseThrow();
        mutation.accept(row);
        inquiries.save(row);
    }

    private InquiryPublishService service(PreSendCheck answer) {
        return new InquiryPublishService(workItems, drafts, inquiries, approvals, executions,
                verifications, audits, writer, new ChannelReplyAdapterRegistry(channels, List.of(adapter)),
                fixed(answer), new InquiryReplyCapabilityRegistry(), channels);
    }

    private static String naverCode() {
        return "NAVER";
    }

    private UUID naverChannel() {
        Channel c = new Channel();
        c.setCode(naverCode());
        c.setNameKo("네이버");
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        c.setSupportsReview(false);
        c.setSupportsOrder(false);
        c.setSupportsSales(false);
        c.setSupportsProduct(false);
        c.setSortOrder(1);
        return channels.save(c).getId();
    }

    private InquiryPublishService serviceFor(ChannelReplyAdapter only, PreSendCheck answer) {
        return new InquiryPublishService(workItems, drafts, inquiries, approvals, executions,
                verifications, audits, writer, new ChannelReplyAdapterRegistry(channels, List.of(only)),
                fixed(answer), new InquiryReplyCapabilityRegistry(), channels);
    }

    private InquiryPublishService serviceWithoutAdapter() {
        return new InquiryPublishService(workItems, drafts, inquiries, approvals, executions,
                verifications, audits, writer, new ChannelReplyAdapterRegistry(channels, List.of()),
                fixed(PreSendCheck.proven()), new InquiryReplyCapabilityRegistry(), channels);
    }

    private static InquiryTargetStateReader fixed(PreSendCheck answer) {
        return new InquiryTargetStateReader(null, null) {
            @Override
            public PreSendCheck read(UUID orgId, UUID channelId) {
                return answer;
            }
        };
    }

    private static String fingerprint() {
        return ReplyDraftFingerprint.of(TITLE, BODY);
    }

    private InquiryWorkItem seed() {
        return seedOn(channelId, EXTERNAL_ID, null);
    }

    private InquiryWorkItem seedOn(UUID channel, String externalId, String subtype) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channel);
        q.setTitle("문의 제목");
        q.setBody("문의 본문");
        q.setStatus("UNANSWERED");
        q.setExternalId(externalId);
        // The default fixture channel has exactly one inquiry resource, so its seeded subtype is null
        // — the same shape a Coupang row really has. subtypeChanged() mutates it to a named resource,
        // which is the mismatch the check exists for.
        q.setSourceSubtype(subtype);
        q.setOperationalState(InquiryOperationalState.ACTIVE);
        q.setReceivedAt(Instant.parse("2026-08-20T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(channel);
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        wi = workItems.save(wi);

        InquiryReplyDraft d = new InquiryReplyDraft();
        d.setOrgId(org);
        d.setWorkItemId(wi.getId());
        d.setVersion(1);
        d.setAnswerStatus(2);
        d.setTitle(TITLE);
        d.setComments(BODY);
        d.setContentFingerprint(fingerprint());
        d.setFingerprintAlgorithm(EsmAnswerValidation.FINGERPRINT_ALGORITHM);
        d.setCreatedBy("SELLER:" + user);
        drafts.save(d);
        return wi;
    }

    /** Records every publish so "nothing was sent" is an observation, not an absence of assertion. */
    static final class RecordingAdapter implements ChannelReplyAdapter {
        final List<ReplyPublishCommand> published = new ArrayList<>();
        private final String code;
        private final String subtype;

        RecordingAdapter() {
            this(CH_CODE, null);
        }

        RecordingAdapter(String code, String subtype) {
            this.code = code;
            this.subtype = subtype;
        }

        @Override
        public String channelCode() {
            return code;
        }

        @Override
        public boolean servesSubtype(String sourceSubtype) {
            return java.util.Objects.equals(subtype, sourceSubtype);
        }

        @Override
        public ReplyPublishResult publish(ReplyPublishCommand command) {
            published.add(command);
            return ReplyPublishResult.confirmed("PROV-1");
        }

        @Override
        public ReplyVerificationResult verify(ReplyVerificationCommand command) {
            return ReplyVerificationResult.notCompleted("PENDING");
        }
    }
}
