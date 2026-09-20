package com.sellerops.inquiry.resolution;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.ExecutionEffect;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>A resolution plan</b> (Inquiry v3; contract hardened in WP-3, closing semantics made explicit in WP-3.1): the
 * customer's atomic needs, and for each — <b>which authority resolves it</b>, and which capabilities that resolution
 * requires.
 *
 * <p><b>WP-3.1 removed the step role.</b> Until then a step said CLOSES, PRECONDITION or CONTEXT, and "which authority
 * ends this need" was something a reader worked out by looking at where the CLOSES steps were. Two rules — exactly one
 * closing authority, a precondition before its closer — together made <b>the last step written the closer</b>, and the
 * 67-call shadow of 2026-09-20 measured what that cost: all five of its wrong-closer goals have the authority the gold
 * requires present in the plan and demoted to PRECONDITION, with whatever was written last taking the ending. Two of
 * the five contain no SELLER at all, so this was never a seller-fallback problem — it was position deciding meaning.
 *
 * <p>So the ending is now <b>asked for directly</b>:
 *
 * <pre>
 *   need := { id, ask, closing_authority, steps[], customer_inputs[] }
 * </pre>
 *
 * <p>{@link Need#closingAuthority()} is the <b>single source of truth</b> for "who resolves this goal". There is no
 * step-level CLOSES any more, and deliberately so: a goal-level declaration beside a step-level one is two truths that
 * can disagree, and the disagreement would have to be resolved by a rule — which is how position became meaning in the
 * first place. <b>Array position cannot infer the closer</b>, because nothing reads position for that purpose;
 * {@link #closingSteps} derives the closers from the declared authority, and reordering a need's steps cannot change
 * what it returns.
 *
 * <p><b>What a step is now.</b> One capability this resolution requires, and the choices that capability actually has:
 *
 * <ul>
 *   <li>{@link Knowledge} — which knowledge, and (only for {@code KNOWLEDGE.CATALOGUE}, the one capability with two
 *       legal instances) whether it is about this listing or the catalogue.</li>
 *   <li>{@link Entity} — which entity and which of ITS fields to read.</li>
 *   <li>{@link Procedure} — the capability, and nothing else. What it does to the world is
 *       {@link CapabilityId#effect()}'s to say.</li>
 *   <li>{@link Seller} — the capability, and nothing else. A seller judgment is a required capability like any other.</li>
 * </ul>
 *
 * <p>Every constraint is a compact-constructor check, so a wrong-shaped step cannot be <i>constructed</i> rather than
 * merely refused, and the vendor-facing JSON schema is generated from the same declarations
 * ({@link ResolutionPlannerPrompt#schema}) so the two cannot drift.
 *
 * <p><b>Order still expresses order.</b> A step's place in the list is its place in the execution sequence — an
 * {@code ENTITY.ORDER} read stands before the procedure that changes that order. It expresses nothing else.
 *
 * <p><b>What a plan still never carries:</b> a customer input as an authority (it is a value a step needs), a past
 * answer (memory, not grounding — there is no capability for it), and availability. A plan says what the need REQUIRES;
 * whether this deployment can do it here is the validator's to record and never the plan's to adjust. In particular
 * <b>an unavailable capability does not change {@code closing_authority}</b>: it becomes a recorded capability gap, and
 * no other authority is put in its place.
 */
public record ResolutionPlan(List<Need> needs) {

    /** The instance each capability may be about. One declaration, read by the validator, the schema and the gold. */
    public static final Map<CapabilityId, Set<Scope>> SCOPES = scopes();

    public ResolutionPlan {
        needs = needs == null ? List.of() : List.copyOf(needs);
    }

    /**
     * @param ask              the need in the seller's words (≤120 chars, no personal data)
     * @param closingAuthority <b>who resolves this need</b> — the only thing in this record that says so
     * @param steps            the capabilities the resolution requires, in execution order
     * @param customerInputs   product-context values the answer depends on and the customer has not given
     */
    public record Need(String id, String ask, Authority closingAuthority, List<Step> steps,
                       List<CustomerInput> customerInputs) {
        public Need {
            if (closingAuthority == null) {
                throw new IllegalArgumentException("a need declares the authority that resolves it");
            }
            steps = steps == null ? List.of() : List.copyOf(steps);
            customerInputs = customerInputs == null ? List.of() : List.copyOf(customerInputs);
        }

        /**
         * The steps that close this need: those whose capability belongs to the declared closing authority. Several may
         * qualify and that is legitimate — the frozen gold has four goals where a listing's options and the product's
         * spec together answer one question, and both close.
         *
         * <p><b>Derived, never stored, and independent of order.</b> That is the whole point of WP-3.1: there is no
         * arrangement of the same steps that changes this answer.
         */
        public List<Step> closingSteps() {
            List<Step> out = new ArrayList<>();
            for (Step s : steps) {
                if (s.capability().authority() == closingAuthority) {
                    out.add(s);
                }
            }
            return List.copyOf(out);
        }
    }

    /** One capability a resolution requires. Sealed: the four shapes below are all there are. */
    public sealed interface Step permits Knowledge, Entity, Procedure, Seller {

        CapabilityId capability();

        /** Which instance this step is about — chosen only where the capability admits more than one. */
        Scope scope();

        /** The entity fields read. Empty for every step that is not an {@link Entity}, by shape and not by rule. */
        default List<EntityField> fields() {
            return List.of();
        }

        /** Registry metadata, surfaced here so a reader of a plan never has to look it up. */
        default ExecutionEffect effect() {
            return capability().effect();
        }
    }

    /** A fact the seller wrote down or taught. */
    public record Knowledge(CapabilityId capability, Scope scope) implements Step {
        public Knowledge {
            of(Authority.KNOWLEDGE, capability);
            if (!SCOPES.get(capability).contains(scope)) {
                throw new IllegalArgumentException(capability.wire() + " is never about " + scope);
            }
        }
    }

    /** The current state of one instance. The fields are the point of the step, so there is at least one. */
    public record Entity(CapabilityId capability, List<EntityField> fields) implements Step {
        public Entity {
            of(Authority.ENTITY_STATE, capability);
            fields = fields == null ? List.of() : List.copyOf(fields);
            if (fields.isEmpty()) {
                throw new IllegalArgumentException("an entity step names the fields it reads");
            }
            for (EntityField f : fields) {
                if (f.capability() != capability) {
                    throw new IllegalArgumentException(f + " is not " + capability.wire() + "'s field");
                }
            }
        }

        @Override
        public Scope scope() {
            return only(capability);
        }
    }

    /** Something the seller must DO about an order. Its effect is {@link CapabilityId#effect()}'s to state. */
    public record Procedure() implements Step {
        @Override
        public CapabilityId capability() {
            return CapabilityId.PROCEDURE_ORDER_ACTION;
        }

        @Override
        public Scope scope() {
            return Scope.THIS_ORDER;
        }
    }

    /**
     * A new seller judgment. <b>This is a required capability, not a fallback</b> — a plan that names it is saying the
     * resolution needs a judgment nobody has written down, which is a different claim from "nothing else worked".
     * Handing a case to the seller because a connector is missing or the knowledge is thin is a resolution outcome the
     * runtime records ({@link com.sellerops.inquiry.authority.ResolutionState#NEEDS_SELLER},
     * {@link com.sellerops.inquiry.authority.ResolutionState#CAPABILITY_GAP}) and never a plan.
     */
    public record Seller() implements Step {
        @Override
        public CapabilityId capability() {
            return CapabilityId.SELLER;
        }

        @Override
        public Scope scope() {
            return Scope.NONE;
        }
    }

    /** Which instance a step is about. Each capability admits only some ({@link #SCOPES}). */
    public enum Scope { THIS_LISTING, SELLER_CATALOGUE, THIS_ORDER, COMPANY, NONE }

    /** The one scope a single-instance capability is always about. */
    public static Scope only(CapabilityId capability) {
        Set<Scope> allowed = SCOPES.get(capability);
        if (allowed.size() != 1) {
            throw new IllegalArgumentException(capability.wire() + " has more than one instance; a step names it");
        }
        return allowed.iterator().next();
    }

    private static void of(Authority expected, CapabilityId capability) {
        if (capability == null || capability.authority() != expected) {
            throw new IllegalArgumentException(capability + " is not a " + expected + " step");
        }
    }

    private static Map<CapabilityId, Set<Scope>> scopes() {
        Map<CapabilityId, Set<Scope>> m = new EnumMap<>(CapabilityId.class);
        m.put(CapabilityId.KNOWLEDGE_PRODUCT, EnumSet.of(Scope.THIS_LISTING));
        m.put(CapabilityId.KNOWLEDGE_CATALOGUE, EnumSet.of(Scope.THIS_LISTING, Scope.SELLER_CATALOGUE));
        m.put(CapabilityId.KNOWLEDGE_ORG, EnumSet.of(Scope.COMPANY));
        m.put(CapabilityId.ENTITY_ORDER, EnumSet.of(Scope.THIS_ORDER));
        m.put(CapabilityId.ENTITY_LISTING, EnumSet.of(Scope.THIS_LISTING));
        m.put(CapabilityId.PROCEDURE_ORDER_ACTION, EnumSet.of(Scope.THIS_ORDER));
        m.put(CapabilityId.SELLER, EnumSet.of(Scope.NONE));
        return java.util.Collections.unmodifiableMap(m);
    }
}
