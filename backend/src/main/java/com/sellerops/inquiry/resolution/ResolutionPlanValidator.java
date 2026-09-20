package com.sellerops.inquiry.resolution;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.CapabilityStatus;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.GapReason;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>The Plan Validator</b> (Inquiry v3 WP-2) — code, not model. Two jobs, kept apart:
 *
 * <ol>
 *   <li><b>Reject a plan that breaks the contract</b> ({@link Violation}). Any violation makes the whole plan invalid —
 *       the same fail-closed outcome as a planner that did not answer (NO_ANSWER_BASIS; the Case is the seller's).</li>
 *   <li><b>Record what cannot act here</b> ({@link StepAvailability}) — for every step of a valid plan, against the
 *       registry snapshot. <b>It never changes the plan</b>: a step the need semantically requires stays in it even when
 *       its capability is not available; it becomes a capability gap with a reason, and no other authority is put in its
 *       place.</li>
 * </ol>
 * Nothing here reads a sentence.
 */
public final class ResolutionPlanValidator {

    public static final int MAX_NEEDS = 6;
    public static final int MAX_STEPS = 3;

    /** The instance each capability may be about — pinned in {@code vocabulary.json} {@code scope_by_capability}. */
    public static final Map<CapabilityId, Set<ResolutionPlan.Scope>> SCOPES = scopes();

    private ResolutionPlanValidator() {
    }

    public enum Code {
        NO_NEEDS, TOO_MANY_NEEDS, NEED_ID_ORDER, EMPTY_ASK,
        NO_STEPS, TOO_MANY_STEPS, NO_CLOSING_STEP, DUPLICATE_STEP,
        SCOPE_MISMATCH, FIELDS_ON_NON_ENTITY, ENTITY_WITHOUT_FIELDS, FIELD_OF_OTHER_CAPABILITY,
        /** A PROCEDURE with effect NONE — reading state is ENTITY_STATE, never a procedure. */
        PROCEDURE_WITHOUT_EFFECT,
        EFFECT_ON_NON_PROCEDURE,
        /** A procedure that acts on an order must read that order first. */
        PROCEDURE_WITHOUT_ORDER_PRECONDITION,
        BAD_DEPENDENCY,
        /** Identity asked of the customer — refused on every surface in v3.0 (public Q&A by product-owner decision). */
        IDENTITY_INPUT,
        /** The v2 bridge's placeholder; a plan names the input. */
        UNNAMED_INPUT,
        DUPLICATE_INPUT
    }

    public record Violation(String need, Integer step, Code code) {
    }

    /** Where one step of a valid plan stands on this snapshot. {@code gap} is null when the capability can act. */
    public record StepAvailability(String need, int step, CapabilityId capability, GapReason gap,
                                   List<EntityField> unavailableFields) {
        public StepAvailability {
            unavailableFields = unavailableFields == null ? List.of() : List.copyOf(unavailableFields);
        }
    }

    public record Result(List<Violation> violations, List<StepAvailability> availability) {
        public boolean valid() {
            return violations.isEmpty();
        }
    }

    public static Result validate(ResolutionPlan plan, CapabilitySnapshot snapshot) {
        List<Violation> v = new ArrayList<>();
        if (plan == null || plan.needs().isEmpty()) {
            v.add(new Violation(null, null, Code.NO_NEEDS));
            return new Result(List.copyOf(v), List.of());
        }
        if (plan.needs().size() > MAX_NEEDS) {
            v.add(new Violation(null, null, Code.TOO_MANY_NEEDS));
        }
        for (int i = 0; i < plan.needs().size(); i++) {
            ResolutionPlan.Need need = plan.needs().get(i);
            String id = need.id();
            if (!("N" + (i + 1)).equals(id)) {
                v.add(new Violation(id, null, Code.NEED_ID_ORDER));
            }
            if (need.ask() == null || need.ask().isBlank()) {
                v.add(new Violation(id, null, Code.EMPTY_ASK));
            }
            steps(need, v);
            inputs(need, v);
        }
        if (!v.isEmpty()) {
            return new Result(List.copyOf(v), List.of());
        }
        return new Result(List.of(), availability(plan, snapshot));
    }

    private static void steps(ResolutionPlan.Need need, List<Violation> v) {
        String id = need.id();
        List<ResolutionPlan.Step> steps = need.steps();
        if (steps.isEmpty()) {
            v.add(new Violation(id, null, Code.NO_STEPS));
            return;
        }
        if (steps.size() > MAX_STEPS) {
            v.add(new Violation(id, null, Code.TOO_MANY_STEPS));
        }
        if (steps.stream().noneMatch(s -> s.role() == ResolutionPlan.Role.CLOSES)) {
            v.add(new Violation(id, null, Code.NO_CLOSING_STEP));
        }
        List<String> seen = new ArrayList<>();
        for (int k = 0; k < steps.size(); k++) {
            ResolutionPlan.Step s = steps.get(k);
            String sig = s.capability() + "/" + s.scope() + "/" + s.role();
            if (seen.contains(sig)) {
                v.add(new Violation(id, k, Code.DUPLICATE_STEP));
            }
            seen.add(sig);
            if (!SCOPES.get(s.capability()).contains(s.scope())) {
                v.add(new Violation(id, k, Code.SCOPE_MISMATCH));
            }
            boolean entity = s.capability().authority() == Authority.ENTITY_STATE;
            if (!entity && !s.fields().isEmpty()) {
                v.add(new Violation(id, k, Code.FIELDS_ON_NON_ENTITY));
            }
            if (entity && s.fields().isEmpty()) {
                v.add(new Violation(id, k, Code.ENTITY_WITHOUT_FIELDS));
            }
            if (s.fields().stream().anyMatch(f -> f.capability() != s.capability())) {
                v.add(new Violation(id, k, Code.FIELD_OF_OTHER_CAPABILITY));
            }
            boolean procedure = s.capability().authority() == Authority.PROCEDURE;
            if (procedure && s.effect() == ResolutionPlan.Effect.NONE) {
                v.add(new Violation(id, k, Code.PROCEDURE_WITHOUT_EFFECT));
            }
            if (!procedure && s.effect() != ResolutionPlan.Effect.NONE) {
                v.add(new Violation(id, k, Code.EFFECT_ON_NON_PROCEDURE));
            }
            if (s.dependsOn() != null && (s.dependsOn() < 0 || s.dependsOn() >= k)) {
                v.add(new Violation(id, k, Code.BAD_DEPENDENCY));
            }
            if (procedure && s.role() == ResolutionPlan.Role.CLOSES && steps.stream().noneMatch(p ->
                    p.capability() == CapabilityId.ENTITY_ORDER && p.role() == ResolutionPlan.Role.PRECONDITION)) {
                v.add(new Violation(id, k, Code.PROCEDURE_WITHOUT_ORDER_PRECONDITION));
            }
        }
    }

    private static void inputs(ResolutionPlan.Need need, List<Violation> v) {
        Set<CustomerInput> seen = EnumSet.noneOf(CustomerInput.class);
        for (CustomerInput in : need.customerInputs()) {
            if (in.kind() == CustomerInput.Kind.IDENTITY) {
                v.add(new Violation(need.id(), null, Code.IDENTITY_INPUT));
            }
            if (in == CustomerInput.UNNAMED_PRODUCT_CONTEXT) {
                v.add(new Violation(need.id(), null, Code.UNNAMED_INPUT));
            }
            if (!seen.add(in)) {
                v.add(new Violation(need.id(), null, Code.DUPLICATE_INPUT));
            }
        }
    }

    /** Every step of a valid plan against the snapshot — recorded, never acted on. */
    private static List<StepAvailability> availability(ResolutionPlan plan, CapabilitySnapshot snapshot) {
        List<StepAvailability> out = new ArrayList<>();
        for (ResolutionPlan.Need need : plan.needs()) {
            for (int k = 0; k < need.steps().size(); k++) {
                ResolutionPlan.Step s = need.steps().get(k);
                out.add(new StepAvailability(need.id(), k, s.capability(), gapOf(s, snapshot),
                        s.fields().stream().filter(f -> snapshot == null
                                || snapshot.status(f) != CapabilityStatus.AVAILABLE).toList()));
            }
        }
        return List.copyOf(out);
    }

    static GapReason gapOf(ResolutionPlan.Step s, CapabilitySnapshot snapshot) {
        if (snapshot == null) {
            return GapReason.UNAVAILABLE;
        }
        CapabilityStatus status = snapshot.status(s.capability());
        GapReason byStatus = switch (status) {
            case AVAILABLE -> null;
            case DISABLED -> GapReason.DISABLED;
            case NOT_SUPPORTED -> GapReason.NOT_SUPPORTED;
            case DECLARED_NO_EXECUTOR -> GapReason.NOT_EXECUTABLE;
        };
        if (byStatus != null) {
            return byStatus;
        }
        if (s.capability() == CapabilityId.ENTITY_ORDER && !snapshot.orderBound()) {
            return GapReason.UNBOUND;
        }
        if (s.fields().stream().anyMatch(f -> snapshot.status(f) != CapabilityStatus.AVAILABLE)) {
            return GapReason.NOT_SUPPORTED;
        }
        return null;
    }

    private static Map<CapabilityId, Set<ResolutionPlan.Scope>> scopes() {
        Map<CapabilityId, Set<ResolutionPlan.Scope>> m = new EnumMap<>(CapabilityId.class);
        m.put(CapabilityId.KNOWLEDGE_PRODUCT, EnumSet.of(ResolutionPlan.Scope.THIS_LISTING));
        m.put(CapabilityId.KNOWLEDGE_CATALOGUE, EnumSet.of(ResolutionPlan.Scope.THIS_LISTING,
                ResolutionPlan.Scope.SELLER_CATALOGUE));
        m.put(CapabilityId.KNOWLEDGE_ORG, EnumSet.of(ResolutionPlan.Scope.COMPANY));
        m.put(CapabilityId.ENTITY_ORDER, EnumSet.of(ResolutionPlan.Scope.THIS_ORDER));
        m.put(CapabilityId.ENTITY_LISTING, EnumSet.of(ResolutionPlan.Scope.THIS_LISTING));
        m.put(CapabilityId.PROCEDURE_ORDER_ACTION, EnumSet.of(ResolutionPlan.Scope.THIS_ORDER));
        m.put(CapabilityId.SELLER, EnumSet.of(ResolutionPlan.Scope.NONE));
        return java.util.Collections.unmodifiableMap(m);
    }
}
