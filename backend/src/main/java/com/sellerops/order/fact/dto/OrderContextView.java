package com.sellerops.order.fact.dto;

import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactState;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * The operational context card, in the seller's words.
 *
 * <p><b>Three separate states, and each may independently be "확인되지 않음".</b> A screen that shows
 * one "주문 상태" line teaches the reader that payment implies dispatch. The channels themselves do
 * not claim that: Cafe24 publishes payment, cancellation and shipping as three fields, and this
 * repository has live-observed exactly one NAVER status token in its whole history ({@code PAYED}),
 * with Coupang's {@code DELIVERING} and {@code FINAL_DELIVERY} sitting unconfirmed in
 * {@code channel_orders} right now. So a line that was not proven says so in its own row, and saying
 * nothing in its own row is what stops it being read off a neighbour.
 *
 * <p><b>No identifier, no amount, no buyer.</b> Not the order number, not the recipient, not the
 * address, not the payment instrument. The card answers "이 문의가 가리키는 주문은 지금 어떤
 * 상태인가" and there is no field here for anything else.
 *
 * <p><b>No developer enum reaches the screen.</b> {@code state} travels for tests and for a
 * diagnostic surface; every string a seller reads is prose.
 *
 * @param present    false when this inquiry names no order at all — the screen renders NOTHING
 *                   rather than an empty card, because an empty card reads as "we looked and the
 *                   order has no state"
 * @param observedKo the freshness sentence, or the sentence that says freshness could not be proven
 */
public record OrderContextView(boolean present,
                               String state,
                               String summaryKo,
                               String paymentKo,
                               String fulfillmentKo,
                               String cancellationKo,
                               String observedKo) {

    private static final String UNKNOWN = "확인되지 않음";
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** The card for one fact, or the "render nothing" answer. */
    public static OrderContextView of(OrderFact fact) {
        if (fact == null || fact.state() == OrderFactState.NO_ORDER_REFERENCE) {
            return new OrderContextView(false, fact == null ? null : fact.state().name(),
                    null, null, null, null, null);
        }
        if (!fact.available()) {
            // A reference exists and the fact does not. The card appears — the seller asked about an
            // order and deserves to know we could not read it — and every state line is empty.
            return new OrderContextView(true, fact.state().name(), fact.messageKo(),
                    UNKNOWN, UNKNOWN, UNKNOWN, observedKo(fact));
        }
        return new OrderContextView(true, fact.state().name(), fact.messageKo(),
                or(fact.payment().labelKo()), or(fact.fulfillment().labelKo()),
                or(fact.cancellation().labelKo()), observedKo(fact));
    }

    /**
     * A label the source proved, or the words for "we do not know".
     *
     * <p>"취소되지 않음" appears here only when a channel positively said so, seconds ago, about this
     * order — {@code OrderFact}'s own constructor erases it otherwise. That distinction is invisible
     * on screen and it is the difference between reassuring a customer and guessing for them.
     */
    private static String or(String label) {
        return label == null ? UNKNOWN : label;
    }

    private static String observedKo(OrderFact fact) {
        return switch (fact.state()) {
            case OBSERVED_FRESH -> "방금 확인한 상태입니다.";
            case OBSERVED_FRESHNESS_UNPROVEN -> fact.asOf() == null
                    ? "마지막으로 확인한 시점을 알 수 없습니다."
                    : "마지막 확인 " + label(fact.asOf().atZone(KST).toLocalDate()) + " 기준입니다.";
            case ORDER_NOT_FOUND -> "이 주문을 찾지 못했습니다.";
            case SOURCE_UNAVAILABLE -> "현재 상태를 다시 확인할 수 없습니다.";
            case NO_ORDER_REFERENCE -> null;
        };
    }

    private static String label(LocalDate date) {
        return date.getMonthValue() + "월 " + date.getDayOfMonth() + "일";
    }
}
