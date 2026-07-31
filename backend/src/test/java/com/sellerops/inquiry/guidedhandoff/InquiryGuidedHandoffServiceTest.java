package com.sellerops.inquiry.guidedhandoff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffOutcomeResponse;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffView;
import com.sellerops.inquiry.publish.ChannelReplyAdapter;
import com.sellerops.inquiry.publish.ChannelReplyAdapterRegistry;
import com.sellerops.inquiry.publish.ReplyPublishCommand;
import com.sellerops.inquiry.publish.ReplyPublishResult;
import com.sellerops.inquiry.publish.ReplyVerificationCommand;
import com.sellerops.inquiry.publish.ReplyVerificationResult;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Guided Handoff coordination over the real (H2) DB. Proves the honest, fail-closed
 * contract for a Cafe24 board-6 inquiry: eligibility, a privacy-safe target hint (no
 * body), idempotent MINTED/REPORTED audits — and, the crux, that a guided handoff leaves
 * the work item OPEN so the existing connector reconcile still completes it when the
 * answer is re-collected as 처리완료. Nothing here sends or mutates the work-item phase.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryGuidedHandoffServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();
    private final String actor = "SELLER:" + UUID.randomUUID();

    private UUID cafe24Channel;
    private InquiryWorkItemWriter writer;
    private InquiryGuidedHandoffService service;

    @BeforeEach
    void setUp() {
        cafe24Channel = saveChannel("CAFE24");
        writer = new InquiryWorkItemWriter(inquiries, workItems, audits, txManager);
        service = new InquiryGuidedHandoffService(workItems, inquiries, audits,
                new ChannelReplyAdapterRegistry(channels, List.of()), channels, txManager);
    }

    private UUID saveChannel(String code) {
        Channel channel = new Channel();
        channel.setCode(code);
        channel.setNameKo(code);
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSupportsInquiry(true);
        channel.setSupportsReview(true);
        channel.setSupportsOrder(true);
        channel.setSupportsSales(false);
        channel.setSupportsProduct(false);
        channel.setSortOrder(1);
        return channels.save(channel).getId();
    }

    /** Create an OPEN Cafe24 board-6 inquiry + work item; returns the work item id. */
    private UUID openBoard6Inquiry(long articleNo, UUID channelId) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(channelId);
        inquiry.setSellerAccountId(account);
        inquiry.setTitle("제목");
        inquiry.setBody("본문");
        inquiry.setStatus("UNANSWERED");
        inquiry.setInformStatus("N");
        inquiry.setReceivedAt(Instant.parse("2026-03-24T01:00:00Z"));
        inquiry.setExternalId("cafe24:b6:a" + articleNo);
        inquiry.setSecret(Boolean.TRUE);
        UUID inquiryId = writer.openConnectorInquiry(inquiry, account);
        return workItems.findByInquiryId(inquiryId).orElseThrow().getId();
    }

    private long auditCount(UUID workItemId, InquiryWorkItemEvent type) {
        return audits.findByWorkItemIdOrderByCreatedAtAsc(workItemId).stream()
                .filter(a -> a.getEventType() == type)
                .count();
    }

    private InquiryWorkItemPhase phase(UUID workItemId) {
        return workItems.findById(workItemId).orElseThrow().getPhase();
    }

    @Test
    void eligibleForOpenCafe24Board6InquiryWithSanitizedTargetHint() {
        UUID workItemId = openBoard6Inquiry(3670L, cafe24Channel);

        InquiryGuidedHandoffView view = service.capability(org, workItemId);

        assertThat(view.eligible()).isTrue();
        assertThat(view.mode()).isEqualTo("GUIDED_HANDOFF");
        assertThat(view.boundStoreVerified()).isTrue();
        assertThat(view.boardVerified()).isTrue();
        assertThat(view.deepLink()).isNull();               // checklist-only V1
        assertThat(view.checklist()).isNotEmpty();
        assertThat(view.targetHint().boardNo()).isEqualTo(6);
        assertThat(view.targetHint().articleNo()).isEqualTo(3670L);
        assertThat(view.targetHint().channelCode()).isEqualTo("CAFE24");
        assertThat(view.targetHint().recencyBucket()).isEqualTo("2026-03-24");
        assertThat(view.targetHint().status()).isEqualTo("UNANSWERED");
        assertThat(view.targetHint().informStatus()).isEqualTo("N");
        // The hint carries no inquiry body/title field at all — structurally sanitized.
        assertThat(view.targetHint().toString()).doesNotContain("본문").doesNotContain("제목");
    }

    @Test
    void mintRecordsMintedAuditIdempotentlyAndLeavesPhaseOpen() {
        UUID workItemId = openBoard6Inquiry(3671L, cafe24Channel);

        service.mint(org, workItemId, actor);
        service.mint(org, workItemId, actor);   // replay

        assertThat(auditCount(workItemId, InquiryWorkItemEvent.GUIDED_HANDOFF_MINTED)).isEqualTo(1);
        assertThat(phase(workItemId)).isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void outcomeRecordsUnverifiedReportWithoutCompletingOrChangingPhase() {
        UUID workItemId = openBoard6Inquiry(3672L, cafe24Channel);
        service.mint(org, workItemId, actor);

        InquiryGuidedHandoffOutcomeResponse res = service.recordOutcome(
                org, workItemId, "cmd-1", "OPERATOR_REPORTED_SUBMITTED", actor);

        assertThat(res.recorded()).isTrue();
        assertThat(res.replayed()).isFalse();
        assertThat(res.verified()).isFalse();               // never a completion
        assertThat(auditCount(workItemId, InquiryWorkItemEvent.GUIDED_HANDOFF_REPORTED)).isEqualTo(1);
        assertThat(phase(workItemId)).isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void outcomeReplayIsIdempotent() {
        UUID workItemId = openBoard6Inquiry(3673L, cafe24Channel);

        service.recordOutcome(org, workItemId, "cmd-2", "OPERATOR_REPORTED_SUBMITTED", actor);
        InquiryGuidedHandoffOutcomeResponse replay = service.recordOutcome(
                org, workItemId, "cmd-2", "OPERATOR_REPORTED_SUBMITTED", actor);

        assertThat(replay.replayed()).isTrue();
        assertThat(auditCount(workItemId, InquiryWorkItemEvent.GUIDED_HANDOFF_REPORTED)).isEqualTo(1);
    }

    @Test
    void outcomeSameCommandDifferentOutcomeConflicts() {
        UUID workItemId = openBoard6Inquiry(3674L, cafe24Channel);
        service.recordOutcome(org, workItemId, "cmd-3", "OPERATOR_REPORTED_SUBMITTED", actor);

        assertThatThrownBy(() ->
                service.recordOutcome(org, workItemId, "cmd-3", "SUBMISSION_ABORTED", actor))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void blankCommandIdAndUnknownOutcomeAreBadRequests() {
        UUID workItemId = openBoard6Inquiry(3675L, cafe24Channel);

        assertThatThrownBy(() ->
                service.recordOutcome(org, workItemId, "  ", "OPERATOR_REPORTED_SUBMITTED", actor))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() ->
                service.recordOutcome(org, workItemId, "cmd-x", "WHATEVER", actor))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void notEligibleWhenNotOpen() {
        UUID workItemId = openBoard6Inquiry(3676L, cafe24Channel);
        InquiryWorkItem wi = workItems.findById(workItemId).orElseThrow();
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        workItems.save(wi);

        assertThat(service.capability(org, workItemId).eligible()).isFalse();
        assertThat(service.capability(org, workItemId).reason()).isEqualTo("NOT_OPEN");
        assertThatThrownBy(() -> service.mint(org, workItemId, actor)).isInstanceOf(ApiException.class);
    }

    @Test
    void notEligibleForNonBoard6Article() {
        // A board-4 (review) external id on the same Cafe24 channel is not a guided inquiry.
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(cafe24Channel);
        inquiry.setSellerAccountId(account);
        inquiry.setBody("본문");
        inquiry.setStatus("UNANSWERED");
        inquiry.setReceivedAt(Instant.parse("2026-03-24T01:00:00Z"));
        inquiry.setExternalId("cafe24:b4:a900");
        UUID inquiryId = writer.openConnectorInquiry(inquiry, account);
        UUID workItemId = workItems.findByInquiryId(inquiryId).orElseThrow().getId();

        InquiryGuidedHandoffView view = service.capability(org, workItemId);
        assertThat(view.eligible()).isFalse();
        assertThat(view.reason()).isEqualTo("NOT_CAFE24_BOARD6");
    }

    @Test
    void notEligibleWhenAChannelReplyAdapterExists() {
        UUID workItemId = openBoard6Inquiry(3677L, cafe24Channel);
        InquiryGuidedHandoffService withAdapter = new InquiryGuidedHandoffService(
                workItems, inquiries, audits,
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeCafe24Adapter())),
                channels, txManager);

        InquiryGuidedHandoffView view = withAdapter.capability(org, workItemId);
        assertThat(view.eligible()).isFalse();
        assertThat(view.reason()).isEqualTo("HAS_REPLY_ADAPTER");
    }

    @Test
    void outcomeToleratedAfterItemAlreadyCompletedByReCollect() {
        UUID workItemId = openBoard6Inquiry(3678L, cafe24Channel);
        InquiryWorkItem wi = workItems.findById(workItemId).orElseThrow();
        wi.setPhase(InquiryWorkItemPhase.COMPLETED);   // re-collect won the race
        workItems.save(wi);

        InquiryGuidedHandoffOutcomeResponse res = service.recordOutcome(
                org, workItemId, "cmd-late", "OPERATOR_REPORTED_SUBMITTED", actor);

        assertThat(res.recorded()).isTrue();
        assertThat(phase(workItemId)).isEqualTo(InquiryWorkItemPhase.COMPLETED);   // unchanged
    }

    /**
     * The crux: a guided handoff (mint + operator self-report) leaves the item OPEN, so the
     * existing connector reconcile still completes it when the answer is later re-collected
     * as 처리완료 — exactly the completion model confirmed for V1.
     */
    @Test
    void guidedHandoffKeepsItemOpenSoConnectorReconcileCompletesOnAnswer() {
        UUID workItemId = openBoard6Inquiry(3679L, cafe24Channel);
        UUID inquiryId = workItems.findById(workItemId).orElseThrow().getInquiryId();

        service.mint(org, workItemId, actor);
        service.recordOutcome(org, workItemId, "cmd-loop", "OPERATOR_REPORTED_SUBMITTED", actor);
        assertThat(phase(workItemId)).isEqualTo(InquiryWorkItemPhase.OPEN);   // still OPEN after handoff

        // Simulate the same-window re-collect seeing reply_status=C → ANSWERED.
        Inquiry answered = inquiries.findById(inquiryId).orElseThrow();
        answered.setStatus("ANSWERED");
        answered.setInformStatus("C");
        writer.reconcileConnectorAnswered(answered);

        assertThat(phase(workItemId)).isEqualTo(InquiryWorkItemPhase.COMPLETED);
    }

    /** Minimal adapter used only to prove the "a reply adapter exists" branch. */
    private static final class FakeCafe24Adapter implements ChannelReplyAdapter {
        @Override public String channelCode() {
            return "CAFE24";
        }

        @Override public ReplyPublishResult publish(ReplyPublishCommand command) {
            throw new UnsupportedOperationException("not exercised");
        }

        @Override public ReplyVerificationResult verify(ReplyVerificationCommand command) {
            throw new UnsupportedOperationException("not exercised");
        }
    }
}
