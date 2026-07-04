package com.sellerops.inquiry.workitem;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import java.util.UUID;
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

            return savedInquiry.getId();
        });
    }
}
