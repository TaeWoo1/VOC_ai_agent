package com.sellerops.inquiry.proposal;

import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Writes the OPEN&nbsp;&rarr;&nbsp;PROPOSED transition as one atomic unit: insert the
 * {@link InquiryProposal}, flip the work item's phase to {@link
 * InquiryWorkItemPhase#PROPOSED}, and append one {@link
 * InquiryWorkItemEvent#PROPOSAL_ADDED} audit row — all in a single transaction. If
 * any step fails the whole unit rolls back, so a work item can never be left
 * PROPOSED without its proposal, nor a proposal exist without its audit.
 *
 * <p>Mirrors {@link com.sellerops.inquiry.workitem.InquiryWorkItemWriter}: an
 * explicit {@link TransactionTemplate} (not a {@code @Transactional} proxy) so the
 * atomic guarantee holds whether the bean is Spring-wired or hand-constructed in a
 * test. The two UNIQUE constraints ({@code inquiry_proposal.work_item_id} and the
 * audit's {@code (work_item_id, command_id)}) make a concurrent second writer fail
 * with a data-integrity violation, which the caller resolves as a replay.
 */
@Component
public class InquiryProposalWriter {

    private final InquiryWorkItemRepository workItems;
    private final InquiryProposalRepository proposals;
    private final InquiryWorkItemAuditRepository audits;
    private final TransactionTemplate tx;

    public InquiryProposalWriter(InquiryWorkItemRepository workItems, InquiryProposalRepository proposals,
                                 InquiryWorkItemAuditRepository audits,
                                 PlatformTransactionManager transactionManager) {
        this.workItems = workItems;
        this.proposals = proposals;
        this.audits = audits;
        this.tx = new TransactionTemplate(transactionManager);
    }

    /** The deterministic idempotency key for a work item's propose command. */
    public static String commandId(java.util.UUID workItemId) {
        return "propose:" + workItemId;
    }

    /**
     * Atomically persist {@code proposal}, move {@code workItem} OPEN&nbsp;&rarr;&nbsp;PROPOSED,
     * and append the PROPOSAL_ADDED audit ({@code actor} = the seller who initiated
     * it). Returns the persisted proposal.
     */
    public InquiryProposal attachProposalAndTransition(InquiryWorkItem workItem, InquiryProposal proposal,
                                                       String actor) {
        return tx.execute(status -> {
            workItem.setPhase(InquiryWorkItemPhase.PROPOSED);
            workItems.save(workItem);

            InquiryProposal savedProposal = proposals.save(proposal);

            InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
            audit.setOrgId(workItem.getOrgId());
            audit.setWorkItemId(workItem.getId());
            audit.setCommandId(commandId(workItem.getId()));
            audit.setEventType(InquiryWorkItemEvent.PROPOSAL_ADDED);
            audit.setPhaseFrom(InquiryWorkItemPhase.OPEN);
            audit.setPhaseTo(InquiryWorkItemPhase.PROPOSED);
            audit.setActor(actor);
            audits.save(audit);

            return savedProposal;
        });
    }
}
