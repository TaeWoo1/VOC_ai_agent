package com.sellerops.order.fact;

import com.sellerops.coverage.ChannelDataState;

/**
 * Whether this inquiry's order state may be spoken about — and when it may not, which of the five
 * different reasons applies.
 *
 * <p><b>Why not one boolean.</b> "주문 상태를 모른다" hides five situations that a seller must act on
 * differently: the customer never said which order; the channel says which and we never collected it;
 * we collected it and cannot prove it is current; the channel is disconnected; the channel does not
 * publish per-order state at all. A single {@code available=false} would send all five to the same
 * sentence, and four of them would be wrong.
 *
 * <p><b>The freshness half is not invented here.</b> {@link ChannelDataState} already owns the
 * vocabulary for "does this channel still tell us what is happening" and already refuses to let a
 * capability gap and a broken credential share a word. This enum adds only what that axis cannot
 * know, because it is per-inquiry rather than per-channel: whether a reference exists, and whether it
 * resolved.
 */
public enum OrderFactState {

    /**
     * A stored order matched exactly and its channel's collection is armed and current.
     *
     * <p>The only state whose fields may be stated as the order's state right now. Derived from
     * {@link ChannelDataState#OBSERVED_FRESH}.
     */
    OBSERVED_FRESH,

    /**
     * A stored order matched exactly and we cannot prove it is current.
     *
     * <p>The row is real and may be cited <b>with its own date</b> — "8월 21일 확인 시점 기준" — and
     * no sentence may imply it is today's state. Derived from
     * {@link ChannelDataState#OBSERVED_FRESHNESS_UNPROVEN}.
     */
    OBSERVED_FRESHNESS_UNPROVEN,

    /** The source named no order on this inquiry. Nothing to look up; not a failure. */
    NO_ORDER_REFERENCE,

    /**
     * The source named an order and no stored row matches it.
     *
     * <p>Explicitly NOT "the order does not exist". The collection window is bounded and this
     * org's per-order store covers four days while its inquiry backlog covers eleven years. An
     * absence here is our reach, not the world.
     */
    ORDER_NOT_FOUND,

    /**
     * The channel cannot be read for this right now — disconnected, reauth pending, or it publishes
     * no per-order state at all.
     *
     * <p>Collapses {@link ChannelDataState#NOT_CONNECTED} / {@link ChannelDataState#BLOCKED} /
     * {@link ChannelDataState#NOT_SUPPORTED} for the DRAFT's purposes, because the drafter may say
     * exactly the same thing (nothing) about all three. The seller-facing surface keeps them apart —
     * the remedies differ — through {@link OrderFact#channelState()}.
     */
    SOURCE_UNAVAILABLE;

    /** True only when a sentence may state this order's current state without a date qualifier. */
    public boolean mayStateAsCurrent() {
        return this == OBSERVED_FRESH;
    }

    /** True when a real stored row backs this fact and may be quoted, with its observation date. */
    public boolean hasObservation() {
        return this == OBSERVED_FRESH || this == OBSERVED_FRESHNESS_UNPROVEN;
    }

    /** The per-inquiry state that a matched row's channel freshness implies. */
    public static OrderFactState fromChannel(ChannelDataState channelState) {
        return switch (channelState) {
            case OBSERVED_FRESH -> OBSERVED_FRESH;
            // A matched row exists, so ZERO is not reachable here and would be a contradiction if it
            // were: a measured zero cannot coexist with a row we just read.
            case OBSERVED_FRESHNESS_UNPROVEN, ZERO -> OBSERVED_FRESHNESS_UNPROVEN;
            case NOT_SUPPORTED, NOT_CONNECTED, BLOCKED -> SOURCE_UNAVAILABLE;
        };
    }
}
