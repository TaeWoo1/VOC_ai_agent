package com.sellerops.inquiry.authority;

/**
 * The capabilities a resolution plan may name — a closed list the registry owns and a model may only choose from
 * (strict schema enum). Wire ids ({@link #wire()}) are what plans, gold and the registry snapshot carry; the same list is
 * pinned in {@code contracts/inquiry-authority/v1/vocabulary.json} and a test keeps the two identical.
 *
 * <p><b>Each capability also declares what acting on it does</b> ({@link #effect()}, Inquiry v3 WP-3). The planner does
 * not say whether a step reads or writes; it says which capability the need requires, and the registry answers the rest.
 * See {@link ExecutionEffect}.
 */
public enum CapabilityId {
    KNOWLEDGE_PRODUCT(Authority.KNOWLEDGE, "KNOWLEDGE.PRODUCT"),
    KNOWLEDGE_ORG(Authority.KNOWLEDGE, "KNOWLEDGE.ORG"),
    KNOWLEDGE_CATALOGUE(Authority.KNOWLEDGE, "KNOWLEDGE.CATALOGUE"),
    ENTITY_ORDER(Authority.ENTITY_STATE, "ENTITY.ORDER"),
    ENTITY_LISTING(Authority.ENTITY_STATE, "ENTITY.LISTING"),
    /**
     * Anything the seller must DO about an order — change, remedy, re-send, notify later. Declared first-class and not
     * executable in v3.0 ({@link CapabilityStatus#DECLARED_NO_EXECUTOR}): it resolves to a capability gap, never to another
     * authority.
     */
    PROCEDURE_ORDER_ACTION(Authority.PROCEDURE, "PROCEDURE.ORDER_ACTION", ExecutionEffect.EXTERNAL_STATE_CHANGE),
    SELLER(Authority.SELLER, "SELLER");

    private final Authority authority;
    private final String wire;
    private final ExecutionEffect effect;

    CapabilityId(Authority authority, String wire) {
        this(authority, wire, ExecutionEffect.NONE);
    }

    CapabilityId(Authority authority, String wire, ExecutionEffect effect) {
        this.authority = authority;
        this.wire = wire;
        this.effect = effect;
    }

    public Authority authority() {
        return authority;
    }

    /**
     * What acting on this capability does outside this system — declared here, never planned by the model. The
     * product-owner invariant "a procedure is never used for a plain read" is upheld by this declaration: reading is what
     * the ENTITY_STATE capabilities do, and they declare {@link ExecutionEffect#NONE}.
     */
    public ExecutionEffect effect() {
        return effect;
    }

    public String wire() {
        return wire;
    }

    public static CapabilityId ofWire(String s) {
        for (CapabilityId c : values()) {
            if (c.wire.equals(s)) {
                return c;
            }
        }
        return null;
    }
}
