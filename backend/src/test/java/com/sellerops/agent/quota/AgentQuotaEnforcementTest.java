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
        return new AgentQuotaService(usage, new AgentQuotaProperties(true, enforced, true, limit, limit));
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
        AgentQuotaProperties shipped = new AgentQuotaProperties(true, true, false, 200, 1000);
        assertThat(shipped.isEnabled()).isTrue();
        assertThat(shipped.isEnforced()).isTrue();
    }

    @Test
    void disabling_the_subsystem_records_nothing_and_refuses_nothing() {
        UUID org = UUID.randomUUID();
        AgentQuotaService quota = new AgentQuotaService(usage, new AgentQuotaProperties(false, true, false, 1, 1));
        assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-1").allowed()).isTrue();
        assertThat(quota.consume(org, AgentUsageKind.PLAN, "r-2").allowed()).isTrue();
        assertThat(quota.status(org).llmCallsUsed()).isZero();
    }

    /**
     * <b>A sitting is metered like a seller and charged like nobody</b> (Pilot QA, 2026-09-06).
     *
     * The budget exists so a SELLER's own use cannot run away. It counted every call against the org,
     * and a benchmark signs in as a real account — on the demo org that was 1,211 runs against a limit
     * of 200 in one day, sitting in the seller's meter. Under the pilot default that is a seller
     * refused for the day by work they never asked for.
     */
    @Test
    void aBenchmarkIsRecordedButDoesNotSpendTheSellersDay() {
        UUID org = UUID.randomUUID();
        AgentQuotaService service = serviceWith(true, 2);

        // Two seller calls fill the ceiling exactly.
        assertThat(service.consume(org, AgentUsageKind.PLAN, null, AgentUsageActor.USER).allowed()).isTrue();
        assertThat(service.consume(org, AgentUsageKind.PLAN, null, AgentUsageActor.USER).allowed()).isTrue();

        // A benchmark run is never refused, and — the point — never counted against the seller.
        for (int i = 0; i < 20; i++) {
            assertThat(service.consume(org, AgentUsageKind.PLAN, "bench-" + i, AgentUsageActor.BENCHMARK).allowed())
                    .isTrue();
        }
        // METERING KEPT EVERYTHING: 2 seller calls + 20 benchmark calls are all on the table.
        assertThat(usage.countByOrgIdAndUsageDate(org, java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul"))))
                .isEqualTo(22L);
        // The seller's own figure is what the ceiling is compared against, and what the screen shows.
        assertThat(service.status(org).llmCallsUsed()).isEqualTo(2L);
        // …and the seller is now refused on their own third call, exactly as they would have been
        // if the benchmark had never run.
        assertThat(service.consume(org, AgentUsageKind.PLAN, null, AgentUsageActor.USER).allowed()).isFalse();
    }

    /** An unlabelled or unknown caller is the seller — a budget must not be escapable by omission. */
    @Test
    void anUnattributableCallIsChargedToTheSeller() {
        assertThat(AgentUsageActor.parse(null)).isEqualTo(AgentUsageActor.USER);
        assertThat(AgentUsageActor.parse("  ")).isEqualTo(AgentUsageActor.USER);
        assertThat(AgentUsageActor.parse("something-else")).isEqualTo(AgentUsageActor.USER);
        assertThat(AgentUsageActor.parse("benchmark")).isEqualTo(AgentUsageActor.BENCHMARK);
        assertThat(AgentUsageActor.USER.enforced()).isTrue();
        assertThat(AgentUsageActor.QA.enforced()).isFalse();
        assertThat(AgentUsageActor.BENCHMARK.enforced()).isFalse();
    }

    /** And a deployment that did not opt in reads every header as the seller. */
    @Test
    void aDeploymentThatDidNotOptInIgnoresTheHeader() {
        AgentQuotaService trusting =
                new AgentQuotaService(usage, new AgentQuotaProperties(true, true, true, 10, 10));
        AgentQuotaService plain =
                new AgentQuotaService(usage, new AgentQuotaProperties(true, true, false, 10, 10));
        assertThat(trusting.actorOf("BENCHMARK")).isEqualTo(AgentUsageActor.BENCHMARK);
        assertThat(plain.actorOf("BENCHMARK")).isEqualTo(AgentUsageActor.USER);
    }
}
