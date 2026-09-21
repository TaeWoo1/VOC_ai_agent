package com.sellerops.inquiry.goal;

import com.sellerops.inquiry.authority.Authority;

/**
 * <b>What the customer asked this message to produce</b> (Inquiry v3.5).
 *
 * <p>A speech act, not a topic. Nothing here names shipping, exchange, refund, restock, a size number or a colour:
 * those are this seller's vocabulary, and a taxonomy built out of them stops being true the moment the product is sold
 * to someone who sells something else. What these three separate is the <b>kind of outcome requested</b>, which is a
 * property of the request and survives the domain.
 *
 * <h2>There were four, and the fourth was not a kind of outcome</h2>
 *
 * <p>v2 shipped {@code INFORMATION}, {@code STATE_READ}, {@code DECISION} and {@code ACTION}. The 67-case DEV
 * baseline (§25.11) measured outcome accuracy at <b>65.3%</b>, and 84% of every outcome error was one confusion:
 * {@code INFORMATION} answered where the gold said {@code DECISION}, or the reverse. Folding the two and recomputing
 * that same run gave <b>95.8%</b> with every referent, constraint and safety counter unchanged (§25.12).
 *
 * <p>That number alone would be a re-labelling. What makes the merge a contract change rather than an arithmetic
 * trick is that the pair was <b>not separating outcomes at all</b>: the sole runtime difference between them was one
 * conjunct in {@link ResolutionPolicy}, which dispatched the seller for a {@code DECISION} whose knowledge resolver
 * found nothing. And the frozen gold says what that dispatch is worth — <b>35 goals terminate
 * {@link com.sellerops.inquiry.authority.ResolutionState#NEEDS_SELLER} and 32 of them get there with no seller step
 * at all</b>, while the seller resolver closes 0 of 72. The distinction the fourth token carried was a step in a
 * trace, not a difference in what the customer asked for, nor in where the goal ended.
 *
 * <p><b>Why the boundary now sits where it does.</b> {@link #ANSWER} and {@link #ACTION} are the pair the Resolution
 * Planner could not keep apart: asked whether an out-of-window exchange could be approved, it planned the approval
 * <i>and</i> the exchange, inventing a goal the customer had not asked for (WP-3.2 §10, reproduced under two prompt
 * versions). They stay separated because they are different requests — one asks to be told something, the other asks
 * for the world to change — and because only {@link #ACTION} may reach a procedure. Merging {@code DECISION} into
 * {@code ANSWER} moves that boundary's load: every judgment request now sits on the answering side of the one line
 * that stands between a question and a side effect. Whether that costs anything is the question the fresh holdout of
 * §25.13 exists to measure, and it is measured on text this contract was not designed against.
 */
public enum RequestedOutcome {

    /**
     * The customer asked to be <b>told</b> something — a fact or a judgment, which are the same request as far as
     * this taxonomy is concerned. A specification, a policy, how something is used; and equally "may this be
     * allowed", "will you make an exception", "what do you recommend".
     *
     * <p>Its resolver is {@link Authority#KNOWLEDGE} for both halves, and that was already true of {@code DECISION}:
     * a written policy that decides an exception decides it here too. Where no policy decides it, the goal settles
     * at {@link com.sellerops.inquiry.authority.ResolutionState#NEEDS_SELLER} — the human-authority terminal, which
     * 32 of the gold's 35 such goals already reached without any seller dispatch. See {@link ResolutionPolicy}.
     *
     * <p><b>The customer has not asked for the world to change.</b> That is the whole of what separates this from
     * {@link #ACTION}, and it is not a property of the sentence's shape.
     */
    ANSWER(Authority.KNOWLEDGE),

    /** The current state of one bound entity — what it is <i>right now</i>, which no written fact can answer. */
    STATE_READ(Authority.ENTITY_STATE),

    /**
     * The customer asked for external state to change, and that change is the outcome they want from this message.
     *
     * <p><b>This token is not execution authority</b> (Inquiry v3.5 §25.10). It records a model's reading of a
     * sentence, and that reading has been measured wrong in the direction that matters: on a message requesting
     * nothing, the interpreter returned a single {@code ACTION} goal about the order (§25.7). Nothing downstream
     * can tell such a goal from a correct one — {@link RequestBasis} is read by no part of the resolution loop, so
     * an invented {@code ACTION}, a substituted one and a real one are the same object there.
     *
     * <p>So the safety property is not "the interpreter gets this right". It is that <b>an effectful capability is
     * reached only through an execution approval bound to the specific object</b>, and the current resolution loop
     * — which has no such seam — answers for observation and prerequisite discovery only. No such executor
     * exists today, and two tripwires in {@code ActionIsNotExecutionAuthorityTest} fail if one arrives without it.
     */
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
