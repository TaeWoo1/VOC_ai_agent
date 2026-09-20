package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.Authority;

/**
 * <b>What the customer asked this message to produce</b> (Inquiry v3.5).
 *
 * <p>A speech act, not a topic. Nothing here names shipping, exchange, refund, restock, a size number or a colour:
 * those are this seller's vocabulary, and a taxonomy built out of them stops being true the moment the product is sold
 * to someone who sells something else. What these four separate is the <b>kind of outcome requested</b>, which is a
 * property of the request and survives the domain.
 *
 * <p><b>Measured, not assumed.</b> These four were checked against all 72 frozen resolution goals
 * ({@code contracts/inquiry-customer-goal/v1}) before being fixed: 59 of 72 map with no judgment call, 13 need a
 * product-owner adjudication about <i>which</i> of the four they are, and <b>none needs a fifth value</b>. The 13 are
 * listed in {@code docs/inquiry_architecture_v35.md} §4 rather than guessed at here.
 *
 * <p><b>Why the boundary is here.</b> {@link #DECISION} and {@link #ACTION} are the pair the Resolution Planner could
 * not keep apart: asked whether an out-of-window exchange could be approved, it planned the approval <i>and</i> the
 * exchange, inventing a goal the customer had not asked for (WP-3.2 §10, reproduced under two prompt versions). They
 * are separated here because they are different requests — one asks for a judgment, the other asks for the world to
 * change — and because only {@link #ACTION} may reach a procedure.
 */
public enum RequestedOutcome {

    /** A fact that is true independently of this customer's order: a policy, a specification, how something is used. */
    INFORMATION(Authority.KNOWLEDGE),

    /** The current state of one bound entity — what it is <i>right now</i>, which no written fact can answer. */
    STATE_READ(Authority.ENTITY_STATE),

    /**
     * A judgment: may this be allowed, will you make an exception, what do you recommend. The customer asks to be
     * <b>told a decision</b>, and has not asked for the world to change.
     *
     * <p>Its first resolver is {@link Authority#KNOWLEDGE}, not {@link Authority#SELLER}: a written policy that already
     * decides the exception decides it here too. The seller is reached only when no such policy exists — see
     * {@link ResolutionPolicy}.
     */
    DECISION(Authority.KNOWLEDGE),

    /** The customer asked for external state to change, and that change is the outcome they want from this message. */
    ACTION(Authority.PROCEDURE);

    private final Authority firstResolver;

    RequestedOutcome(Authority firstResolver) {
        this.firstResolver = firstResolver;
    }

    /**
     * The authority whose resolver is asked <b>first</b>. Not the authority that will resolve it: only the resolver's
     * own observed result decides that, and no step after this one is planned before it is seen.
     */
    public Authority firstResolver() {
        return firstResolver;
    }

    /** Only an {@link #ACTION} may reach a procedure. The one rule that stands between a question and a side effect. */
    public boolean mayReachProcedure() {
        return this == ACTION;
    }
}
