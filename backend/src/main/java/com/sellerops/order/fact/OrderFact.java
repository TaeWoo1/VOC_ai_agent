package com.sellerops.order.fact;

import com.sellerops.coverage.ChannelDataState;
import com.sellerops.order.NormalizedOrderStatus;
import java.time.Instant;
import java.time.LocalDate;

/**
 * The minimum operational truth about one order that a reply may be grounded in.
 *
 * <p><b>A projection, not a payload.</b> A marketplace order object carries the buyer's name, phone,
 * address, recipient, memo, and payment instrument. None of that answers "취소됐나요?" or "언제
 * 발송되나요?", and all of it would then be in a prompt, a log, and a draft. So this record names the
 * fields that answer operational questions and has no field for anything else — a projection cannot
 * leak what it has no room for.
 *
 * <p><b>No order identifier either.</b> The reference lives on the inquiry row where the join needs
 * it; it is not carried out here, because every consumer of this record — the drafter, the screen,
 * the coverage audit — answers a question about STATE and none of them needs the handle. The one
 * caller that does (the reader itself) has the inquiry.
 *
 * <p><b>Three states, deliberately separate.</b> Payment, cancellation and fulfillment are three
 * different facts and a customer asks about them one at a time. Folding them into one "status" is how
 * "결제완료" comes to be read as "발송 안 됨" — which is not implied by it and is sometimes false.
 *
 * @param state         whether this may be spoken about at all, and why not when it may not
 * @param channelState  the channel-level freshness axis this was derived from, kept because the
 *                      REMEDIES differ ({@code NOT_CONNECTED} → 연결해 주세요, {@code BLOCKED} →
 *                      연결이 끊겼습니다) even where the drafter's behaviour does not
 * @param channelCode   whose order this is; a claim about NAVER must be checkable as one
 * @param normalized    the canonical status, {@link NormalizedOrderStatus#UNKNOWN} whenever the raw
 *                      code was never live-observed. Fail-closed by construction: this repository has
 *                      observed {@code PAYED} and nothing else, so {@code DELIVERING} normalizes to
 *                      UNKNOWN rather than to a shipping meaning nobody proved
 * @param rawStatusCode the channel's own code, verbatim, so a later correction is possible without
 *                      re-collecting. Never shown to a customer and never sent to a model
 * @param cancelled     {@code TRUE}/{@code FALSE} only when the channel's own state proves it;
 *                      {@code null} means unproven, which is NOT "not cancelled"
 * @param paidAt        when payment completed, when the channel said so
 * @param statusChangedAt when the channel last moved this order
 * @param orderedAt     the KST calendar day the order belongs to
 * @param asOf          when SellerOps last SAW this row. The date a citation must carry when
 *                      {@code state} is {@link OrderFactState#OBSERVED_FRESHNESS_UNPROVEN}
 */
public record OrderFact(OrderFactState state,
                        ChannelDataState channelState,
                        String channelCode,
                        NormalizedOrderStatus normalized,
                        String rawStatusCode,
                        Boolean cancelled,
                        Instant paidAt,
                        Instant statusChangedAt,
                        LocalDate orderedAt,
                        Instant asOf) {

    /** No order, for the reason given. Every field that would describe an order is absent. */
    public static OrderFact unavailable(OrderFactState state, ChannelDataState channelState,
                                        String channelCode) {
        return new OrderFact(state, channelState, channelCode, null, null, null, null, null, null, null);
    }

    /** True when a draft may cite payment/fulfillment state at all. */
    public boolean available() {
        return state.hasObservation();
    }

    /**
     * The ONE sentence a drafter and a seller both read.
     *
     * <p><b>It is prose, not a code, and that is the payload floor.</b> What leaves for the model is
     * a Korean sentence about a state — never an order number, never a raw channel code, never a
     * timestamp. And when there is no fact, the sentence says which of the five reasons applies,
     * because a drafter told nothing about order state will reason about it from the customer's
     * message instead.
     *
     * <p><b>What it never says.</b> A delivery date. {@link NormalizedOrderStatus#PAID} means payment
     * completed and says nothing about dispatch; the sentence for it therefore states payment and
     * stops, and the prompt forbids the model from continuing it.
     */
    public String messageKo() {
        return switch (state) {
            case NO_ORDER_REFERENCE ->
                    "이 문의에는 주문 번호가 함께 오지 않아, 주문 상태를 근거로 쓰지 못했습니다.";
            case ORDER_NOT_FOUND ->
                    "이 문의가 가리키는 주문을 아직 가져오지 않아, 주문 상태를 근거로 쓰지 못했습니다.";
            case SOURCE_UNAVAILABLE ->
                    "이 채널의 주문 정보를 지금 확인할 수 없어, 주문 상태를 근거로 쓰지 못했습니다.";
            case OBSERVED_FRESH -> statusSentence() + " (현재 확인된 상태입니다.)";
            case OBSERVED_FRESHNESS_UNPROVEN -> statusSentence()
                    + " (" + observedOn() + " 확인 시점 기준이며, 이후 변경되었을 수 있습니다.)";
        };
    }

    /**
     * What the stored row actually proves, in the seller's words.
     *
     * <p>{@code UNKNOWN} is a sentence too. Coupang's per-order rows carry {@code DELIVERING} and
     * {@code FINAL_DELIVERY} and this repository has never live-confirmed what those tokens mean, so
     * the honest rendering is "상태 코드를 확인했지만 의미를 확정하지 못했습니다" — not a guess with a
     * Korean label on it.
     */
    private String statusSentence() {
        if (Boolean.TRUE.equals(cancelled)) {
            return "이 주문은 취소된 것으로 확인됩니다.";
        }
        return switch (normalized == null ? NormalizedOrderStatus.UNKNOWN : normalized) {
            case PAID -> "이 주문은 결제가 완료된 것으로 확인됩니다. 발송 여부는 확인되지 않았습니다.";
            case UNKNOWN -> "이 주문의 상태 코드를 확인했지만, 그 의미를 확정하지 못했습니다.";
        };
    }

    private String observedOn() {
        return asOf == null ? "마지막" : asOf.atZone(java.time.ZoneId.of("Asia/Seoul")).toLocalDate() + "";
    }
}
