package com.sellerops.inquiry.resolution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads a planner answer strictly (Inquiry v3 WP-2). <b>One unknown token fails the whole plan</b> — never a dropped step
 * or a dropped need: a silently dropped step is an authority the runtime then never asks for, which is the class of
 * failure the v2.1 audit found in the judge's verdict set.
 *
 * <p>Failures use the same closed words as the rest of this capability: {@code UNPARSEABLE} for shape, {@code PLAN_SET}
 * for a token this system does not know.
 */
public final class ResolutionPlanParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Parsed(ResolutionPlan plan, String failure) {
        public static Parsed failed(String why) {
            return new Parsed(null, why);
        }
    }

    private ResolutionPlanParser() {
    }

    /** A transport-level failure carried in the same shape, so one record describes every unanswered call. */
    public static Parsed failed(String why) {
        return Parsed.failed(why);
    }

    public static Parsed parse(String content) {
        if (content == null || content.isBlank()) {
            return Parsed.failed("EMPTY");
        }
        JsonNode root;
        try {
            root = MAPPER.readTree(content);
        } catch (Exception e) {
            return Parsed.failed("UNPARSEABLE");
        }
        JsonNode needs = root.path("needs");
        if (!needs.isArray() || needs.isEmpty()) {
            return Parsed.failed("UNPARSEABLE");
        }
        List<ResolutionPlan.Need> out = new ArrayList<>();
        for (JsonNode n : needs) {
            String id = n.path("id").asText("").strip();
            String ask = n.path("ask").asText("").strip();
            if (id.isEmpty() || ask.isEmpty()) {
                return Parsed.failed("UNPARSEABLE");
            }
            if (ask.length() > ResolutionPlannerPrompt.MAX_ASK) {
                ask = ask.substring(0, ResolutionPlannerPrompt.MAX_ASK);
            }
            JsonNode steps = n.path("steps");
            if (!steps.isArray() || steps.isEmpty()) {
                return Parsed.failed("UNPARSEABLE");
            }
            List<ResolutionPlan.Step> parsedSteps = new ArrayList<>();
            for (JsonNode s : steps) {
                CapabilityId capability = CapabilityId.ofWire(s.path("capability").asText(null));
                ResolutionPlan.Role role = enumOf(ResolutionPlan.Role.class, s.path("role").asText(null));
                ResolutionPlan.Scope scope = enumOf(ResolutionPlan.Scope.class, s.path("scope").asText(null));
                ResolutionPlan.Effect effect = enumOf(ResolutionPlan.Effect.class, s.path("effect").asText(null));
                if (capability == null || role == null || scope == null || effect == null) {
                    return Parsed.failed("PLAN_SET");
                }
                List<EntityField> fields = new ArrayList<>();
                for (JsonNode f : s.path("fields")) {
                    EntityField field = enumOf(EntityField.class, f.asText(null));
                    if (field == null) {
                        return Parsed.failed("PLAN_SET");
                    }
                    fields.add(field);
                }
                JsonNode dep = s.path("depends_on");
                Integer dependsOn = dep.isIntegralNumber() ? dep.asInt() : null;
                if (!dep.isNull() && !dep.isMissingNode() && !dep.isIntegralNumber()) {
                    return Parsed.failed("UNPARSEABLE");
                }
                parsedSteps.add(new ResolutionPlan.Step(capability, role, scope, fields, effect, dependsOn));
            }
            List<CustomerInput> inputs = new ArrayList<>();
            for (JsonNode i : n.path("customer_inputs")) {
                CustomerInput input = enumOf(CustomerInput.class, i.asText(null));
                if (input == null) {
                    return Parsed.failed("PLAN_SET");
                }
                inputs.add(input);
            }
            out.add(new ResolutionPlan.Need(id, ask, parsedSteps, inputs));
        }
        return new Parsed(new ResolutionPlan(out), null);
    }

    /** Serialises a plan back to the wire shape — for gold, replay and the offline scorer. */
    public static String write(ResolutionPlan plan) {
        var root = MAPPER.createObjectNode();
        var needs = root.putArray("needs");
        for (ResolutionPlan.Need n : plan.needs()) {
            var need = needs.addObject();
            need.put("id", n.id()).put("ask", n.ask());
            var steps = need.putArray("steps");
            for (ResolutionPlan.Step s : n.steps()) {
                var step = steps.addObject();
                step.put("capability", s.capability().wire()).put("role", s.role().name()).put("scope", s.scope().name());
                var fields = step.putArray("fields");
                s.fields().forEach(f -> fields.add(f.name()));
                step.put("effect", s.effect().name());
                if (s.dependsOn() == null) {
                    step.putNull("depends_on");
                } else {
                    step.put("depends_on", s.dependsOn());
                }
            }
            var inputs = need.putArray("customer_inputs");
            n.customerInputs().forEach(i -> inputs.add(i.name()));
        }
        return root.toString();
    }

    private static <E extends Enum<E>> E enumOf(Class<E> type, String name) {
        if (name == null) {
            return null;
        }
        for (E e : type.getEnumConstants()) {
            if (e.name().equals(name.strip())) {
                return e;
            }
        }
        return null;
    }
}
