package com.sellerops.proactive.dto;

/**
 * Whether the proactive layer actually changes what a seller does — the retention hypothesis, in the
 * only terms that can falsify it.
 *
 * <p><b>Counted against operational action, never against Agent chatter.</b> A message count would
 * rise whether or not a single customer got an answer. What is counted here is: how many cases were
 * prepared, how many the seller ever saw, how many they opened, how many ended with them ACTING on
 * the work — and how long that took. Everything after the act (draft edited, approved, sent, verified)
 * is already on the work item's audit trail and is deliberately not copied here.
 *
 * @param medianSecondsToAction median of (acted − prepared) over cases the seller acted on; null when
 *                              none has been acted on yet — never zero, which would read as instant
 */
public record ProactiveTelemetryView(
        long prepared,
        long surfaced,
        long opened,
        long acted,
        long closedUnacted,
        long draftsPrepared,
        Long medianSecondsToAction) {
}
