package com.sellerops.responsibility;

import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * What happens with what a run observed. The runtime owns windows, claims and observation; what the observation
 * MEANS (cases, investigation, the exception summary) belongs to the operations-case package, which implements this.
 *
 * <p>An interface rather than a dependency so the runtime has no compile-time knowledge of cases — and so a
 * deployment, or a Package A test, without that package still works every window exactly as before.
 */
public interface ResponsibilityRunFollowUp {

    /**
     * Called while the run's lease is still held, after every required source has an observation fact.
     * Must be idempotent: a reclaimed attempt calls it again for the same run.
     *
     * @param leaseLost true once this instance no longer holds the run; the follow-up stops at the next boundary
     */
    void afterObservation(UUID runId, BooleanSupplier leaseLost);

    /** Called once the run's status is final. The exception summary is decided here. */
    void afterFinish(UUID runId);

    /** The seller stopped the responsibility: nothing it opened is anyone's case any more. */
    void afterStopped(UUID orgId, UUID responsibilityId);
}
