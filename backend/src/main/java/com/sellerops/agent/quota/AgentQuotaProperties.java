package com.sellerops.agent.quota;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * {@code sellerops.agent.quota.*} — the Agent's daily ceiling for one org.
 *
 * <p><b>Every number here is deployment policy, so none of them is a constant in a service.</b> A demo
 * org, a pilot seller and a production tenant do not want the same ceiling, and a limit compiled into
 * source is a limit that needs a release to change — which in practice means it gets removed instead
 * of tuned. Bind with {@code SELLEROPS_AGENT_QUOTA_DAILY_RUNS_PER_ORG} and friends.
 *
 * <p><b>Metering and enforcement are two switches, not one.</b> {@code enabled} decides whether this
 * subsystem records what was spent; {@code enforced} decides whether it may refuse. A local machine,
 * a manual-QA sitting and a benchmark all want the first and not the second — and the shape that was
 * here before made turning the ceiling off ALSO turn the meter off, so the sittings that most need
 * usage, latency and cost numbers were exactly the ones that produced none. Production and pilot keep
 * {@code enforced=true}; nothing about their behaviour changes.
 *
 * <p><b>On by default, and the defaults are generous.</b> The failure mode being prevented is runaway
 * cost, not ordinary use: a seller asking thirty questions in a day never meets this; a loop asking
 * three thousand meets it within minutes. Defaulting the quota OFF would mean the protection exists
 * only where someone remembered to configure it.
 */
@Component
public class AgentQuotaProperties {

    private final boolean enabled;
    private final boolean enforced;
    private final int dailyRunsPerOrg;
    private final int dailyLlmCallsPerOrg;

    public AgentQuotaProperties(
            @Value("${sellerops.agent.quota.enabled:true}") boolean enabled,
            @Value("${sellerops.agent.quota.enforced:true}") boolean enforced,
            @Value("${sellerops.agent.quota.daily-runs-per-org:200}") int dailyRunsPerOrg,
            @Value("${sellerops.agent.quota.daily-llm-calls-per-org:1000}") int dailyLlmCallsPerOrg) {
        this.enabled = enabled;
        this.enforced = enforced;
        this.dailyRunsPerOrg = dailyRunsPerOrg;
        this.dailyLlmCallsPerOrg = dailyLlmCallsPerOrg;
    }

    public boolean isEnabled() {
        return enabled;
    }

    /**
     * May the ceiling refuse a call, or only count it?
     *
     * <p>Enforcement without metering is impossible by construction — a deployment that records
     * nothing has nothing to compare a limit against — so this is read only where {@code enabled}
     * already holds.
     */
    public boolean isEnforced() {
        return enforced;
    }

    public int runs() {
        return dailyRunsPerOrg;
    }

    public int llmCalls() {
        return dailyLlmCallsPerOrg;
    }
}
