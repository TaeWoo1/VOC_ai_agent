package com.sellerops.responsibility;

import java.util.Collection;

/**
 * A run's status is a pure function of the latest observation of each required source (§6-1 R3/R4):
 * <ul>
 *   <li>every source COMPLETE or BOUNDED → {@link RunStatus#SUCCESS};</li>
 *   <li>every source NONE (or no source at all) → {@link RunStatus#FAILED};</li>
 *   <li>anything else → {@link RunStatus#PARTIAL}.</li>
 * </ul>
 * An unfinished observation (null) counts as not observed.
 */
final class RunOutcomeRule {

    private RunOutcomeRule() {
    }

    static RunStatus of(Collection<SourceCompleteness> latestPerSource) {
        if (latestPerSource.isEmpty()) {
            return RunStatus.FAILED;
        }
        boolean allSettled = latestPerSource.stream().allMatch(c -> c != null && c.settled());
        if (allSettled) {
            return RunStatus.SUCCESS;
        }
        boolean noneObserved = latestPerSource.stream().allMatch(c -> c == null || c == SourceCompleteness.NONE);
        return noneObserved ? RunStatus.FAILED : RunStatus.PARTIAL;
    }
}
