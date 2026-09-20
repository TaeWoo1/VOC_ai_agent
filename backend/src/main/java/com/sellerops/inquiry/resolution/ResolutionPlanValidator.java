package com.sellerops.inquiry.resolution;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.CapabilityStatus;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.GapReason;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * <b>The Plan Validator</b> (Inquiry v3 WP-2, narrowed in WP-3) — code, not model. Two jobs, kept apart:
 *
 * <ol>
 *   <li><b>Reject a plan that breaks the contract</b> ({@link Violation}). Any violation makes the whole plan invalid —
 *       the same fail-closed outcome as a planner that did not answer (NO_ANSWER_BASIS; the Case is the seller's).</li>
 *   <li><b>Record what cannot act here</b> ({@link StepAvailability}) — for every step of a valid plan, against the
 *       registry snapshot. <b>It never changes the plan</b>: a step the need semantically requires stays in it even when
 *       its capability is not available; it becomes a capability gap with a reason, and no other authority is put in its
 *       place.</li>
 * </ol>
 *
 * <p><b>WP-3 removed seven codes and added two.</b> The seven — fields on a non-entity step, an entity step without
 * fields, a field of another capability, a scope the capability is never about, a procedure without an effect, an effect
 * on a non-procedure, a dependency pointing at itself — are gone because {@link ResolutionPlan.Step} is now a sealed
 * union whose constructors cannot build them. A rule that describes an object that cannot exist is not a guard; it is a
 * comment that runs.
 *
 * <p>The two added are the ones no shape can express, because they are about the relationship <i>between</i> steps:
 * {@link Code#MULTIPLE_CLOSING_AUTHORITIES} and {@link Code#PRECONDITION_AFTER_CLOSER}.
 *
 * <p>Nothing here reads a sentence.
 */
public final class ResolutionPlanValidator {

    public static final int MAX_NEEDS = 6;
    public static final int MAX_STEPS = 3;

    private ResolutionPlanValidator() {
    }

    public enum Code {
        NO_NEEDS, TOO_MANY_NEEDS, NEED_ID_ORDER, EMPTY_ASK,
        NO_STEPS, TOO_MANY_STEPS, NO_CLOSING_STEP, DUPLICATE_STEP,
        /**
         * Two <b>different authorities</b> both said to close one need — "knowledge will answer, and if not, the seller".
         *
         * <p>This is the WP-3 separation of <b>seller authority</b> from <b>operational handoff</b>, and it is a rule
         * about closers rather than a ban on any pair of capabilities. A need is one question; if two kinds of answer
         * could each end it then nothing in the plan says which one IS the answer, and at runtime whichever resolves
         * first wins — which is the {@code 4181864b} shape (a company shipping policy standing in for an order's state)
         * with a different pair of authorities.
         *
         * <p><b>A genuine multi-authority plan is still expressible</b>, because it does not have two closers: read the
         * policy as a PRECONDITION, then let the SELLER decide the exception that closes the need. What is refused is the
         * plan that offers two endings.
         *
         * <p>Fallbacks — no knowledge, no capability, low model confidence, "hand it to the seller" — are not
         * authorities and do not belong in a plan at all: they are resolution outcomes
         * ({@link com.sellerops.inquiry.authority.ResolutionState#NEEDS_SELLER},
         * {@link com.sellerops.inquiry.authority.ResolutionState#CAPABILITY_GAP}) that the runtime records after the plan
         * has run. Two steps of the SAME authority may both close: the frozen gold does this four times, where a
         * listing's options and the product's spec together answer one question.
         */
        MULTIPLE_CLOSING_AUTHORITIES,
        /**
         * Order is the dependency in v3: a step that must be read before a closer is written before it. A PRECONDITION
         * standing after the step it enables contradicts the sequence the list itself states.
         */
        PRECONDITION_AFTER_CLOSER,
        /** A procedure that acts on an order must read that order first. */
        PROCEDURE_WITHOUT_ORDER_PRECONDITION,
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
        Set<Authority> closing = closingAuthorities(need);
        if (closing.isEmpty()) {
            v.add(new Violation(id, null, Code.NO_CLOSING_STEP));
        }
        if (closing.size() > 1) {
            v.add(new Violation(id, null, Code.MULTIPLE_CLOSING_AUTHORITIES));
        }
        int lastCloser = -1;
        for (int k = 0; k < steps.size(); k++) {
            if (steps.get(k).role() == ResolutionPlan.Role.CLOSES) {
                lastCloser = k;
            }
        }
        List<String> seen = new ArrayList<>();
        for (int k = 0; k < steps.size(); k++) {
            ResolutionPlan.Step s = steps.get(k);
            String sig = s.capability() + "/" + s.scope() + "/" + s.role();
            if (seen.contains(sig)) {
                v.add(new Violation(id, k, Code.DUPLICATE_STEP));
            }
            seen.add(sig);
            if (s.role() == ResolutionPlan.Role.PRECONDITION && lastCloser >= 0 && k > lastCloser) {
                v.add(new Violation(id, k, Code.PRECONDITION_AFTER_CLOSER));
            }
            if (s.capability().authority() == Authority.PROCEDURE && s.role() == ResolutionPlan.Role.CLOSES
                    && steps.stream().noneMatch(p -> p.capability() == CapabilityId.ENTITY_ORDER
                    && p.role() == ResolutionPlan.Role.PRECONDITION)) {
                v.add(new Violation(id, k, Code.PROCEDURE_WITHOUT_ORDER_PRECONDITION));
            }
        }
    }

    /** The distinct authorities a need says may end it. */
    public static Set<Authority> closingAuthorities(ResolutionPlan.Need need) {
        Set<Authority> out = new LinkedHashSet<>();
        for (ResolutionPlan.Step s : need.steps()) {
            if (s.role() == ResolutionPlan.Role.CLOSES) {
                out.add(s.capability().authority());
            }
        }
        return out;
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
}
