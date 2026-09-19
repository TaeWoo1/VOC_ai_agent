package com.sellerops.inquiry.authority;

/**
 * The capabilities a resolution plan may name — a closed list the registry owns and a model may only choose from
 * (strict schema enum). Wire ids ({@link #wire()}) are what plans, gold and the registry snapshot carry; the same list is
 * pinned in {@code contracts/inquiry-resolution-plan/v1/vocabulary.json} and a test keeps the two identical.
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
    PROCEDURE_ORDER_ACTION(Authority.PROCEDURE, "PROCEDURE.ORDER_ACTION"),
    SELLER(Authority.SELLER, "SELLER");

    private final Authority authority;
    private final String wire;

    CapabilityId(Authority authority, String wire) {
        this.authority = authority;
        this.wire = wire;
    }

    public Authority authority() {
        return authority;
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
