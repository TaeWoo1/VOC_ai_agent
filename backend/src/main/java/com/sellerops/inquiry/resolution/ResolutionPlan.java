package com.sellerops.inquiry.resolution;

import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.ExecutionEffect;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>A resolution plan</b> (Inquiry v3, contract hardened in WP-3): the customer's atomic needs, and for each the
 * authorities that must act on it, in order.
 *
 * <p><b>WP-3 changed what a step is.</b> Until then every step had the same six slots — capability, role, scope, fields,
 * effect, depends_on — and the instruction had to explain, in prose, which slots to leave empty for which capability. The
 * 201-call shadow measured what that cost: 35 of its 39 contract violations were a step filling a slot its own capability
 * has no use for, led by {@code fields} on {@code KNOWLEDGE.CATALOGUE} (15 of 201 plans). That is not a model that
 * misunderstands authority — its authority recall on those same calls was 1.000 — it is a shape that lets a correct
 * decision be written down wrongly.
 *
 * <p>So a step is now a <b>sealed union with one shape per capability class</b>, and a slot exists only where a choice
 * exists:
 *
 * <ul>
 *   <li>{@link Knowledge} — which knowledge, and (only for {@code KNOWLEDGE.CATALOGUE}, the one capability with two legal
 *       instances) whether it is about this listing or the catalogue. No fields, no effect.</li>
 *   <li>{@link Entity} — which entity and which of ITS fields to read. Its scope follows from the capability.</li>
 *   <li>{@link Procedure} — the role only. What the procedure does to the world is {@link CapabilityId#effect()}'s to
 *       say, not the planner's.</li>
 *   <li>{@link Seller} — the role only.</li>
 * </ul>
 *
 * <p>Every one of those constraints is a compact-constructor check, so a wrong-shaped step cannot be <i>constructed</i>,
 * not merely cannot be accepted: {@link ResolutionPlanValidator} has no code for "fields on a knowledge step" any more
 * because there is no such object. The vendor-facing JSON schema is generated from the same declarations
 * ({@link ResolutionPlannerPrompt#schema}), so the two cannot drift.
 *
 * <p><b>What a plan still never carries:</b> a customer input as an authority (it is a value a step needs), a past answer
 * (memory, not grounding — there is no capability for it), and availability. A plan says what the need REQUIRES; whether
 * this system can do it here is the validator's to record and never the plan's to adjust.
 *
 * <p><b>Order is the dependency.</b> A step's place in the list is its place in the sequence, and a PRECONDITION precedes
 * what it enables. The explicit {@code depends_on} index left the wire in WP-3: in the whole frozen gold it was used
 * exactly 7 times, on exactly the 7 procedure steps, and every one of them pointed at the {@code ENTITY.ORDER} read the
 * registry already requires before a procedure — so it carried no information a reader did not have, while being the one
 * integer a model could point at itself (and did, once in 201 calls).
 */
public record ResolutionPlan(List<Need> needs) {

    /** The instance each capability may be about. One declaration, read by the validator, the schema and the gold. */
    public static final Map<CapabilityId, Set<Scope>> SCOPES = scopes();

    public ResolutionPlan {
        needs = needs == null ? List.of() : List.copyOf(needs);
    }

    /**
     * @param ask            the need in the seller's words (≤120 chars, no personal data)
     * @param customerInputs product-context values the answer depends on and the customer has not given
     */
    public record Need(String id, String ask, List<Step> steps, List<CustomerInput> customerInputs) {
        public Need {
            steps = steps == null ? List.of() : List.copyOf(steps);
            customerInputs = customerInputs == null ? List.of() : List.copyOf(customerInputs);
        }
    }

    /** One authority acting on one need. Sealed: the four shapes below are all there are. */
    public sealed interface Step permits Knowledge, Entity, Procedure, Seller {

        CapabilityId capability();

        Role role();

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
    public record Knowledge(CapabilityId capability, Role role, Scope scope) implements Step {
        public Knowledge {
            of(Authority.KNOWLEDGE, capability, role);
            if (!SCOPES.get(capability).contains(scope)) {
                throw new IllegalArgumentException(capability.wire() + " is never about " + scope);
            }
        }
    }

    /** The current state of one instance. The fields are the point of the step, so there is at least one. */
    public record Entity(CapabilityId capability, Role role, List<EntityField> fields) implements Step {
        public Entity {
            of(Authority.ENTITY_STATE, capability, role);
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
    public record Procedure(Role role) implements Step {
        public Procedure {
            of(Authority.PROCEDURE, CapabilityId.PROCEDURE_ORDER_ACTION, role);
        }

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
     * A new seller judgment. <b>This is an authority, not a fallback</b> — see
     * {@link ResolutionPlanValidator.Code#MULTIPLE_CLOSING_AUTHORITIES}.
     */
    public record Seller(Role role) implements Step {
        public Seller {
            of(Authority.SELLER, CapabilityId.SELLER, role);
        }

        @Override
        public CapabilityId capability() {
            return CapabilityId.SELLER;
        }

        @Override
        public Scope scope() {
            return Scope.NONE;
        }
    }

    /** CLOSES may answer the need; PRECONDITION must be read before a closer; CONTEXT is read and never closes. */
    public enum Role { CLOSES, PRECONDITION, CONTEXT }

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

    private static void of(Authority expected, CapabilityId capability, Role role) {
        if (capability == null || capability.authority() != expected) {
            throw new IllegalArgumentException(capability + " is not a " + expected + " step");
        }
        if (role == null) {
            throw new IllegalArgumentException("a step has a role");
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
