package com.sellerops.inquiry.workitem;

import com.sellerops.common.DataOrigin;
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
    /**
     * The dismissal ledger row for one inquiry, or null. Read-only, and here rather than at the
     * repository so that ingestion keeps talking to the one collaborator that owns work items.
     */
    public InquiryWorkItem findWorkItem(UUID inquiryId) {
        return inquiryId == null ? null : workItems.findByInquiryId(inquiryId).orElse(null);
    }

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
        // A manufactured inquiry is stored as history and never becomes a seller task. The queue this
        // opens into is the same queue whose items reach approval and, past that, a marketplace send —
        // so a DEMO_SEED row that entered it would be a fixture standing in a line that ends at a real
        // customer's inquiry thread. Refusing at the door is the only place the refusal is structural:
        // downstream every consumer would have to remember, and one that forgot would not fail loudly.
        // History is deliberately still written: excluding it from the QUEUE is not the same as
        // pretending it was never collected, and demo/debug reads still find it.
        if (inquiry.getDataOrigin() != DataOrigin.REAL) {
            return saveHistoryInquiry(inquiry, postInsert);
        }
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
     * Phases an externally-observed answer may close. <b>Everything else is left alone.</b>
     *
     * <p>{@code OPEN} is nobody's work in progress. {@code PROPOSED} holds an AI draft and nothing
     * else — no seller approval, no intent, no execution — so when the source itself says the customer
     * has been answered, that source truth outranks a draft nobody has agreed to send (product-owner,
     * 2026-08-26). From {@code APPROVED} onward a person has committed to something, and
     * {@code ACTION_PENDING} / {@code EXECUTED} are mid-flight against the channel: closing those from
     * a connector observation would race our own send and could discard a verification that is about
     * to arrive. They keep the execution lifecycle they already have.
     */
    private static final java.util.Set<InquiryWorkItemPhase> ANSWERED_ELSEWHERE_CLOSES =
            java.util.EnumSet.of(InquiryWorkItemPhase.OPEN, InquiryWorkItemPhase.PROPOSED);

    /**
     * Reconcile an <b>existing</b> connector inquiry that the source reports answered, atomically:
     * save the inquiry (the caller has already set {@code status = ANSWERED}) and, <b>only if its
     * work item is absent or in {@link #ANSWERED_ELSEWHERE_CLOSES}</b>, transition it to COMPLETED
     * plus a {@code VERIFICATION_RECORDED} audit carrying the ACTUAL phase it came from. A work item
     * is never reopened, and no reply is ever posted to the platform.
     *
     * <p><b>Answered elsewhere, in the vocabulary that already exists.</b> There is no new phase, no
     * new event and no new disposition here: the customer was answered and the source proves it, which
     * is what {@code COMPLETED} + {@code VERIFICATION_RECORDED} has always meant on this path. The
     * only change is which phases are eligible. ({@code ANSWERED_ELSEWHERE} exists as a
     * {@code ProactiveCloseReason} for the proactive CASE, which closes independently — the two agree
     * without either owning the other.)
     *
     * <p><b>It is idempotent and therefore self-healing.</b> The caller may hand over a row that was
     * already {@code ANSWERED} before this sweep, not only one that just became so — which is how the
     * stale item that motivated this gets closed at all, since a row that turned ANSWERED while its
     * work item sat in PROPOSED would otherwise never be revisited. The audit is keyed
     * {@code connector-reconcile:<workItemId>} (unique per work item), so a replay records no second
     * transition. Mirrors {@code EsmInquiryReconciler.reconcileAnswered} for the connector actor.
     */
    public UUID reconcileConnectorAnswered(Inquiry inquiry) {
        return tx.execute(status -> {
            Inquiry saved = inquiries.save(inquiry);
            Optional<InquiryWorkItem> wiOpt = workItems.findByInquiryId(saved.getId());
            if (wiOpt.isEmpty()) {
                return saved.getId();   // history only — nothing to complete
            }
            InquiryWorkItem workItem = wiOpt.get();
            if (!ANSWERED_ELSEWHERE_CLOSES.contains(workItem.getPhase())) {
                return saved.getId();   // terminal, approved, or mid-flight — never touched
            }
            InquiryWorkItemPhase from = workItem.getPhase();
            workItem.setPhase(InquiryWorkItemPhase.COMPLETED);
            workItems.save(workItem);

            String commandId = "connector-reconcile:" + workItem.getId();
            if (!audits.existsByWorkItemIdAndCommandId(workItem.getId(), commandId)) {
                InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
                audit.setOrgId(saved.getOrgId());
                audit.setWorkItemId(workItem.getId());
                audit.setCommandId(commandId);
                audit.setEventType(InquiryWorkItemEvent.VERIFICATION_RECORDED);
                // The phase it actually came from, not the phase this path used to assume.
                audit.setPhaseFrom(from);
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
