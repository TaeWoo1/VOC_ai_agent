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
 * The Plan Validator on every synthetic planner scenario: the twelve plans a planner should be able to produce, and the
 * eight a plan may never make. The availability column is what the registry says about a VALID plan — recorded, never
 * acted on.
 */
class ResolutionPlanValidatorScenarioTest {

    @Test
    @DisplayName("every valid plan validates, and each step's gap is what the registry says here")
    void validPlans() throws Exception {
        int checked = 0;
        for (JsonNode s : PlannerScenarios.all()) {
            if (!s.get("expect").get("valid").asBoolean()) {
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
        assertThat(checked).isEqualTo(12);
    }

    @Test
    @DisplayName("every plan a contract forbids is refused, with the reason — and nothing is repaired")
    void invalidPlans() throws Exception {
        int checked = 0;
        for (JsonNode s : PlannerScenarios.all()) {
            if (s.get("expect").get("valid").asBoolean()) {
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
        assertThat(checked).isEqualTo(8);
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
        assertThat(plan.needs().get(0).steps().stream().filter(x -> x.role() == ResolutionPlan.Role.CLOSES).count())
                .as("the closer is still the order, not the company rule beside it").isEqualTo(1);
    }
}
