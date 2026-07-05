package com.sellerops.inquiry.publish;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.publish.dto.PublishStatusView;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Channel-neutral seller-confirmed reply orchestration: confirm &rarr; immutable
 * binding &rarr; (gated) dispatch &rarr; verify by re-query. All channel-specific
 * behavior lives behind a {@link ChannelReplyAdapter}; this service references no
 * channel, provider, token, or status vocabulary — only the neutral {@link
 * ReplyPublishResult}/{@link ReplyVerificationResult} outcomes and the {@link
 * ChannelReplyAdapterRegistry}.
 *
 * <p><b>Safety (channel-neutral).</b> An adapter is resolved by the work item's exact
 * channel; when none is registered — an unsupported channel, or any channel while live
 * execution is disabled — the service <b>fails closed</b> and never dispatches. A
 * dispatch runs only from {@link InquiryExecutionStatus#ACTION_PENDING}, so a replayed
 * confirm never sends twice and nothing resends after a confirmed EXECUTED. An
 * ambiguous publish is {@link InquiryExecutionStatus#DELIVERY_UNKNOWN} — verified by
 * re-query, never blind-resent. Only a neutral provider reference / numeric result code
 * is persisted here; no token or provider free-text message ever reaches this layer.
 */
@Service
public class InquiryPublishService {

    private final InquiryWorkItemRepository workItems;
    private final InquiryReplyDraftRepository drafts;
    private final InquiryRepository inquiries;
    private final InquiryApprovalRepository approvals;
    private final InquiryExecutionRepository executions;
    private final InquiryVerificationRepository verifications;
    private final InquiryWorkItemAuditRepository audits;
    private final InquiryPublishBindingWriter binding;
    private final ChannelReplyAdapterRegistry adapters;

    public InquiryPublishService(InquiryWorkItemRepository workItems, InquiryReplyDraftRepository drafts,
                                 InquiryRepository inquiries, InquiryApprovalRepository approvals,
                                 InquiryExecutionRepository executions, InquiryVerificationRepository verifications,
                                 InquiryWorkItemAuditRepository audits, InquiryPublishBindingWriter binding,
                                 ChannelReplyAdapterRegistry adapters) {
        this.workItems = workItems;
        this.drafts = drafts;
        this.inquiries = inquiries;
        this.approvals = approvals;
        this.executions = executions;
        this.verifications = verifications;
        this.audits = audits;
        this.binding = binding;
        this.adapters = adapters;
    }

    /** Confirm the exact draft version, bind immutably, create the intent, and (if a channel adapter exists) dispatch. */
    public PublishStatusView confirmAndPublish(UUID orgId, UUID workItemId, UUID sellerUserId,
                                               String commandId, String expectedFingerprint) {
        if (commandId == null || commandId.isBlank()) {
            throw ApiException.badRequest("commandId가 필요합니다.");
        }
        if (expectedFingerprint == null || expectedFingerprint.isBlank()) {
            throw ApiException.badRequest("expectedFingerprint가 필요합니다.");
        }
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);

        Optional<InquiryApproval> existing = approvals.findByWorkItemId(workItemId);
        if (existing.isPresent()) {
            InquiryApproval approval = existing.get();
            boolean replay = approval.getCommandId().equals(commandId)
                    && approval.getApprovedFingerprint().equals(expectedFingerprint);
            if (!replay) {
                throw ApiException.conflict("이미 확정된 문의입니다. (명령/지문 불일치)");
            }
            // Idempotent replay: re-attempt only the (gated) dispatch — never re-bind.
        } else {
            if (workItem.getPhase() != InquiryWorkItemPhase.PROPOSED) {
                throw ApiException.conflict("PROPOSED 상태의 문의만 확정할 수 있습니다.");
            }
            InquiryReplyDraft head = drafts.findTopByWorkItemIdOrderByVersionDesc(workItemId)
                    .orElseThrow(() -> ApiException.badRequest("확정할 답변 초안이 없습니다."));
            if (!head.getContentFingerprint().equals(expectedFingerprint)) {
                throw ApiException.conflict("초안이 변경되었습니다. 최신 초안을 확인하세요.");
            }
            binding.bind(workItem, head, commandId, "SELLER:" + sellerUserId);
            workItem = loadWorkItem(orgId, workItemId); // reload with ACTION_PENDING phase
        }

        PublishOutcomeCategory transientCategory = maybeDispatch(orgId, workItem);
        return statusView(loadWorkItem(orgId, workItemId), transientCategory);
    }

    /** Verify-only: re-query the channel result and advance to COMPLETED when confirmed. Never resends. */
    public PublishStatusView verify(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        InquiryExecution execution = executions.findByWorkItemId(workItemId).orElse(null);
        if (execution != null && (execution.getStatus() == InquiryExecutionStatus.EXECUTED
                || execution.getStatus() == InquiryExecutionStatus.DELIVERY_UNKNOWN)) {
            Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
            runVerify(workItem, inquiry, execution);
        }
        return statusView(loadWorkItem(orgId, workItemId), null);
    }

    /**
     * Resume/recover an already-bound publish. A seller retry dispatches ONLY from
     * ACTION_PENDING; an abandoned DISPATCHING is first reclassified to
     * DELIVERY_UNKNOWN (never resend on a crash/timeout); EXECUTED / DELIVERY_UNKNOWN
     * verify by re-query; COMPLETED / FAILED are no-op replays.
     */
    public PublishStatusView resume(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        InquiryExecution execution = executions.findByWorkItemId(workItemId).orElse(null);
        if (execution == null) {
            return statusView(workItem, null); // not yet confirmed — nothing to resume
        }
        PublishOutcomeCategory transientCategory = null;
        switch (execution.getStatus()) {
            case DISPATCHING -> {
                // Abandoned mid-publish: treat as delivery-unknown, then verify — never resend.
                execution.setStatus(InquiryExecutionStatus.DELIVERY_UNKNOWN);
                executions.save(execution);
                runVerify(workItem, loadInquiry(orgId, workItem.getInquiryId()), execution);
            }
            case ACTION_PENDING -> transientCategory = maybeDispatch(orgId, workItem);
            case EXECUTED, DELIVERY_UNKNOWN ->
                    runVerify(workItem, loadInquiry(orgId, workItem.getInquiryId()), execution);
            case COMPLETED, FAILED -> { /* terminal — no-op replay */ }
        }
        return statusView(loadWorkItem(orgId, workItemId), transientCategory);
    }

    /**
     * Startup recovery: reclassify every abandoned DISPATCHING execution to
     * DELIVERY_UNKNOWN (reclassify only — no resend, no verify here). Returns the count.
     */
    public int recoverAbandonedDispatching() {
        List<InquiryExecution> stuck = executions.findAllByStatus(InquiryExecutionStatus.DISPATCHING);
        for (InquiryExecution execution : stuck) {
            execution.setStatus(InquiryExecutionStatus.DELIVERY_UNKNOWN);
            executions.save(execution);
        }
        return stuck.size();
    }

    /** Dispatch only from ACTION_PENDING and only when a channel adapter is registered (fail closed otherwise). */
    private PublishOutcomeCategory maybeDispatch(UUID orgId, InquiryWorkItem workItem) {
        InquiryExecution execution = executions.findByWorkItemId(workItem.getId()).orElse(null);
        if (execution == null || execution.getStatus() != InquiryExecutionStatus.ACTION_PENDING) {
            return null; // nothing pending, or already dispatched — never resend
        }
        Optional<ChannelReplyAdapter> adapter = adapters.resolve(workItem.getChannelId());
        if (adapter.isEmpty()) {
            return null; // fail closed: no reply adapter for this channel — stays ACTION_PENDING
        }
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        String externalId = inquiry.getExternalId();
        if (externalId == null || externalId.isBlank()) {
            return PublishOutcomeCategory.RETRYABLE_FAILURE; // no external reply target
        }
        InquiryApproval approval = approvals.findByWorkItemId(workItem.getId()).orElseThrow();
        InquiryReplyDraft approved = drafts.findByWorkItemIdAndVersion(
                workItem.getId(), approval.getApprovedDraftVersion()).orElseThrow();
        // Defense: publish exactly the approved payload.
        if (!approved.getContentFingerprint().equals(approval.getApprovedFingerprint())) {
            return PublishOutcomeCategory.RETRYABLE_FAILURE;
        }

        execution.setStatus(InquiryExecutionStatus.DISPATCHING);
        executions.save(execution);

        ReplyPublishResult result = adapter.get().publish(new ReplyPublishCommand(
                orgId, workItem.getSellerAccountId(), workItem.getChannelId(),
                externalId, inquiry.getReceivedAt(), approved.getTitle(), approved.getComments()));

        PublishOutcomeCategory transientCategory = null;
        switch (result.kind()) {
            case CONFIRMED -> {
                execution.setStatus(InquiryExecutionStatus.EXECUTED);
                execution.setProviderMessageNo(result.providerRef());
                executions.save(execution);
                setPhase(workItem, InquiryWorkItemPhase.EXECUTED);
                audit(orgId, workItem.getId(), "execute:" + workItem.getId(),
                        InquiryWorkItemEvent.EXECUTION_RECORDED,
                        InquiryWorkItemPhase.ACTION_PENDING, InquiryWorkItemPhase.EXECUTED);
                runVerify(workItem, inquiry, execution);
            }
            case PERMANENT_FAILURE -> {
                execution.setStatus(InquiryExecutionStatus.FAILED);
                execution.setFailureReason("EXECUTION_FAILED");
                execution.setResultCode(result.resultCode());
                executions.save(execution);
                setPhase(workItem, InquiryWorkItemPhase.FAILED);
                audit(orgId, workItem.getId(), "execute:" + workItem.getId(),
                        InquiryWorkItemEvent.EXECUTION_RECORDED,
                        InquiryWorkItemPhase.ACTION_PENDING, InquiryWorkItemPhase.FAILED);
            }
            case DELIVERY_UNKNOWN -> {
                execution.setStatus(InquiryExecutionStatus.DELIVERY_UNKNOWN);
                executions.save(execution);
                audit(orgId, workItem.getId(), "execute:" + workItem.getId(),
                        InquiryWorkItemEvent.EXECUTION_RECORDED,
                        InquiryWorkItemPhase.ACTION_PENDING, InquiryWorkItemPhase.ACTION_PENDING);
                // Never resend; the caller/frontend must verify first.
            }
            case RETRYABLE_FAILURE -> {
                // Nothing was sent — revert to ACTION_PENDING; retryable.
                execution.setStatus(InquiryExecutionStatus.ACTION_PENDING);
                executions.save(execution);
                transientCategory = PublishOutcomeCategory.RETRYABLE_FAILURE;
            }
        }
        return transientCategory;
    }

    /** Re-query the channel result and record a verification attempt; COMPLETED only when the adapter confirms. */
    private void runVerify(InquiryWorkItem workItem, Inquiry inquiry, InquiryExecution execution) {
        Optional<ChannelReplyAdapter> adapter = adapters.resolve(workItem.getChannelId());
        if (adapter.isEmpty()) {
            return; // fail closed: no adapter to verify with — leave state unchanged
        }
        ReplyVerificationResult result = adapter.get().verify(new ReplyVerificationCommand(
                workItem.getOrgId(), workItem.getSellerAccountId(), workItem.getChannelId(),
                inquiry.getExternalId(), inquiry.getReceivedAt()));
        boolean verified = result.kind() == ReplyVerificationResult.Kind.COMPLETED;

        InquiryVerification v = new InquiryVerification();
        v.setOrgId(workItem.getOrgId());
        v.setWorkItemId(workItem.getId());
        v.setExecutionId(execution.getId());
        v.setVerified(verified);
        v.setObservedStatus(result.observedSignal());
        verifications.save(v);

        execution.setVerifyAttempts(execution.getVerifyAttempts() + 1);
        InquiryWorkItemPhase from = fromPhase(execution.getStatus());
        if (verified) {
            execution.setStatus(InquiryExecutionStatus.COMPLETED);
            setPhase(workItem, InquiryWorkItemPhase.COMPLETED);
        }
        executions.save(execution);
        audit(workItem.getOrgId(), workItem.getId(),
                "verify:" + workItem.getId() + ":" + execution.getVerifyAttempts(),
                InquiryWorkItemEvent.VERIFICATION_RECORDED, from,
                verified ? InquiryWorkItemPhase.COMPLETED : from);
    }

    private static InquiryWorkItemPhase fromPhase(InquiryExecutionStatus status) {
        return status == InquiryExecutionStatus.EXECUTED
                ? InquiryWorkItemPhase.EXECUTED : InquiryWorkItemPhase.ACTION_PENDING;
    }

    private void setPhase(InquiryWorkItem workItem, InquiryWorkItemPhase phase) {
        workItem.setPhase(phase);
        workItems.save(workItem);
    }

    private void audit(UUID orgId, UUID workItemId, String commandId, InquiryWorkItemEvent event,
                       InquiryWorkItemPhase from, InquiryWorkItemPhase to) {
        InquiryWorkItemAudit a = new InquiryWorkItemAudit();
        a.setOrgId(orgId);
        a.setWorkItemId(workItemId);
        a.setCommandId(commandId);
        a.setEventType(event);
        a.setPhaseFrom(from);
        a.setPhaseTo(to);
        a.setActor("SYSTEM:PUBLISH");
        audits.save(a);
    }

    private PublishStatusView statusView(InquiryWorkItem workItem, PublishOutcomeCategory transientCategory) {
        InquiryExecution execution = executions.findByWorkItemId(workItem.getId()).orElse(null);
        InquiryApproval approval = approvals.findByWorkItemId(workItem.getId()).orElse(null);
        InquiryExecutionStatus status = execution == null ? null : execution.getStatus();
        PublishOutcomeCategory category = transientCategory != null ? transientCategory
                : (status == null ? PublishOutcomeCategory.PENDING : categoryFor(execution));
        return new PublishStatusView(
                workItem.getId().toString(),
                workItem.getPhase().name(),
                status == null ? null : status.name(),
                category,
                approval == null ? null : approval.getApprovedDraftVersion(),
                approval == null ? null : approval.getApprovedFingerprint(),
                execution == null ? null : execution.getProviderMessageNo(),
                execution == null ? null : execution.getResultCode());
    }

    private static PublishOutcomeCategory categoryFor(InquiryExecution execution) {
        if (execution.getStatus() == InquiryExecutionStatus.FAILED) {
            return PublishOutcomeCategory.PERMANENT_FAILURE;
        }
        return PublishOutcomeCategory.fromStatus(execution.getStatus());
    }

    private InquiryWorkItem loadWorkItem(UUID orgId, UUID workItemId) {
        return workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
    }

    private Inquiry loadInquiry(UUID orgId, UUID inquiryId) {
        return inquiries.findById(inquiryId)
                .filter(i -> i.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의를 찾을 수 없습니다."));
    }
}
