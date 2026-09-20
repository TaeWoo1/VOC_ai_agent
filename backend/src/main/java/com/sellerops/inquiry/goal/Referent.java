package com.sellerops.inquiry.goal;

/**
 * <b>What a goal is about</b> (Inquiry v3.5) — bound to something the runtime registry can identify, never a free
 * string the interpreter invented.
 *
 * <p>These are not new words. Each bound value is the {@code Scope} a capability of this deployment is already about,
 * and {@link ReferentRegistry} asserts the correspondence so the two cannot drift. What is new is only that a goal may
 * now <b>name</b> its referent instead of implying it through a chosen capability.
 *
 * <p><b>Extensibility is the registry's, not this enum's.</b> A deployment that sells something other than listings and
 * orders registers the referents it has; the contract above this enum — a goal names one referent, and the referent
 * decides which resolvers can be about it — does not change. {@link #UNRESOLVED} is what keeps that honest: a customer
 * may name a thing this deployment cannot identify, and saying so is a resolution outcome, not a parse failure.
 */
public enum Referent {

    /** The listing the message arrived on. */
    CURRENT_LISTING(true),

    /** Everything else this seller sells — the question is whether such a thing exists at all. */
    SELLER_CATALOGUE(true),

    /** The order this message is bound to. Binding is the registry's fact; a goal naming it does not create it. */
    CURRENT_ORDER(true),

    /** The selling organisation: its policies, its terms, how it operates. */
    ORGANIZATION(true),

    /**
     * The customer named a thing this deployment cannot identify — another listing by name, a past purchase, a product
     * that may not exist. <b>Not an error.</b> The goal is real and the referent is not bound, and a resolver that
     * cannot act on an unbound referent reports a gap rather than quietly resolving against the nearest thing it has.
     */
    UNRESOLVED(false);

    private final boolean bound;

    Referent(boolean bound) {
        this.bound = bound;
    }

    /** Whether the registry can identify this referent. {@link #UNRESOLVED} is the only one that cannot. */
    public boolean bound() {
        return bound;
    }
}
