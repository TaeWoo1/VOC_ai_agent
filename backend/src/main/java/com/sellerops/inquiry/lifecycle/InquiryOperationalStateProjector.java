package com.sellerops.inquiry.lifecycle;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import java.time.Clock;
import java.time.Instant;
import org.springframework.stereotype.Component;

/**
 * The one place {@link Inquiry#getOperationalState()} is written.
 *
 * <p><b>It decides nothing.</b> It reads the seller's dismissal decision off the work item and copies
 * the consequence onto the inquiry, so a count can be a count. Every other class in this repository
 * reads that column and never writes it — {@code InquiryOperationalStateFenceTest} is what keeps that
 * true, because a second writer is a second authority, and a second authority is how "the seller said
 * spam" and "the system thinks spam" start disagreeing with nobody able to say which is right.
 *
 * <p><b>It is symmetric, and that is the reversal path.</b> The same call that excludes a dismissed
 * inquiry restores an undismissed one: {@link #project} returns the state the ledger implies right
 * now, not a one-way transition. So a dismissal reversal needs no undo bookkeeping and no compensating
 * record — re-project the row and it is operationally eligible again. There is no seller-facing
 * un-dismiss control today; when one is built, calling this is the whole of its lifecycle work.
 *
 * <p><b>It never produces {@link InquiryOperationalState#SOURCE_REMOVED}</b>, and never clears it
 * either. Spam exclusion and source absence are different claims with different evidence, and this
 * projector only has evidence for the first one.
 */
@Component
public class InquiryOperationalStateProjector {

    private final Clock clock;

    public InquiryOperationalStateProjector() {
        this(Clock.systemUTC());
    }

    public InquiryOperationalStateProjector(Clock clock) {
        this.clock = clock;
    }

    /**
     * The operational state the work item implies. {@code workItem} may be null — an inquiry with no
     * work item (file upload, legacy, already-answered connector history) was never dismissed.
     */
    public InquiryOperationalState project(Inquiry inquiry, InquiryWorkItem workItem) {
        InquiryOperationalState current = inquiry.getOperationalState() == null
                ? InquiryOperationalState.ACTIVE
                : inquiry.getOperationalState();
        if (current == InquiryOperationalState.SOURCE_REMOVED) {
            // Not this projector's axis. Nothing writes it today; if something ever does, a spam
            // dismissal must not silently overwrite it.
            return current;
        }
        return isDismissedAsSpam(workItem)
                ? InquiryOperationalState.EXCLUDED_SPAM
                : InquiryOperationalState.ACTIVE;
    }

    /**
     * Apply {@link #project} to the entity. Returns true when the state actually changed, so a
     * backfill can report real transitions instead of rows visited — and so an idempotent re-run
     * writes nothing.
     */
    public boolean apply(Inquiry inquiry, InquiryWorkItem workItem) {
        InquiryOperationalState next = project(inquiry, workItem);
        if (next == inquiry.getOperationalState()) {
            return false;
        }
        inquiry.setOperationalState(next);
        inquiry.setOperationalStateAt(Instant.now(clock));
        return true;
    }

    private static boolean isDismissedAsSpam(InquiryWorkItem workItem) {
        return workItem != null
                && workItem.getPhase() == InquiryWorkItemPhase.DISMISSED
                && workItem.getDisposition() == InquiryWorkItemDisposition.SPAM;
    }
}
