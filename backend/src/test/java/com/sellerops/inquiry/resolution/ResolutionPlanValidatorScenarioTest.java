package com.sellerops.inquiry.resolution;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.GapReason;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The Plan Validator on every synthetic planner scenario: the fourteen plans a planner should be able to produce, the
 * eight a plan may never make, and — new in WP-3 — the eight that <b>cannot be written down at all</b>. The availability
 * column is what the registry says about a VALID plan — recorded, never acted on.
 */
class ResolutionPlanValidatorScenarioTest {

    @Test
    @DisplayName("every valid plan validates, and each step's gap is what the registry says here")
    void validPlans() throws Exception {
        int checked = 0;
        for (JsonNode s : PlannerScenarios.all()) {
            if (!PlannerScenarios.expressible(s) || !s.get("expect").get("valid").asBoolean()) {
                continue;
            }
            String id = s.get("id").asText() + " — " + s.get("shape").asText();
            CapabilitySnapshot snapshot = PlannerScenarios.snapshot(s);
            ResolutionPlanValidator.Result r = ResolutionPlanValidator.validate(PlannerScenarios.plan(s), snapshot);
            assertThat(r.violations()).as(id).isEmpty();
            List<String> want = new ArrayList<>();
            s.get("expect").get("availability").forEach(x -> want.add(x.isNull() ? null : x.asText()));
            assertThat(r.availability().stream().map(a -> a.gap() == null ? null : a.gap().name()).toList())
                    .as(id + " availability").isEqualTo(want);
            checked++;
        }
        assertThat(checked).isEqualTo(25);
    }

    @Test
    @DisplayName("every plan a contract forbids is refused, with the reason — and nothing is repaired")
    void invalidPlans() throws Exception {
        int checked = 0;
        for (JsonNode s : PlannerScenarios.all()) {
            if (!PlannerScenarios.expressible(s) || s.get("expect").get("valid").asBoolean()) {
                continue;
            }
            String id = s.get("id").asText() + " — " + s.get("shape").asText();
            ResolutionPlanValidator.Result r = ResolutionPlanValidator.validate(PlannerScenarios.plan(s),
                    PlannerScenarios.snapshot(s));
            List<String> want = new ArrayList<>();
            s.get("expect").get("violations").forEach(x -> want.add(x.asText()));
            assertThat(r.violations().stream().map(v -> v.code().name()).toList())
                    .as(id).containsExactlyInAnyOrderElementsOf(want);
            assertThat(r.valid()).isFalse();
            assertThat(r.availability()).as(id + ": an invalid plan is not measured against the registry").isEmpty();
            checked++;
        }
        assertThat(checked).isEqualTo(5);
    }

    /**
     * The WP-3 claim, stated as a test: every shape that the 201-call shadow produced wrongly now fails to be a plan at
     * all. These rows do not reach the validator, and each names the violation code it used to need.
     */
    @Test
    @DisplayName("a wrong-shaped step is not refused — it cannot be written: the parser has no object to build")
    void inexpressiblePlans() throws Exception {
        int checked = 0;
        for (JsonNode s : PlannerScenarios.all()) {
            if (PlannerScenarios.expressible(s)) {
                continue;
            }
            String id = s.get("id").asText() + " — " + s.get("shape").asText();
            ResolutionPlanParser.Parsed parsed = PlannerScenarios.parse(s);
            assertThat(parsed.plan()).as(id + ": no plan object exists for this shape").isNull();
            assertThat(parsed.failure()).as(id).isEqualTo(s.get("expect").get("failure").asText());
            assertThat(s.get("expect").get("retired_code").asText())
                    .as(id + ": an X row records the v2 code it replaces").isNotBlank();
            checked++;
        }
        assertThat(checked).isEqualTo(13);
    }

    @Test
    @DisplayName("an unavailable capability stays in the plan: recorded as a gap, never swapped for another authority")
    void neverSubstitutes() throws Exception {
        JsonNode s = PlannerScenarios.all().stream().filter(x -> "P05".equals(x.get("id").asText())).findFirst()
                .orElseThrow();
        ResolutionPlan plan = PlannerScenarios.plan(s);
        ResolutionPlanValidator.Result r = ResolutionPlanValidator.validate(plan, PlannerScenarios.snapshot(s));
        assertThat(r.availability().get(0).gap()).isEqualTo(GapReason.UNBOUND);
        assertThat(plan.needs().get(0).steps().get(0).capability().wire()).isEqualTo("ENTITY.ORDER");
        assertThat(plan.needs().get(0).closingAuthority())
                .as("the declared resolution is unchanged by the gap: still the order, not the company rule beside it")
                .isEqualTo(com.sellerops.inquiry.authority.Authority.ENTITY_STATE);
    }
}
