package com.sellerops.proactive;

/**
 * How urgently a prepared case wants the seller's eyes.
 *
 * <p><b>Two, and both are explainable from operational facts.</b> There is no learned ranking and no
 * model confidence anywhere in this decision — a score a seller cannot interrogate is a score they
 * will stop trusting the first time it is wrong, and an LLM's confidence in its own draft says
 * nothing about whether a customer is waiting. {@link ProactiveReason} carries the fact each
 * priority comes from, so every card can answer "why is this at the top".
 */
public enum ProactivePriority {

    HIGH(0),
    NORMAL(1);

    private final int rank;

    ProactivePriority(int rank) {
        this.rank = rank;
    }

    /** Sort key, lower first. Stated explicitly so a future reorder cannot rearrange a worklist. */
    public int rank() {
        return rank;
    }
}
