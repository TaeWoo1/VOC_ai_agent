package com.sellerops.inquiry.publish;

import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Atomically binds an approval to one draft version and creates the publish intent +
 * a pre-dispatch execution, moving the work item PROPOSED &rarr; ACTION_PENDING. All
 * five writes (approval, intent, execution, phase flip, two audits) commit or roll
 * back together — so a work item can never be left ACTION_PENDING without its
 * immutable binding, nor an intent exist without its approval. Once the phase leaves
 * PROPOSED the draft is frozen (the draft service gates edits on PROPOSED).
 *
 * <p>Uses an explicit {@link TransactionTemplate} (not a proxy) so the guarantee
 * holds whether Spring-wired or hand-constructed in a test.
 */
@Component
public class InquiryPublishBindingWriter {

    static final String ACTION_KIND = "POST_INQUIRY_REPLY";

    private final InquiryWorkItemRepository workItems;
    private final InquiryApprovalRepository approvals;
    private final InquiryActionIntentRepository intents;
    private final InquiryExecutionRepository executions;
    private final InquiryWorkItemAuditRepository audits;
    private final TransactionTemplate tx;

    public InquiryPublishBindingWriter(InquiryWorkItemRepository workItems,
                                       InquiryApprovalRepository approvals,
                                       InquiryActionIntentRepository intents,
                                       InquiryExecutionRepository executions,
                                       InquiryWorkItemAuditRepository audits,
                                       PlatformTransactionManager transactionManager) {
        this.workItems = workItems;
        this.approvals = approvals;
        this.intents = intents;
        this.executions = executions;
        this.audits = audits;
        this.tx = new TransactionTemplate(transactionManager);
    }

    /** The single-dispatch key = SHA-256(workItemId + ":" + approvedFingerprint). */
    public static String dispatchKey(UUID workItemId, String approvedFingerprint) {
        return sha256Hex(workItemId + ":" + approvedFingerprint);
    }

    /** Bind the approval to {@code approvedDraft} and create the intent + pending execution. */
    public InquiryExecution bind(InquiryWorkItem workItem, InquiryReplyDraft approvedDraft,
                                 String commandId, String actor) {
        return tx.execute(status -> {
            UUID workItemId = workItem.getId();
            UUID orgId = workItem.getOrgId();
            String fingerprint = approvedDraft.getContentFingerprint();

            InquiryApproval approval = new InquiryApproval();
            approval.setOrgId(orgId);
            approval.setWorkItemId(workItemId);
            approval.setApprovedDraftVersion(approvedDraft.getVersion());
            approval.setApprovedFingerprint(fingerprint);
            approval.setCommandId(commandId);
            approval.setApprover(actor);
            approvals.save(approval);

            InquiryActionIntent intent = new InquiryActionIntent();
            intent.setOrgId(orgId);
            intent.setWorkItemId(workItemId);
            intent.setApprovedFingerprint(fingerprint);
            intent.setActionKind(ACTION_KIND);
            InquiryActionIntent savedIntent = intents.save(intent);

            InquiryExecution execution = new InquiryExecution();
            execution.setOrgId(orgId);
            execution.setWorkItemId(workItemId);
            execution.setActionIntentId(savedIntent.getId());
            execution.setDispatchKey(dispatchKey(workItemId, fingerprint));
            execution.setStatus(InquiryExecutionStatus.ACTION_PENDING);
            execution.setVerifyAttempts(0);
            InquiryExecution savedExecution = executions.save(execution);

            workItem.setPhase(InquiryWorkItemPhase.ACTION_PENDING);
            workItems.save(workItem);

            audit(orgId, workItemId, commandId, InquiryWorkItemEvent.APPROVAL_GRANTED,
                    InquiryWorkItemPhase.PROPOSED, InquiryWorkItemPhase.APPROVED, actor);
            audit(orgId, workItemId, "intent:" + workItemId, InquiryWorkItemEvent.ACTION_INTENT_CREATED,
                    InquiryWorkItemPhase.APPROVED, InquiryWorkItemPhase.ACTION_PENDING, actor);

            return savedExecution;
        });
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

    static String sha256Hex(String input) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("dispatch key 생성 실패");
        }
    }
}
