package com.sellerops.order.fact;

import com.sellerops.coverage.ChannelDataState;
import com.sellerops.order.NormalizedOrderStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * The minimum operational truth about one order that a reply may be grounded in.
 *
 * <p><b>A projection, not a payload.</b> A marketplace order object carries the buyer's name, email,
 * phone, address, recipient, billing name, bank account holder, transaction ids and amounts — the
 * vendored Cafe24 contract lists all of them
 * ({@code docs/vendor/cafe24-admin-api/get-orders-order-id.md}). None of that answers "취소됐나요?"
 * or "언제 발송되나요?", and all of it would then be in a prompt, a log, and a draft. So this record
 * names the fields that answer operational questions and has no field for anything else — a
 * projection cannot leak what it has no room for.
 *
 * <p><b>No order identifier either.</b> The reference lives on the inquiry row where the join needs
 * it; it is not carried out here, because every consumer of this record — the drafter, the screen,
 * the coverage audit — answers a question about STATE and none of them needs the handle.
 *
 * <p><b>Three states, deliberately separate — and the platform agrees.</b> Cafe24 publishes
 * {@code paid}, {@code canceled} and {@code shipping_status} as three independent fields with three
 * independent vocabularies, each of the first two carrying a partial value. Folding them into one
 * "status" is how "결제완료" comes to be read as "발송 안 됨" — which is not implied by it and is
 * sometimes false.
 *
 * @param state         whether this may be spoken about at all, and why not when it may not
 * @param provenance    which source produced it; {@code null} when there is no fact. Decides whether
 *                      a NEGATIVE may be stated — see {@link OrderFactProvenance}
 * @param channelState  the channel-level freshness axis this was derived from, kept because the
 *                      REMEDIES differ ({@code NOT_CONNECTED} → 연결해 주세요, {@code BLOCKED} →
 *                      연결이 끊겼습니다) even where the drafter's behaviour does not
 * @param channelCode   whose order this is; a claim about NAVER must be checkable as one
 * @param payment       whether it is paid, per the source, or {@link OrderPaymentState#UNKNOWN}
 * @param cancellation  whether it is cancelled; {@link OrderCancellationState#NOT_CANCELLED} only
 *                      ever from an exact read
 * @param fulfillment   where it is on the way to the customer. Never a date
 * @param rawStatusCode the channel's own code, verbatim, so a later correction is possible without
 *                      re-collecting. Never shown to a customer and never sent to a model
 * @param paidAt        when payment completed, when the channel said so
 * @param cancelledAt   when the channel recorded the cancellation
 * @param statusChangedAt when the channel last moved this order
 * @param orderedAt     the KST calendar day the order belongs to
 * @param asOf          when SellerOps last SAW this order. The date a citation must carry when
 *                      {@code state} is {@link OrderFactState#OBSERVED_FRESHNESS_UNPROVEN}
 */
public record OrderFact(OrderFactState state,
                        OrderFactProvenance provenance,
                        ChannelDataState channelState,
                        String channelCode,
                        OrderPaymentState payment,
                        OrderCancellationState cancellation,
                        OrderFulfillmentState fulfillment,
                        String rawStatusCode,
                        Instant paidAt,
                        Instant cancelledAt,
                        Instant statusChangedAt,
                        LocalDate orderedAt,
                        Instant asOf) {

    /**
     * Compact constructor: the three states are never null, and a negative never survives a source
     * that may not state one.
     *
     * <p>The downgrade lives here, in the type, rather than in each caller. A future reader of
     * {@code channel_orders} that maps a newly-recognized code to {@code NOT_CANCELLED} would
     * otherwise ship a claim the stored path cannot support, and nothing would catch it.
     */
    public OrderFact {
        payment = payment == null ? OrderPaymentState.UNKNOWN : payment;
        cancellation = cancellation == null ? OrderCancellationState.UNKNOWN : cancellation;
        fulfillment = fulfillment == null ? OrderFulfillmentState.UNKNOWN : fulfillment;
        boolean mayStateNegatives = provenance != null && provenance.mayStateNegatives();
        if (cancellation == OrderCancellationState.NOT_CANCELLED && !mayStateNegatives) {
            cancellation = OrderCancellationState.UNKNOWN;
        }
        if (payment == OrderPaymentState.UNPAID && !mayStateNegatives) {
            payment = OrderPaymentState.UNKNOWN;
        }
    }

    /** No order, for the reason given. Every field that would describe an order is absent. */
    public static OrderFact unavailable(OrderFactState state, ChannelDataState channelState,
                                        String channelCode) {
        return new OrderFact(state, null, channelState, channelCode, null, null, null,
                null, null, null, null, null, null);
    }

    /** True when a draft may cite payment/cancellation/fulfillment state at all. */
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
     * <p><b>What it never says.</b> A delivery date. Payment completed says nothing about dispatch,
     * and 발송 준비 중 says nothing about when dispatch happens; the sentence states what the source
     * stated and stops, and the prompt forbids the model from continuing it.
     */
    public String messageKo() {
        return switch (state) {
            case NO_ORDER_REFERENCE ->
                    "이 문의에는 주문 번호가 함께 오지 않아, 주문 상태를 근거로 쓰지 못했습니다.";
            case ORDER_NOT_FOUND ->
                    "이 문의가 가리키는 주문을 찾지 못해, 주문 상태를 근거로 쓰지 못했습니다.";
            case SOURCE_UNAVAILABLE ->
                    "이 채널의 주문 정보를 지금 확인할 수 없어, 주문 상태를 근거로 쓰지 못했습니다.";
            case OBSERVED_FRESH -> statusSentence() + " (현재 확인된 상태입니다.)";
            case OBSERVED_FRESHNESS_UNPROVEN -> statusSentence()
                    + " (" + observedOn() + " 확인 시점 기준이며, 이후 변경되었을 수 있습니다.)";
        };
    }

    /**
     * What the source actually proved, in the seller's words — one clause per state proved, and an
     * explicit "확인되지 않았습니다" for fulfillment when it was not.
     *
     * <p><b>Silence about fulfillment has to be said out loud.</b> A sentence that states payment and
     * then stops is read as "so it has not shipped". It is the one inference a customer makes
     * unprompted, so the fulfillment clause is always present: either what the source proved, or
     * that it proved nothing.
     *
     * <p>When a source proved none of the three — Coupang's {@code DELIVERING} and
     * {@code FINAL_DELIVERY} sit in {@code channel_orders} with no live confirmation of what they
     * mean — the honest rendering is that the code was seen and not understood.
     */
    private String statusSentence() {
        if (!cancellation.isProven() && !payment.isProven() && !fulfillment.isProven()) {
            return "이 주문의 상태 코드를 확인했지만, 그 의미를 확정하지 못했습니다.";
        }
        StringBuilder out = new StringBuilder();
        if (cancellation.isProven()) {
            out.append(switch (cancellation) {
                case CANCELLED -> "이 주문은 취소된 것으로 확인됩니다.";
                case PARTIALLY_CANCELLED -> "이 주문은 일부가 취소된 것으로 확인됩니다.";
                default -> "이 주문은 취소되지 않은 것으로 확인됩니다.";
            });
        }
        if (payment.isProven()) {
            append(out, switch (payment) {
                case PAID -> "결제는 완료되었습니다.";
                case UNPAID -> "결제는 아직 완료되지 않았습니다.";
                default -> "결제는 일부만 완료되었습니다.";
            });
        }
        append(out, fulfillment.isProven() ? switch (fulfillment) {
            case AWAITING_SHIPMENT -> "발송은 아직 시작되지 않았습니다.";
            case IN_TRANSIT -> "현재 배송 중입니다.";
            case DELIVERED -> "배송이 완료되었습니다.";
            case ON_HOLD -> "발송이 보류된 상태입니다.";
            default -> "배송 확인을 기다리는 상태입니다.";
        } : "발송 상태는 확인되지 않았습니다.");
        return out.toString();
    }

    private static void append(StringBuilder out, String clause) {
        if (!out.isEmpty()) {
            out.append(' ');
        }
        out.append(clause);
    }

    private String observedOn() {
        return asOf == null ? "마지막" : asOf.atZone(ZoneId.of("Asia/Seoul")).toLocalDate() + "";
    }

    /** The stored-path mapping: one canonical status code becomes at most a payment claim. */
    public static OrderPaymentState paymentFrom(NormalizedOrderStatus normalized) {
        return normalized == NormalizedOrderStatus.PAID ? OrderPaymentState.PAID
                : OrderPaymentState.UNKNOWN;
    }
}
