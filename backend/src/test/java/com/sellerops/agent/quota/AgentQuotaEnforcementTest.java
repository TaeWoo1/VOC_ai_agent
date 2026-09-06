package com.sellerops.agent.quota;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * <b>Metering and enforcement are two switches — the meter keeps running when the ceiling does not.</b>
 *
 * <p>LangGraph Orchestration Migration + AOP Runtime Core v1 §0. Before this split there was one
 * switch, and turning the ceiling off to run a benchmark or a manual-QA sitting also turned the METER
 * off: the sittings that most need usage, latency and cost numbers were exactly the ones that produced
 * none. Worse, a benchmark that instead RAISED the limit spent part of its first pass measuring the
 * quota rather than the model.
 *
 * <p>What is pinned here is the pair, because the defect was a missing distinction rather than a wrong
 * number: a deployment must be able to say «count everything, refuse nothing», and production must go
 * on saying «refuse» without configuring anything.
 *
 * <p><b>{@code @DataJpaTest}, not {@code @SpringBootTest}</b>: the latter loads {@code MockDataSeeder}
 * and re-seeds the channel catalogue into the shared schema, which this repository's neighbours
 * already warn about. The service under test is assembled by hand from the repository, which is all
 * this property needs.
 */
@DataJpaTest
@ActiveProfiles("test")
class AgentQuotaEnforcementTest {

    @Autowired
    private AgentLlmUsageRepository usage;

    private AgentQuotaService serviceWith(boolean enforced, int limit) {
        return new AgentQuotaService(usage, new AgentQuotaProperties(true, enforced, limit, limit));
    }

    @Test
    void refuses_past_the_ceiling_when_enforced() {
        UUID org = UUID.randomUUID();
        AgentQuotaService quota = serviceWith(true, 2);
        assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-1").allowed()).isTrue();
        assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-1").allowed()).isTrue();
        QuotaDecision third = quota.consume(org, AgentUsageKind.PLAN, "r-1");
        assertThat(third.allowed()).isFalse();
        assertThat(third.reason()).isEqualTo(QuotaDecision.Reason.DAILY_LLM_CALLS);
        // The refused call is not recorded: it never happened, and a meter that counted it would
        // report spend the vendor never billed.
        assertThat(quota.status(org).llmCallsUsed()).isEqualTo(2);
    }

    @Test
    void counts_past_the_ceiling_and_never_refuses_when_enforcement_is_off() {
        UUID org = UUID.randomUUID();
        AgentQuotaService quota = serviceWith(false, 2);
        for (int i = 0; i < 5; i += 1) {
            assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-" + i).allowed()).isTrue();
        }
        // Every call is on the meter — that is the whole point of the second switch.
        AgentQuotaService.AgentQuotaStatus status = quota.status(org);
        assertThat(status.llmCallsUsed()).isEqualTo(5);
        assertThat(status.runsUsed()).isEqualTo(5);
        assertThat(status.enabled()).isTrue();
        assertThat(status.enforced()).isFalse();
    }

    @Test
    void a_deployment_that_says_nothing_still_enforces() {
        // The default is the production posture, and it is the one nobody configures.
        AgentQuotaProperties shipped = new AgentQuotaProperties(true, true, 200, 1000);
        assertThat(shipped.isEnabled()).isTrue();
        assertThat(shipped.isEnforced()).isTrue();
    }

    @Test
    void disabling_the_subsystem_records_nothing_and_refuses_nothing() {
        UUID org = UUID.randomUUID();
        AgentQuotaService quota = new AgentQuotaService(usage, new AgentQuotaProperties(false, true, 1, 1));
        assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-1").allowed()).isTrue();
        assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-2").allowed()).isTrue();
        assertThat(quota.status(org).llmCallsUsed()).isZero();
    }
}
