package com.sellerops.inquiry.workitem;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes a new connector inquiry as one atomic unit: the {@link Inquiry}, exactly
 * one {@link InquiryWorkItem} in the {@link InquiryWorkItemPhase#OPEN OPEN} phase,
 * and one {@link InquiryWorkItemEvent#WORK_ITEM_OPENED} audit row — all in a single
 * transaction. If any of the three fails the whole unit rolls back, so an inquiry
 * can never be persisted without its work item, nor a work item without its audit.
 *
 * <p>Atomicity is enforced with an explicit {@link TransactionTemplate} (not a
 * {@code @Transactional} proxy) so the guarantee holds whether the bean is Spring-
 * wired or hand-constructed in a test — matching this codebase's construction
 * style. The template's default propagation opens a real per-call transaction when
 * the caller ({@code IngestionService.ingestInquiries}) is non-transactional, which
 * preserves the existing per-row ingest model.
 */
@Component
public class InquiryWorkItemWriter {

    private static final String CONNECTOR_ACTOR = "SYSTEM:CONNECTOR_INGEST";

    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final InquiryWorkItemAuditRepository audits;
    private final TransactionTemplate tx;

    public InquiryWorkItemWriter(InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                 InquiryWorkItemAuditRepository audits,
                                 PlatformTransactionManager transactionManager) {
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.audits = audits;
        this.tx = new TransactionTemplate(transactionManager);
    }

    /**
     * Atomically persist {@code inquiry}, open one OPEN work item bound to {@code
     * sellerAccountId} (the exact seller connection), and append its opened-audit.
     * Returns the persisted inquiry id.
     */
    public UUID openConnectorInquiry(Inquiry inquiry, UUID sellerAccountId) {
        return openConnectorInquiry(inquiry, sellerAccountId, id -> {
        });
    }

    /**
     * As {@link #openConnectorInquiry(Inquiry, UUID)}, but also runs {@code postInsert}
     * inside the same transaction after the inquiry, work item, and audit are saved —
     * so a caller can attach a linked child row (e.g. import provenance) that commits
     * or rolls back together with the inquiry it belongs to.
     */
    public UUID openConnectorInquiry(Inquiry inquiry, UUID sellerAccountId, Consumer<UUID> postInsert) {
        return tx.execute(status -> {
            Inquiry savedInquiry = inquiries.save(inquiry);

            InquiryWorkItem workItem = new InquiryWorkItem();
            workItem.setOrgId(savedInquiry.getOrgId());
            workItem.setInquiryId(savedInquiry.getId());
            workItem.setSellerAccountId(sellerAccountId);
            workItem.setChannelId(savedInquiry.getChannelId());
            workItem.setPhase(InquiryWorkItemPhase.OPEN);
            InquiryWorkItem savedWorkItem = workItems.save(workItem);

            InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
            audit.setOrgId(savedInquiry.getOrgId());
            audit.setWorkItemId(savedWorkItem.getId());
            audit.setCommandId("open:" + savedInquiry.getId());
            audit.setEventType(InquiryWorkItemEvent.WORK_ITEM_OPENED);
            audit.setPhaseFrom(null);
            audit.setPhaseTo(InquiryWorkItemPhase.OPEN);
            audit.setActor(CONNECTOR_ACTOR);
            audits.save(audit);

            postInsert.accept(savedInquiry.getId());
            return savedInquiry.getId();
        });
    }

    /**
     * Reconcile an <b>existing</b> connector inquiry that the source now reports answered,
     * atomically: save the inquiry (the caller has already set {@code status = ANSWERED})
     * and, <b>only if its work item is absent or still OPEN</b>, transition OPEN→COMPLETED
     * plus a {@code VERIFICATION_RECORDED} audit. Terminal or mid-workflow phases
     * (PROPOSED…DISMISSED/COMPLETED/FAILED) are never touched — so an operator's in-flight
     * reply or dismissal is never overridden and a work item is never reopened. No reply is
     * ever posted to the platform.
     *
     * <p>Idempotent: the audit is keyed {@code connector-reconcile:<workItemId>} (unique per
     * work item), so replaying the same answered state records no second transition. Mirrors
     * {@code EsmInquiryReconciler.reconcileAnswered} for the connector actor.
     */
    public UUID reconcileConnectorAnswered(Inquiry inquiry) {
        return tx.execute(status -> {
            Inquiry saved = inquiries.save(inquiry);
            Optional<InquiryWorkItem> wiOpt = workItems.findByInquiryId(saved.getId());
            if (wiOpt.isEmpty()) {
                return saved.getId();   // history only — nothing to complete
            }
            InquiryWorkItem workItem = wiOpt.get();
            if (workItem.getPhase() != InquiryWorkItemPhase.OPEN) {
                return saved.getId();   // terminal or mid-workflow — never touched
            }
            workItem.setPhase(InquiryWorkItemPhase.COMPLETED);
            workItems.save(workItem);

            String commandId = "connector-reconcile:" + workItem.getId();
            if (!audits.existsByWorkItemIdAndCommandId(workItem.getId(), commandId)) {
                InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
                audit.setOrgId(saved.getOrgId());
                audit.setWorkItemId(workItem.getId());
                audit.setCommandId(commandId);
                audit.setEventType(InquiryWorkItemEvent.VERIFICATION_RECORDED);
                audit.setPhaseFrom(InquiryWorkItemPhase.OPEN);
                audit.setPhaseTo(InquiryWorkItemPhase.COMPLETED);
                audit.setActor(CONNECTOR_ACTOR);
                audits.save(audit);
            }
            return saved.getId();
        });
    }

    /**
     * Persist an inquiry as <b>history only</b> (no work item, no audit) inside one
     * transaction, running {@code postInsert} after the save so a linked child row
     * (e.g. import provenance) commits atomically with it. Used for already-answered
     * inquiries, which are stored but open no seller task.
     */
    public UUID saveHistoryInquiry(Inquiry inquiry, Consumer<UUID> postInsert) {
        return tx.execute(status -> {
            Inquiry savedInquiry = inquiries.save(inquiry);
            postInsert.accept(savedInquiry.getId());
            return savedInquiry.getId();
        });
    }
}
