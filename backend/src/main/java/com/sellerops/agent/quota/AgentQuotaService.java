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
        if (!properties.isEnabled()) {
            return QuotaDecision.pass();
        }
        LocalDate today = LocalDate.now(KST);
        long calls = usage.countByOrgIdAndUsageDate(orgId, today);
        if (calls >= properties.llmCalls()) {
            log.info("에이전트 일일 호출 한도에 도달했습니다. org={} used={} limit={} enforced={}",
                    orgId, calls, properties.llmCalls(), properties.isEnforced());
            if (properties.isEnforced()) {
                return QuotaDecision.exhausted(QuotaDecision.Reason.DAILY_LLM_CALLS,
                        calls, properties.llmCalls());
            }
        }
        boolean newRun = runId != null && !usage.existsByOrgIdAndUsageDateAndRunId(orgId, today, runId);
        if (newRun) {
            long runs = usage.countDistinctRuns(orgId, today);
            if (runs >= properties.runs()) {
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
        usage.save(row);
        return QuotaDecision.pass();
    }

    /** Today's spend, for the settings screen. Read-only; charges nothing. */
    @Transactional(readOnly = true)
    public AgentQuotaStatus status(UUID orgId) {
        LocalDate today = LocalDate.now(KST);
        return new AgentQuotaStatus(properties.isEnabled(), properties.isEnforced(), today,
                usage.countDistinctRuns(orgId, today), properties.runs(),
                usage.countByOrgIdAndUsageDate(orgId, today), properties.llmCalls());
    }

    /** What today looks like. Percentages are the screen's business, not this record's. */
    public record AgentQuotaStatus(boolean enabled, boolean enforced, LocalDate date,
                                   long runsUsed, int runsLimit,
                                   long llmCallsUsed, int llmCallsLimit) {
    }
}
