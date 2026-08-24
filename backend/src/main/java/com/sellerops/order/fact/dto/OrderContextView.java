package com.sellerops.order.fact.dto;

import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactState;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * The operational context card, in the seller's words.
 *
 * <p><b>Three separate states, and each may independently be "확인되지 않음".</b> A screen that shows
 * one "주문 상태" line teaches the reader that payment implies dispatch. This repository has
 * live-observed exactly one order status token in its history ({@code PAYED}); Coupang's
 * {@code DELIVERING} and {@code FINAL_DELIVERY} sit unconfirmed in {@code channel_orders} right now.
 * So the fulfillment line honestly says nothing, and saying nothing in its own row is what stops it
 * from being read off the payment row.
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
                paymentKo(fact), UNKNOWN, cancellationKo(fact), observedKo(fact));
    }

    private static String paymentKo(OrderFact fact) {
        return fact.normalized() == NormalizedOrderStatus.PAID ? "결제 완료" : UNKNOWN;
    }

    /**
     * Cancellation is only ever "취소됨" or unknown — never "취소되지 않음".
     *
     * <p>No stored status code proves a NEGATIVE. An order that was cancelled after our last read
     * looks exactly like one that was never cancelled, and printing "취소되지 않음" over that
     * ambiguity is how a customer gets told their cancelled order is live.
     */
    private static String cancellationKo(OrderFact fact) {
        return Boolean.TRUE.equals(fact.cancelled()) ? "취소됨" : UNKNOWN;
    }

    private static String observedKo(OrderFact fact) {
        return switch (fact.state()) {
            case OBSERVED_FRESH -> "방금 확인한 상태입니다.";
            case OBSERVED_FRESHNESS_UNPROVEN -> fact.asOf() == null
                    ? "마지막으로 확인한 시점을 알 수 없습니다."
                    : "마지막 확인 " + label(fact.asOf().atZone(KST).toLocalDate()) + " 기준입니다.";
            case ORDER_NOT_FOUND -> "이 주문을 아직 가져오지 않았습니다.";
            case SOURCE_UNAVAILABLE -> "현재 상태를 다시 확인할 수 없습니다.";
            case NO_ORDER_REFERENCE -> null;
        };
    }

    private static String label(LocalDate date) {
        return date.getMonthValue() + "월 " + date.getDayOfMonth() + "일";
    }
}
