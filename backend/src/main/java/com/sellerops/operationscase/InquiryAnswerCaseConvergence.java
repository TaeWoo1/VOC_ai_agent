package com.sellerops.operationscase;

import com.sellerops.inquiry.publish.InquiryAnswerSettledEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * <b>Close the gap between «the seller sent it» and «the card stops asking».</b>
 *
 * <p>A case's status is derived from canonical truth by {@link OperationsCaseReconciler}, and that
 * derivation ran only inside a responsibility run — fixed two-hour Asia/Seoul windows. So a seller who
 * approved and sent an answer at 04:05 kept seeing that inquiry under 확인할 일 until 06:00, with no
 * way to tell it apart from work nobody had touched. The rule was right and the moment was wrong.
 *
 * <p>This listens for the one event that says the record moved and re-derives that single case
 * immediately, through {@link OperationsCaseReconciler#converge} — the run's own {@code derive} and
 * {@code apply}, not a second opinion. <b>No scheduler semantics change</b>: the window cadence, the
 * lease, the page size and the run's visit to this case are all untouched; the run simply finds it
 * already settled. And because the derivation is the same one, an event that arrives when the case
 * should NOT move — an approval bound but nothing dispatched — moves nothing.
 *
 * <p><b>It cannot affect the send.</b> The publish path has committed before this runs, and a failure
 * here is logged and dropped: a case card that is late is a smaller defect than an answer whose
 * recorded outcome depends on a screen's bookkeeping succeeding.
 */
@Component
public class InquiryAnswerCaseConvergence {

    private static final Logger log = LoggerFactory.getLogger(InquiryAnswerCaseConvergence.class);

    private final OperationsCaseReconciler reconciler;

    public InquiryAnswerCaseConvergence(OperationsCaseReconciler reconciler) {
        this.reconciler = reconciler;
    }

    @EventListener
    public void onAnswerSettled(InquiryAnswerSettledEvent event) {
        try {
            reconciler.converge(event.orgId(), OperationsSubjectKind.INQUIRY, event.inquiryId());
        } catch (RuntimeException e) {
            // The answer is already recorded; this is the card catching up. The scheduled run will
            // reach the same conclusion from the same rows.
            log.warn("responsibility: case 즉시 수렴 실패 org={} inquiry={} 사유={}",
                    event.orgId(), event.inquiryId(), e.getClass().getSimpleName());
        }
    }
}
