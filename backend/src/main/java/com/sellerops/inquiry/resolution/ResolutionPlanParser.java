package com.sellerops.inquiry.resolution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads a planner answer strictly (Inquiry v3 WP-2, per-capability shapes in WP-3). <b>One unknown token fails the whole
 * plan</b> — never a dropped step or a dropped need: a silently dropped step is an authority the runtime then never asks
 * for, which is the class of failure the v2.1 audit found in the judge's verdict set.
 *
 * <p>Failures use the same closed words as the rest of this capability:
 *
 * <ul>
 *   <li>{@code EMPTY} / {@code UNPARSEABLE} — nothing came back, or it was not the shape of a plan at all.</li>
 *   <li>{@code PLAN_SET} — a token this system does not know (a capability, field, role, scope or input outside the
 *       registry vocabulary).</li>
 *   <li>{@code PLAN_SHAPE} — <b>known tokens in a combination that cannot exist</b>: fields on a knowledge step, an
 *       entity step that reads nothing, a catalogue scope on an org step. Under the WP-3 strict schema a conforming
 *       vendor cannot produce one, so this word is how a non-conforming answer names itself instead of arriving as a
 *       vaguer {@code UNPARSEABLE}. It is kept separate precisely so that "the schema did not hold" is legible in a run
 *       artifact rather than inferred.</li>
 * </ul>
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
                Object step = step(s);
                if (step instanceof String failure) {
                    return Parsed.failed(failure);
                }
                parsedSteps.add((ResolutionPlan.Step) step);
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

    /** @return a {@link ResolutionPlan.Step}, or a failure word as a String. */
    private static Object step(JsonNode s) {
        CapabilityId capability = CapabilityId.ofWire(s.path("capability").asText(null));
        ResolutionPlan.Role role = enumOf(ResolutionPlan.Role.class, s.path("role").asText(null));
        if (capability == null || role == null) {
            return "PLAN_SET";
        }
        boolean entity = capability.authority() == Authority.ENTITY_STATE;
        boolean choosesScope = ResolutionPlan.SCOPES.get(capability).size() > 1;
        // A property a step's own shape does not own must not be there at all; a conforming strict answer never has one.
        if (!entity && s.has("fields")) {
            return "PLAN_SHAPE";
        }
        if (!choosesScope && s.has("scope")) {
            return "PLAN_SHAPE";
        }
        // Retired in WP-3: effect belongs to the registry, and step order is the dependency. An answer still carrying
        // one of these was written against the v2 contract, and reading it as a v3 plan would silently accept a claim
        // this schema no longer makes.
        if (s.has("effect") || s.has("depends_on")) {
            return "PLAN_SHAPE";
        }
        try {
            if (entity) {
                List<EntityField> fields = new ArrayList<>();
                for (JsonNode f : s.path("fields")) {
                    EntityField field = enumOf(EntityField.class, f.asText(null));
                    if (field == null) {
                        return "PLAN_SET";
                    }
                    fields.add(field);
                }
                return new ResolutionPlan.Entity(capability, role, fields);
            }
            return switch (capability.authority()) {
                case KNOWLEDGE -> {
                    ResolutionPlan.Scope scope = choosesScope
                            ? enumOf(ResolutionPlan.Scope.class, s.path("scope").asText(null))
                            : ResolutionPlan.only(capability);
                    yield scope == null ? "PLAN_SET" : new ResolutionPlan.Knowledge(capability, role, scope);
                }
                case PROCEDURE -> new ResolutionPlan.Procedure(role);
                case SELLER -> new ResolutionPlan.Seller(role);
                default -> "PLAN_SET";
            };
        } catch (IllegalArgumentException e) {
            // the shape's own constructor refused the combination — known words, impossible object
            return "PLAN_SHAPE";
        }
    }

    /** Serialises a plan back to the wire shape — for gold, replay and the offline scorer. */
    public static String write(ResolutionPlan plan) {
        ObjectNode root = MAPPER.createObjectNode();
        ArrayNode needs = root.putArray("needs");
        for (ResolutionPlan.Need n : plan.needs()) {
            ObjectNode need = needs.addObject();
            need.put("id", n.id()).put("ask", n.ask());
            ArrayNode steps = need.putArray("steps");
            for (ResolutionPlan.Step s : n.steps()) {
                ObjectNode step = steps.addObject();
                step.put("capability", s.capability().wire()).put("role", s.role().name());
                if (ResolutionPlan.SCOPES.get(s.capability()).size() > 1) {
                    step.put("scope", s.scope().name());
                }
                if (s.capability().authority() == Authority.ENTITY_STATE) {
                    ArrayNode fields = step.putArray("fields");
                    s.fields().forEach(f -> fields.add(f.name()));
                }
            }
            ArrayNode inputs = need.putArray("customer_inputs");
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
