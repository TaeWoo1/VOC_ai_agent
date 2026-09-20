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
import java.util.List;
import java.util.Set;

/**
 * <b>The Plan Validator</b> (Inquiry v3 WP-2, narrowed in WP-3, closing semantics made explicit in WP-3.1) — code, not
 * model. Two jobs, kept apart:
 *
 * <ol>
 *   <li><b>Reject a plan that breaks the contract</b> ({@link Violation}). Any violation makes the whole plan invalid —
 *       the same fail-closed outcome as a planner that did not answer (NO_ANSWER_BASIS; the Case is the seller's).</li>
 *   <li><b>Record what cannot act here</b> ({@link StepAvailability}) — for every step of a valid plan, against the
 *       registry snapshot. <b>It never changes the plan</b>: a step the need semantically requires stays in it even when
 *       its capability is not available; it becomes a capability gap with a reason, and no other authority is put in its
 *       place. In particular {@link ResolutionPlan.Need#closingAuthority()} is never rewritten — an unresolvable
 *       resolution is recorded as unresolvable, never as a different resolution.</li>
 * </ol>
 *
 * <p><b>WP-3 removed seven codes</b> — fields on a non-entity step, an entity step without fields, a field of another
 * capability, a scope the capability is never about, a procedure without an effect, an effect on a non-procedure, a
 * dependency pointing at itself — because {@link ResolutionPlan.Step} became a sealed union whose constructors cannot
 * build them. A rule that describes an object that cannot exist is not a guard; it is a comment that runs.
 *
 * <p><b>WP-3.1 removed three more, for the same reason.</b> {@code NO_CLOSING_STEP},
 * {@code MULTIPLE_CLOSING_AUTHORITIES} and {@code PRECONDITION_AFTER_CLOSER} were all consequences of the closer being
 * something a reader worked out from step roles and step order. With {@link ResolutionPlan.Need#closingAuthority()}
 * declared as a single enum value, "no ending" and "two endings" are not writable at all, and "a precondition after its
 * closer" is not a statement the shape can make. What replaces them is one rule that could not exist before:
 * {@link Code#CLOSING_AUTHORITY_UNSUPPORTED} — a need must require at least one capability of the authority it says
 * resolves it.
 *
 * <p><b>WP-3.2 added one more, after auditing the gold rather than before:</b>
 * {@link Code#PROCEDURE_NOT_CLOSING}. All 7 frozen goals that require a procedure are resolved by PROCEDURE, with no
 * counterexample, so "a procedure carried as another authority's optional follow-up" describes nothing the gold says
 * and something the v2 shadow wrote 8 times.
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
        NO_STEPS, TOO_MANY_STEPS, DUPLICATE_STEP,
        /**
         * The need says an authority resolves it and requires no capability of that authority (WP-3.1).
         *
         * <p>This is the one relationship {@code closing_authority} does not make structural on its own: the field is
         * a closed enum, so it cannot name an authority that does not exist, but nothing in the shape forces the step
         * list to contain the thing that would do the resolving. "The seller's judgment resolves this" with no
         * {@code SELLER} step, or "a procedure resolves this" with nothing to run, is a plan naming an ending it never
         * asked for.
         */
        CLOSING_AUTHORITY_UNSUPPORTED,
        /**
         * A procedure resolves the need and the plan does not read the order it acts on (WP-3.1 restatement of
         * {@code PROCEDURE_WITHOUT_ORDER_PRECONDITION}). The rule is unchanged; only the word "precondition" left,
         * because roles did. Order still expresses order — the read is written before the procedure — but what makes
         * this a violation is the read's <b>absence</b>, never its position.
         */
        PROCEDURE_WITHOUT_ORDER_READ,
        /**
         * A plan requires a procedure and says something else resolves the need (WP-3.2).
         *
         * <p><b>Audited before it was written.</b> All 72 frozen gold goals were read: 7 contain a
         * {@code PROCEDURE.ORDER_ACTION} step and <b>all 7 are resolved by PROCEDURE</b> — zero counterexamples, in
         * either direction. So this is not a new opinion about what a plan may say; it is a property the gold already
         * has, made checkable.
         *
         * <p>What it forbids is a procedure carried as somebody else's <i>optional follow-up</i> — "the policy says
         * no, and then we would cancel it". An external state change is not a footnote to an answer: either
         * performing it is what the customer is asking for, in which case it resolves the need, or it is a thing that
         * might happen afterwards, in which case it is not this plan's business. The v2 shadow wrote that shape 8
         * times in 361 needs, when two authorities could still both close.
         *
         * <p><b>What it does NOT catch, stated so it is not mistaken for a fix:</b> a planner that invents a SECOND
         * NEED for the follow-up. Each need then satisfies this rule on its own. That is the {@code C6} residual of
         * the Candidate C smoke, it is over-splitting rather than a mis-shaped need, and no per-need rule can see it —
         * see docs/inquiry_architecture_v3_wp32.md §1.3.
         */
        PROCEDURE_NOT_CLOSING,
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
        // the declared resolution must be one the plan actually asked for
        if (need.closingSteps().isEmpty()) {
            v.add(new Violation(id, null, Code.CLOSING_AUTHORITY_UNSUPPORTED));
        }
        // a procedure that acts on an order must read that order — an absence rule, not a position rule
        if (need.closingAuthority() == Authority.PROCEDURE
                && steps.stream().noneMatch(s -> s.capability() == CapabilityId.ENTITY_ORDER)) {
            v.add(new Violation(id, null, Code.PROCEDURE_WITHOUT_ORDER_READ));
        }
        // …and a procedure is never somebody else's follow-up: requiring one means it is what resolves the need
        if (need.closingAuthority() != Authority.PROCEDURE
                && steps.stream().anyMatch(s -> s.capability().authority() == Authority.PROCEDURE)) {
            v.add(new Violation(id, null, Code.PROCEDURE_NOT_CLOSING));
        }
        List<String> seen = new ArrayList<>();
        for (int k = 0; k < steps.size(); k++) {
            ResolutionPlan.Step s = steps.get(k);
            String sig = s.capability() + "/" + s.scope();
            if (seen.contains(sig)) {
                v.add(new Violation(id, k, Code.DUPLICATE_STEP));
            }
            seen.add(sig);
        }
    }

    /**
     * The distinct authorities a need requires. <b>Not "who closes"</b> — that is
     * {@link ResolutionPlan.Need#closingAuthority()}, which is declared and never derived.
     */
    public static Set<Authority> requiredAuthorities(ResolutionPlan.Need need) {
        Set<Authority> out = EnumSet.noneOf(Authority.class);
        for (ResolutionPlan.Step s : need.steps()) {
            out.add(s.capability().authority());
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

    /**
     * <b>Unchanged in WP-3.1, deliberately.</b> The all-or-nothing last clause — one unreadable field marks the whole
     * step a gap — was measured in WP-3.1 §2, and the recommendation there is that the resolver, not the plan's field
     * list, should decide the minimum a need requires. That is a resolver change and it is not made here: this package
     * moves closing semantics and nothing else, so availability figures stay comparable across it.
     */
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
