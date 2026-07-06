package com.sellerops.inquiry.esmimport;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Reconciles an already-present inquiry against a later ESM export: when an inquiry that
 * was imported UNANSWERED is now reported ANSWERED, it is flipped to ANSWERED and its
 * OPEN work item completed. Terminal work items (COMPLETED/DISMISSED) and any non-OPEN
 * (mid-workflow) phase are never touched, so an operator's spam dismissal or in-flight
 * reply is never overridden; a later UNANSWERED export never downgrades or reopens.
 *
 * <p><b>Idempotency:</b> the OPEN→COMPLETED transition is one-way and the audit is
 * keyed {@code esm-reconcile:<workItemId>} (unique per work item), so replaying the same
 * file — or a later file repeating the answered state — records no second transition.
 */
@Component
@ConditionalOnProperty(name = "sellerops.inquiry-import.esm.enabled", havingValue = "true")
public class EsmInquiryReconciler {

    static final String ACTOR = "SYSTEM:ESM_FILE_IMPORT";
    private static final String ANSWERED = "ANSWERED";

    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final InquiryWorkItemAuditRepository audits;
    private final TransactionTemplate tx;

    public EsmInquiryReconciler(InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                InquiryWorkItemAuditRepository audits,
                                PlatformTransactionManager transactionManager) {
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.audits = audits;
        this.tx = new TransactionTemplate(transactionManager);
    }

    /**
     * Pure decision (no writes) shared by preview counts and the confirm plan: what to do
     * with an <b>existing</b> inquiry given its current status, its work-item phase (null
     * if none), and the imported status.
     */
    public static EsmRowDisposition decide(String existingStatus, InquiryWorkItemPhase phase,
                                           String importedStatus) {
        if (!ANSWERED.equals(importedStatus)) {
            return EsmRowDisposition.UNCHANGED_DUPLICATE;   // no downgrade / no reopen
        }
        if (ANSWERED.equals(existingStatus)) {
            return EsmRowDisposition.UNCHANGED_DUPLICATE;   // already answered
        }
        // Existing UNANSWERED, imported ANSWERED: reconcile only when the work item is
        // absent or still OPEN. Terminal or mid-workflow phases are left untouched.
        if (phase == null || phase == InquiryWorkItemPhase.OPEN) {
            return EsmRowDisposition.STATUS_UPDATE;
        }
        return EsmRowDisposition.UNCHANGED_DUPLICATE;
    }

    /**
     * Apply a reconciliation for one existing inquiry, atomically. Re-checks state inside
     * the transaction so a concurrent change or a replay is a safe no-op. Returns true iff
     * a status update was actually applied.
     */
    public boolean reconcileAnswered(UUID inquiryId, UUID importBatchId) {
        Boolean updated = tx.execute(status -> {
            Inquiry inquiry = inquiries.findById(inquiryId).orElse(null);
            if (inquiry == null || ANSWERED.equals(inquiry.getStatus())) {
                return false;
            }
            Optional<InquiryWorkItem> wiOpt = workItems.findByInquiryId(inquiryId);
            if (wiOpt.isEmpty()) {
                inquiry.setStatus(ANSWERED);
                inquiries.save(inquiry);
                return true;
            }
            InquiryWorkItem workItem = wiOpt.get();
            if (workItem.getPhase() != InquiryWorkItemPhase.OPEN) {
                return false;   // terminal or mid-workflow — never touched
            }
            inquiry.setStatus(ANSWERED);
            inquiries.save(inquiry);
            workItem.setPhase(InquiryWorkItemPhase.COMPLETED);
            workItems.save(workItem);

            String commandId = "esm-reconcile:" + workItem.getId();
            if (!audits.existsByWorkItemIdAndCommandId(workItem.getId(), commandId)) {
                InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
                audit.setOrgId(inquiry.getOrgId());
                audit.setWorkItemId(workItem.getId());
                audit.setCommandId(commandId);
                audit.setEventType(InquiryWorkItemEvent.VERIFICATION_RECORDED);
                audit.setPhaseFrom(InquiryWorkItemPhase.OPEN);
                audit.setPhaseTo(InquiryWorkItemPhase.COMPLETED);
                audit.setActor(ACTOR);
                audit.setImportBatchId(importBatchId);
                audits.save(audit);
            }
            return true;
        });
        return Boolean.TRUE.equals(updated);
    }
}
