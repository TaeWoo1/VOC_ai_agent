package com.sellerops.inquiry.publish;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.DataOrigin;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.publish.dto.PublishStatusView;
import com.sellerops.inquiry.memory.InquiryAnswerMemoryHook;
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
    private final InquiryTargetStateReader targetState;
    private final InquiryReplyCapabilityRegistry capabilities;
    private final ChannelRepository channels;
    private final InquiryAnswerMemoryHook answerMemory;

    @org.springframework.beans.factory.annotation.Autowired
    public InquiryPublishService(InquiryWorkItemRepository workItems, InquiryReplyDraftRepository drafts,
                                 InquiryRepository inquiries, InquiryApprovalRepository approvals,
                                 InquiryExecutionRepository executions, InquiryVerificationRepository verifications,
                                 InquiryWorkItemAuditRepository audits, InquiryPublishBindingWriter binding,
                                 ChannelReplyAdapterRegistry adapters, InquiryTargetStateReader targetState,
                                 InquiryReplyCapabilityRegistry capabilities, ChannelRepository channels,
                                 InquiryAnswerMemoryHook answerMemory) {
        this.workItems = workItems;
        this.drafts = drafts;
        this.inquiries = inquiries;
        this.approvals = approvals;
        this.executions = executions;
        this.verifications = verifications;
        this.audits = audits;
        this.binding = binding;
        this.adapters = adapters;
        this.targetState = targetState;
        this.capabilities = capabilities;
        this.channels = channels;
        this.answerMemory = answerMemory;
    }

    /**
     * Wiring for tests that exercise publish alone. Answer memory is an effect of publishing, not a
     * participant in it: nothing here reads it back, so its absence cannot change an outcome.
     */
    public InquiryPublishService(InquiryWorkItemRepository workItems, InquiryReplyDraftRepository drafts,
                                 InquiryRepository inquiries, InquiryApprovalRepository approvals,
                                 InquiryExecutionRepository executions, InquiryVerificationRepository verifications,
                                 InquiryWorkItemAuditRepository audits, InquiryPublishBindingWriter binding,
                                 ChannelReplyAdapterRegistry adapters, InquiryTargetStateReader targetState,
                                 InquiryReplyCapabilityRegistry capabilities, ChannelRepository channels) {
        this(workItems, drafts, inquiries, approvals, executions, verifications, audits, binding,
                adapters, targetState, capabilities, channels, null);
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
            Inquiry target = loadInquiry(orgId, workItem.getInquiryId());
            if (target.getExternalId() == null || target.getExternalId().isBlank()) {
                // Nothing to bind an approval TO. Refuse at approval time rather than accepting a
                // confirmation the dispatch could only fail on.
                throw ApiException.badRequest("이 문의에는 채널이 알아볼 수 있는 식별자가 없어 답변을 등록할 수 없습니다.");
            }
            binding.bind(workItem, head,
                    new InquiryPublishBindingWriter.ApprovalTarget(
                            workItem.getSellerAccountId(), workItem.getChannelId(),
                            target.getExternalId(), target.getSourceSubtype()),
                    commandId, "SELLER:" + sellerUserId);
            // The approval is the seller stating what this company says. Recorded AFTER the binding,
            // so a refused approval never leaves a memory of an answer nobody approved.
            if (answerMemory != null) {
                answerMemory.rememberApproved(target, head, sellerUserId);
            }
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
     * Re-arm a refused attempt after the REQUEST CONTRACT was corrected — the one way out of
     * {@code FAILED}, and never an automatic one.
     *
     * <p><b>What this does not redefine.</b> {@code PERMANENT_FAILURE} still means "resending THIS
     * body would be refused again". It never meant "this inquiry can never be answered": when the
     * provider created nothing and the request that was refused has actually been fixed, the only
     * honest reading is that attempt 1 is over and a corrected attempt 2 may be armed by a person.
     * Nothing here sends; it restores the projection to {@code ACTION_PENDING} and stops.
     *
     * <p><b>The refused attempt is written down before it is overwritten.</b> There is one execution
     * row per work item, so re-arming it clears the very fields that hold the refusal. The audit
     * entry goes first and carries them — status, HTTP code, and the fact that no article was
     * created — together with the correction that justifies the re-arm. If that write fails, nothing
     * is cleared.
     *
     * <p><b>The approval is re-checked, not re-bound.</b> Same org, account, channel, target and
     * subtype, and the same draft still at HEAD with the same fingerprint. A single difference
     * refuses: an approval is a statement about a moment, and a corrected request is not permission
     * to send something else.
     *
     * @param correctionRef what was corrected (e.g. a commit) — recorded, never interpreted
     */
    public PublishStatusView rearmAfterRequestCorrection(UUID orgId, UUID workItemId,
                                                        UUID sellerUserId, String correctionRef) {
        if (correctionRef == null || correctionRef.isBlank()) {
            throw ApiException.badRequest("무엇을 고쳤는지(correctionRef)가 필요합니다.");
        }
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        if (workItem.getPhase() != InquiryWorkItemPhase.FAILED) {
            throw ApiException.conflict("실패한 전송만 다시 준비할 수 있습니다.");
        }
        InquiryExecution execution = executions.findByWorkItemId(workItemId)
                .orElseThrow(() -> ApiException.conflict("다시 준비할 실행 기록이 없습니다."));
        if (execution.getStatus() != InquiryExecutionStatus.FAILED) {
            throw ApiException.conflict("실패한 전송만 다시 준비할 수 있습니다.");
        }
        // The interlock that makes this safe at all. A provider reference means something may exist
        // over there, and re-arming would invite a SECOND answer under a customer's question.
        if (execution.getProviderMessageNo() != null && !execution.getProviderMessageNo().isBlank()) {
            throw ApiException.conflict("채널에 무언가 생성됐을 수 있어 다시 준비할 수 없습니다.");
        }
        InquiryApproval approval = approvals.findByWorkItemId(workItemId)
                .orElseThrow(() -> ApiException.conflict("승인이 없어 다시 준비할 수 없습니다."));
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        PreSendCheck check = revalidate(orgId, workItem, approval, inquiry);
        if (check.refused()) {
            throw ApiException.conflict("승인 당시와 달라져 다시 준비할 수 없습니다. (" + check.reason() + ")");
        }
        InquiryReplyDraft head = drafts.findTopByWorkItemIdOrderByVersionDesc(workItemId)
                .orElseThrow(() -> ApiException.conflict("초안이 없습니다."));
        if (head.getVersion() != approval.getApprovedDraftVersion()
                || !head.getContentFingerprint().equals(approval.getApprovedFingerprint())) {
            throw ApiException.conflict("승인된 초안이 더 이상 최신이 아닙니다.");
        }

        // Written BEFORE the projection is reset — the refused attempt survives the row that held it.
        audit(orgId, workItemId, rearmCommandId(execution, correctionRef),
                InquiryWorkItemEvent.EXECUTION_REARMED,
                InquiryWorkItemPhase.FAILED, InquiryWorkItemPhase.ACTION_PENDING,
                "SELLER:" + sellerUserId);

        execution.setStatus(InquiryExecutionStatus.ACTION_PENDING);
        execution.setFailureReason(null);
        execution.setResultCode(null);
        execution.setProviderMessageNo(null);
        execution.setPresendStateProven(null);
        execution.setPresendNote(null);
        executions.save(execution);
        setPhase(workItem, InquiryWorkItemPhase.ACTION_PENDING);
        return statusView(loadWorkItem(orgId, workItemId), null);
    }

    /**
     * The refused attempt, compressed into the audit row's command id — the only free-text field the
     * audit table has, and enough to read the history in order: what attempt 1 got, that it created
     * nothing, and what was corrected before attempt 2 was armed.
     */
    private static String rearmCommandId(InquiryExecution execution, String correctionRef) {
        String code = execution.getResultCode() == null ? "-" : String.valueOf(execution.getResultCode());
        String reason = execution.getFailureReason() == null ? "-" : execution.getFailureReason();
        String id = "rearm:" + reason + "/" + code + "/created0:fix=" + correctionRef.strip();
        return id.length() > 120 ? id.substring(0, 120) : id;
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

        // The last gate before the only marketplace WRITE in the product: is this still the target
        // that was approved, and is it still answerable? A contradiction is permanent — re-approving
        // is the remedy, not retrying — so it fails the execution rather than leaving it pending.
        // Revalidation runs BEFORE the adapter is chosen, and the order is the point. A contradiction
        // between the approval and the row — a moved account, a different source resource — is true
        // whether or not a transport exists for it. Resolving the adapter first would have let the
        // most alarming case exit quietly: an inquiry whose subtype changed after approval resolves to
        // NO adapter, so the dispatch would return "nothing to do" and leave the work item pending
        // forever, retrying an approval that can never be spent, with nothing recorded about why.
        PreSendCheck check = revalidate(orgId, workItem, approval, inquiry);
        if (check.refused()) {
            execution.setStatus(InquiryExecutionStatus.FAILED);
            execution.setFailureReason(check.reason());
            execution.setPresendStateProven(false);
            execution.setPresendNote(check.reason());
            executions.save(execution);
            setPhase(workItem, InquiryWorkItemPhase.FAILED);
            audit(orgId, workItem.getId(), "presend:" + workItem.getId(),
                    InquiryWorkItemEvent.EXECUTION_RECORDED,
                    InquiryWorkItemPhase.ACTION_PENDING, InquiryWorkItemPhase.FAILED);
            return PublishOutcomeCategory.PERMANENT_FAILURE;
        }
        // Nothing contradicts the approval. Only now does the transport matter: no adapter for this
        // channel+subtype means live execution is off or none is implemented, and the work item waits
        // rather than failing — that absence is a deployment fact, not a contradiction.
        Optional<ChannelReplyAdapter> adapter =
                adapters.resolve(workItem.getChannelId(), inquiry.getSourceSubtype());
        if (adapter.isEmpty()) {
            return null; // fail closed: stays ACTION_PENDING
        }

        // Not a refusal — a recorded ignorance. See PreSendCheck.
        execution.setPresendStateProven(check.stateProven());
        execution.setPresendNote(check.note());

        execution.setStatus(InquiryExecutionStatus.DISPATCHING);
        executions.save(execution);

        ReplyPublishResult result = adapter.get().publish(new ReplyPublishCommand(
                orgId, workItem.getSellerAccountId(), workItem.getChannelId(),
                externalId, inquiry.getReceivedAt(), approved.getTitle(), approved.getComments(),
                inquiry.getTitle()));

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

    /**
     * Compare the approval against the world as it is now.
     *
     * <p>Five identity comparisons and one answerability comparison. The identity side is
     * deliberately literal — {@link java.util.Objects#equals} on each snapshotted value — because the
     * point is to catch the case where something moved, and a clever comparison that tolerated a
     * difference would defeat it. {@code sourceSubtype} is compared as a value including null: a
     * channel with one source resource legitimately has none, so null must equal null and must not
     * act as a wildcard that lets a NAVER 상품 문의 approval be spent on a 고객 문의.
     *
     * <p>An approval with no snapshot at all (written before V66) cannot be checked, and an
     * un-checkable approval is refused rather than trusted.
     */
    private PreSendCheck revalidate(UUID orgId, InquiryWorkItem workItem, InquiryApproval approval,
                                    Inquiry inquiry) {
        if (approval.getTargetExternalId() == null || approval.getChannelId() == null) {
            return PreSendCheck.refuse(PreSendCheck.NO_TARGET_SNAPSHOT);
        }
        if (!java.util.Objects.equals(approval.getSellerAccountId(), workItem.getSellerAccountId())) {
            return PreSendCheck.refuse(PreSendCheck.ACCOUNT_CHANGED);
        }
        if (!java.util.Objects.equals(approval.getChannelId(), workItem.getChannelId())) {
            return PreSendCheck.refuse(PreSendCheck.CHANNEL_CHANGED);
        }
        if (!approval.getTargetExternalId().equals(inquiry.getExternalId())) {
            return PreSendCheck.refuse(PreSendCheck.TARGET_CHANGED);
        }
        if (!java.util.Objects.equals(approval.getSourceSubtype(), inquiry.getSourceSubtype())) {
            return PreSendCheck.refuse(PreSendCheck.SUBTYPE_CHANGED);
        }
        // Already answered — on the marketplace, by anyone. A second answer is not a retry.
        if (inquiry.getAnsweredAt() != null
                || (inquiry.getAnswerBody() != null && !inquiry.getAnswerBody().isBlank())) {
            return PreSendCheck.refuse(PreSendCheck.ALREADY_ANSWERED);
        }
        if (inquiry.getOperationalState() != null
                && inquiry.getOperationalState() != InquiryOperationalState.ACTIVE) {
            return PreSendCheck.refuse(PreSendCheck.NOT_ANSWERABLE);
        }
        // Provenance, checked against the ROW rather than against how it was found. The queue that
        // produced this work item already excludes synthetic rows, but an approval outlives the read
        // that created it and this is the last gate before an irreversible write.
        if (inquiry.getDataOrigin() != DataOrigin.REAL) {
            return PreSendCheck.refuse(PreSendCheck.SYNTHETIC_TARGET);
        }
        // Capability, per exact source subtype. The two NAVER resources have different identifier
        // spaces and different endpoints, so "NAVER can be answered" is not a sentence this product
        // is allowed to form — only "this subtype can be".
        if (!capabilities.isImplemented(channelCode(workItem.getChannelId()), inquiry.getSourceSubtype())) {
            return PreSendCheck.refuse(PreSendCheck.WRITE_NOT_SUPPORTED);
        }
        // Everything the approval asserted still holds. What remains is whether the answer state we
        // just read is CURRENT — which is a property of the channel, not of this row.
        PreSendCheck state = targetState.read(orgId, workItem.getChannelId());
        // Unproven is normally a warning the human accepts before pressing, not a veto. It is a veto
        // on a channel whose write REPLACES an existing answer rather than refusing beside it: there,
        // sending on a stale reading can delete a person's own words instead of duplicating ours.
        if (!state.stateProven()
                && capabilities.overwritesExistingAnswer(
                        channelCode(workItem.getChannelId()), inquiry.getSourceSubtype())) {
            return PreSendCheck.refuse(PreSendCheck.OVERWRITE_WITHOUT_PROOF);
        }
        return state;
    }

    /** The channel's stable code, or null when the channel row is gone (which reads as unsupported). */
    private String channelCode(UUID channelId) {
        return channelId == null ? null
                : channels.findById(channelId).map(Channel::getCode).orElse(null);
    }

    /** Re-query the channel result and record a verification attempt; COMPLETED only when the adapter confirms. */
    private void runVerify(InquiryWorkItem workItem, Inquiry inquiry, InquiryExecution execution) {
        Optional<ChannelReplyAdapter> adapter = adapters.resolve(workItem.getChannelId(), inquiry.getSourceSubtype());
        if (adapter.isEmpty()) {
            return; // fail closed: no adapter to verify with — leave state unchanged
        }
        // The approved text travels with the verification, because on a board channel the only proof
        // that OUR answer is there is the answer itself. Absent an approval (there always is one by
        // this point) the adapter simply falls back to whatever state the channel reports.
        String approvedBody = approvals.findByWorkItemId(workItem.getId())
                .flatMap(a -> drafts.findByWorkItemIdAndVersion(workItem.getId(), a.getApprovedDraftVersion()))
                .map(InquiryReplyDraft::getComments)
                .orElse(null);
        ReplyVerificationResult result = adapter.get().verify(new ReplyVerificationCommand(
                workItem.getOrgId(), workItem.getSellerAccountId(), workItem.getChannelId(),
                inquiry.getExternalId(), inquiry.getReceivedAt(),
                approvedBody, execution.getProviderMessageNo()));
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
            // Only here. A dispatch whose delivery is unknown is not a sent answer, and remembering
            // it as one would put text the customer may never have received into the precedent the
            // next draft is written from.
            rememberVerified(workItem);
        }
        executions.save(execution);
        audit(workItem.getOrgId(), workItem.getId(),
                "verify:" + workItem.getId() + ":" + execution.getVerifyAttempts(),
                InquiryWorkItemEvent.VERIFICATION_RECORDED, from,
                verified ? InquiryWorkItemPhase.COMPLETED : from);
    }

    /**
     * Record the verified answer, from the approval that produced it.
     *
     * <p>Reads the approved version rather than the head draft: the head may have moved on since the
     * send, and what the customer received is what was approved.
     */
    private void rememberVerified(InquiryWorkItem workItem) {
        if (answerMemory == null) {
            return;
        }
        approvals.findByWorkItemId(workItem.getId()).ifPresent(approval ->
                drafts.findByWorkItemIdAndVersion(workItem.getId(), approval.getApprovedDraftVersion())
                        .ifPresent(sent -> inquiries.findById(workItem.getInquiryId())
                                .ifPresent(inquiry -> answerMemory.rememberVerified(
                                        inquiry, sent, approverUserId(approval)))));
    }

    /**
     * The user id inside an approver marker like {@code SELLER:<uuid>}, or null.
     *
     * <p>The column is a free-form actor string because approvals can come from actors that are not
     * users; this reads the one shape that is a user and does not guess at the rest.
     */
    private static UUID approverUserId(InquiryApproval approval) {
        String approver = approval.getApprover();
        if (approver == null || !approver.startsWith("SELLER:")) {
            return null;
        }
        try {
            return UUID.fromString(approver.substring("SELLER:".length()));
        } catch (IllegalArgumentException e) {
            return null;
        }
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
        audit(orgId, workItemId, commandId, event, from, to, "SYSTEM:PUBLISH");
    }

    private void audit(UUID orgId, UUID workItemId, String commandId, InquiryWorkItemEvent event,
                       InquiryWorkItemPhase from, InquiryWorkItemPhase to, String actor) {
        InquiryWorkItemAudit a = new InquiryWorkItemAudit();
        a.setOrgId(orgId);
        a.setWorkItemId(workItemId);
        a.setCommandId(commandId);
        a.setEventType(event);
        a.setPhaseFrom(from);
        a.setPhaseTo(to);
        a.setActor(actor);
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
                execution == null ? null : execution.getResultCode(),
                execution == null ? null : execution.getPresendStateProven(),
                execution == null ? null : execution.getPresendNote());
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
