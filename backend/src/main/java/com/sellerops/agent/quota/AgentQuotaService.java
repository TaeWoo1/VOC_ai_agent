package com.sellerops.agent.quota;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * How much of today's Agent budget this org has left, and the refusal when it has none.
 *
 * <p><b>Charged BEFORE the call, never after.</b> A ceiling enforced afterwards has already paid for
 * the thing it was meant to prevent — the same rule {@code OperatorBudget} states for a single run,
 * applied to a day.
 *
 * <p><b>Exhaustion is not an error.</b> It returns a refusal the existing seams already know how to
 * carry ({@code available=false}), so a run degrades exactly the way it degrades when the capability
 * is switched off for the org: deterministically, with a sentence, and with the dashboard untouched.
 * Nothing here can affect a marketplace call, because nothing here is on that path at all.
 *
 * <p><b>Counting and refusing are separate.</b> With {@code enforced=false} every call is still
 * recorded — the row is what usage, latency and cost reporting are built on — and no call is ever
 * refused. That is the posture a local machine, a manual-QA sitting and a benchmark want, and it is
 * the opposite of switching the subsystem off, which also stops the meter.
 *
 * <p><b>A run buys its slot once.</b> The Operator plans up to three times per run; charging a run
 * slot per iteration would make the daily run limit mean a third of what it says.
 */
@Service
public class AgentQuotaService {

    private static final Logger log = LoggerFactory.getLogger(AgentQuotaService.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final AgentLlmUsageRepository usage;
    private final AgentQuotaProperties properties;

    public AgentQuotaService(AgentLlmUsageRepository usage, AgentQuotaProperties properties) {
        this.usage = usage;
        this.properties = properties;
    }

    /**
     * Charge one model call, or refuse.
     *
     * <p>Runs in its own transaction: the usage row must survive whether or not the caller's work
     * afterwards does. A call that was made and then rolled back is a call the vendor still billed.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId) {
        return consume(orgId, kind, runId, AgentUsageActor.USER);
    }

    /**
     * The actor this request may be attributed to.
     *
     * <p>A header is only believed where the deployment says so ({@code quota.trust-actor-header},
     * false everywhere by default). On production and pilot the answer is always {@link
     * AgentUsageActor#USER}, so no caller can label its way past the budget.
     */
    public AgentUsageActor actorOf(String headerValue) {
        return properties.isTrustActorHeader() ? AgentUsageActor.parse(headerValue) : AgentUsageActor.USER;
    }

    /**
     * Charge one model call by a named actor, or refuse.
     *
     * <p><b>The actor decides whether the limits apply, never whether the row is written.</b> A QA or
     * benchmark call costs the deployment exactly what a seller's does, so it is metered identically;
     * what it must not do is spend the seller's day. Before this, a benchmark signing in as a real
     * account did precisely that — 1,211 runs against a limit of 200 on one org in a day.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public QuotaDecision consume(UUID orgId, AgentUsageKind kind, String runId, AgentUsageActor actor) {
        if (!properties.isEnabled()) {
            return QuotaDecision.pass();
        }
        LocalDate today = LocalDate.now(KST);
        // The seller's own spend is what the limit is about; the row below is written either way.
        long calls = usage.countByOrgIdAndUsageDateAndActor(orgId, today, AgentUsageActor.USER);
        if (actor.enforced() && calls >= properties.llmCalls()) {
            log.info("에이전트 일일 호출 한도에 도달했습니다. org={} used={} limit={} enforced={}",
                    orgId, calls, properties.llmCalls(), properties.isEnforced());
            if (properties.isEnforced()) {
                return QuotaDecision.exhausted(QuotaDecision.Reason.DAILY_LLM_CALLS,
                        calls, properties.llmCalls());
            }
        }
        boolean newRun = runId != null && !usage.existsByOrgIdAndUsageDateAndRunId(orgId, today, runId);
        if (newRun) {
            long runs = usage.countDistinctUserRuns(orgId, today);
            if (actor.enforced() && runs >= properties.runs()) {
                log.info("에이전트 일일 실행 한도에 도달했습니다. org={} used={} limit={} enforced={}",
                        orgId, runs, properties.runs(), properties.isEnforced());
                if (properties.isEnforced()) {
                    return QuotaDecision.exhausted(QuotaDecision.Reason.DAILY_RUNS, runs, properties.runs());
                }
            }
        }

        AgentLlmUsage row = new AgentLlmUsage();
        row.setOrgId(orgId);
        row.setUsageDate(today);
        row.setKind(kind);
        row.setRunId(runId);
        row.setActor(actor);
        usage.save(row);
        return QuotaDecision.pass();
    }

    /**
     * Today's spend, for the settings screen. Read-only; charges nothing.
     *
     * <p>The USED figures are the SELLER's, because they sit beside limits that only apply to the
     * seller — showing a benchmark's calls against the seller's ceiling is how the screen would claim
     * a budget was nearly spent by work the seller never did. The whole table is still there for
     * cost reporting, which asks a different question.
     */
    @Transactional(readOnly = true)
    public AgentQuotaStatus status(UUID orgId) {
        LocalDate today = LocalDate.now(KST);
        return new AgentQuotaStatus(properties.isEnabled(), properties.isEnforced(), today,
                usage.countDistinctUserRuns(orgId, today), properties.runs(),
                usage.countByOrgIdAndUsageDateAndActor(orgId, today, AgentUsageActor.USER),
                properties.llmCalls());
    }

    /** What today looks like. Percentages are the screen's business, not this record's. */
    public record AgentQuotaStatus(boolean enabled, boolean enforced, LocalDate date,
                                   long runsUsed, int runsLimit,
                                   long llmCallsUsed, int llmCallsLimit) {
    }
}
