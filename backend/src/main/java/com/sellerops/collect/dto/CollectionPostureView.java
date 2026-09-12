package com.sellerops.collect.dto;

/**
 * Whether this DEPLOYMENT collects on its own right now — the second of the three layers a seller-facing
 * "자동" sentence needs (Product Self-Knowledge Truth Closure v1).
 *
 * <p><b>Why it had to exist.</b> Three different facts were being answered by one word. A channel's
 * connector can serve a data type on a schedule (a CHANNEL capability); a deployment may or may not be
 * running the scheduler that would tick it (a RUNTIME fact); and a seller may or may not have connected
 * the channel and had a routine schedule provisioned (a SELLER fact). Only the third was readable —
 * {@code ChannelCoverageRow.routineEnabled} — and it reports an enabled schedule ROW, which stays true
 * in a deployment whose {@code SyncScheduler} bean does not exist. That combination is live on this
 * machine today, and it is how "정기적으로 다시 확인하고 있어" could be said while nothing ticked.
 *
 * <p><b>Derived from bean presence, not from a flag string.</b> {@code schedulerRunning} is true when
 * the scheduler bean was actually created; a re-read of the property could drift from the condition
 * that created it. {@code routineProvisioning} is the self-pilot switch — what decides whether a newly
 * connected account ever GETS a routine schedule.
 *
 * <p><b>{@code proactiveRunning} is the same question for the layer above collection.</b> The ledger's
 * own feature row says out loud that it cannot answer whether preparing work ahead of the seller is
 * switched on here — that is a deployment fact, not a product one — and without a reading for it the
 * Agent said 「이 환경에서 켜져 있는지는 여기서 확인되지 않습니다」 about something this process knows
 * perfectly well. Bean presence again, for the reason above it: the bean is what ticks.
 *
 * <p>Carries no configuration key name, no org, no credential — three booleans, safe for any caller
 * that may read capabilities. The seller-facing sentence is composed elsewhere; nothing here is text.
 */
public record CollectionPostureView(
        boolean schedulerRunning,
        boolean routineProvisioning,
        boolean proactiveRunning) {
}
