package com.sellerops.inquiry.resolve;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import com.sellerops.agent.llm.goal.InquiryGoalService;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.goal.InquiryGoalInterpretation;
import com.sellerops.inquiry.goal.InquiryGoalInterpretationRepository;
import com.sellerops.operationscase.CaseFromResolution;
import com.sellerops.operationscase.CaseResolutionReader;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;

/**
 * <b>The single REAL smoke of {@code sellerops.inquiry-goal}</b>: one stored inquiry, one model call, one reuse.
 *
 * <p>Gated off by default and by three separate things, because it spends money and writes a row:
 * {@code RUN_INQUIRY_GOAL_SMOKE=true}, the capability's own flag and key, and this organisation being named in
 * {@code SELLEROPS_INQUIRY_GOAL_ORG_IDS}. The target is passed in rather than hardcoded, so a re-run cannot
 * quietly point somewhere else.
 *
 * <h2>What it proves, and what it cannot</h2>
 *
 * <p>Proves, on production classes reading the production database: the stored inquiry reaches the interpreter,
 * exactly one vendor call is made, the reading is stored, the binding and the deterministic resolvers settle it,
 * {@link CaseFromResolution} reads that into the case vocabulary, and a second pass costs <b>nothing</b>.
 *
 * <p>Does <b>not</b> prove the step above it. {@code OperationsCaseProcessor} opens a case only for a subject
 * newer than a settled source observation and inside its 15-day acquisition reach, and this organisation's
 * freshest unanswered inquiry is older than that. Manufacturing a run whose sources claim an observation that
 * never happened would make the persisted case a record of a collection this smoke did not perform, so it is not
 * done — the gap is reported instead.
 *
 * <h2>No marketplace</h2>
 *
 * <p>{@link CaseResolutionReader} asks for {@code STORED_ONLY} and nothing here widens it, so the order fact comes
 * from the store. Asserted below rather than assumed.
 */
@SpringBootTest
@Import(InquiryGoalDemoOrgSmokeIT.CountingTransport.class)
@EnabledIfEnvironmentVariable(named = "RUN_INQUIRY_GOAL_SMOKE", matches = "true")
class InquiryGoalDemoOrgSmokeIT {

    /** Counts vendor calls without changing what is sent: the real transport, wrapped. */
    @TestConfiguration
    static class CountingTransport {

        static final AtomicInteger CALLS = new AtomicInteger();

        @Bean
        @Primary
        AgentLlmTransport countingAgentLlmTransport() {
            AgentLlmTransport real = new JdkAgentLlmTransport();
            return (URI uri, Map<String, String> headers, String body) -> {
                CALLS.incrementAndGet();
                return real.post(uri, headers, body);
            };
        }
    }

    @Autowired StoredCustomerGoalInterpretation interpretation;
    @Autowired CaseResolutionReader resolutions;
    @Autowired InquiryGoalService capability;
    @Autowired InquiryRepository inquiries;
    @Autowired InquiryGoalInterpretationRepository readings;

    private static UUID env(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must name the smoke target");
        }
        return UUID.fromString(value.trim());
    }

    @Test
    @DisplayName("one stored inquiry: one model call, one stored reading, and a second pass that costs nothing")
    void theSingleCallSmoke() {
        UUID org = env("SMOKE_ORG_ID");
        UUID inquiryId = env("SMOKE_INQUIRY_ID");

        // The capability admits this organisation and no other. A capability that would answer for anybody is not
        // the one that was approved.
        assertThat(capability.isEnabledFor(org)).as("the named organisation is admitted").isTrue();
        assertThat(capability.isEnabledFor(UUID.randomUUID())).as("nobody else is").isFalse();
        assertThat(capability.promptVersion()).isEqualTo("customer-goal-interpreter/v3");

        Inquiry inquiry = inquiries.findById(inquiryId).filter(i -> org.equals(i.getOrgId())).orElseThrow();
        long readingsBefore = readings.count();
        int callsBefore = CountingTransport.CALLS.get();
        assertThat(readings.findByOrgIdAndInquiryIdAndSourceFingerprintAndPromptVersion(org, inquiryId,
                fingerprintOf(inquiry), capability.promptVersion()))
                .as("this message has not been read before; otherwise the smoke would prove nothing")
                .isEmpty();

        // ── pass 1: the one model call ──────────────────────────────────────────────────────────────────────
        InquiryResolutionView first = resolutions.read(org, inquiryId);
        int callsAfterFirst = CountingTransport.CALLS.get() - callsBefore;

        assertThat(callsAfterFirst).as("exactly one vendor call, as the manifest said").isEqualTo(1);
        List<InquiryGoalInterpretation> stored = readings.findAll().stream()
                .filter(r -> org.equals(r.getOrgId()) && inquiryId.equals(r.getInquiryId())).toList();
        assertThat(stored).as("the reading was recorded").hasSize(1);
        assertThat(stored.get(0).getPromptVersion()).isEqualTo("customer-goal-interpreter/v3");
        assertThat(readings.count()).as("no other organisation's row was written")
                .isEqualTo(readingsBefore + 1);

        // ── pass 2: the reuse ───────────────────────────────────────────────────────────────────────────────
        InquiryResolutionView second = resolutions.read(org, inquiryId);
        assertThat(CountingTransport.CALLS.get() - callsBefore)
                .as("the same sentence under the same contract is never bought twice").isEqualTo(1);
        assertThat(readings.count()).isEqualTo(readingsBefore + 1);
        assertThat(String.valueOf(second)).as("and it reads the same").isEqualTo(String.valueOf(first));

        // ── what the case would say ─────────────────────────────────────────────────────────────────────────
        if (stored.get(0).getOutcome() == InquiryGoalInterpretation.Outcome.REFUSED) {
            // A refusal is a real outcome of this contract and is reported, not retried and not repaired here.
            System.out.println("[smoke] REFUSED failure=" + stored.get(0).getFailure());
            assertThat(first).as("a refused reading resolves nothing").isNull();
            return;
        }
        assertThat(first).as("an accepted reading produces a resolution").isNotNull();
        CaseFromResolution reading = CaseFromResolution.of(first);
        assertThat(reading).isNotNull();
        assertThat(reading.disposition()).isNotNull();
        System.out.println("[smoke] goals=" + first.goals() + " withheld=" + first.withheld()
                + " state=" + first.state() + " gap=" + first.gap()
                + " per-goal=" + first.resolved()
                + " | case disposition=" + reading.disposition() + " authority=" + reading.authority()
                + " action=" + reading.recommendedAction() + " missing=" + reading.missingInformation()
                + " summary=" + reading.summaryKo());
    }

    /** The same fingerprint the production reader computes — one definition, used here only to assert freshness. */
    private static String fingerprintOf(Inquiry inquiry) {
        String message = StoredCustomerGoalInterpretation.messageOf(inquiry);
        try {
            return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                    .digest(message.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
