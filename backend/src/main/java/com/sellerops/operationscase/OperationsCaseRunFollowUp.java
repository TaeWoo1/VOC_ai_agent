package com.sellerops.operationscase;

import com.sellerops.responsibility.ResponsibilityRunFollowUp;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.springframework.stereotype.Component;

/** The runtime's follow-up, as cases: process while the lease is held, summarise once the run is final. */
@Component
public class OperationsCaseRunFollowUp implements ResponsibilityRunFollowUp {

    private final OperationsCaseProcessor processor;
    private final OperationsCaseNotifier notifier;
    private final OperationsCaseReconciler reconciler;

    public OperationsCaseRunFollowUp(OperationsCaseProcessor processor, OperationsCaseNotifier notifier,
                                     OperationsCaseReconciler reconciler) {
        this.processor = processor;
        this.notifier = notifier;
        this.reconciler = reconciler;
    }

    @Override
    public void afterObservation(UUID runId, BooleanSupplier leaseLost) {
        processor.process(runId, leaseLost);
    }

    @Override
    public void afterFinish(UUID runId) {
        notifier.afterFinish(runId);
    }

    @Override
    public void afterStopped(UUID orgId, UUID responsibilityId) {
        reconciler.closeAll(orgId, responsibilityId);
    }
}
