package com.sellerops.order.fact;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.coverage.ChannelDataState;
import com.sellerops.order.fact.OrderFactProvenance;
import com.sellerops.order.fact.OrderPaymentState;
import com.sellerops.order.fact.dto.OrderContextView;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** What the seller reads, and the four things it refuses to say. */
class OrderContextViewTest {

    @Test
    @DisplayName("an inquiry with no order renders nothing — an empty card would be a claim")
    void noReferenceRendersNothing() {
        OrderContextView view = OrderContextView.of(
                OrderFact.unavailable(OrderFactState.NO_ORDER_REFERENCE, null, "CAFE24"));

        assertThat(view.present()).isFalse();
        assertThat(view.summaryKo()).isNull();
    }

    @Test
    @DisplayName("a reference we could not resolve DOES render — the seller asked about an order")
    void anUnresolvedReferenceStillRenders() {
        OrderContextView view = OrderContextView.of(
                OrderFact.unavailable(OrderFactState.ORDER_NOT_FOUND, null, "CAFE24"));

        assertThat(view.present()).isTrue();
        assertThat(view.paymentKo()).isEqualTo("확인되지 않음");
        assertThat(view.observedKo()).isEqualTo("이 주문을 찾지 못했습니다.");
    }

    @Test
    @DisplayName("payment completed never fills the fulfillment line")
    void paymentDoesNotImplyDispatch() {
        OrderContextView view = OrderContextView.of(paid(OrderFactState.OBSERVED_FRESH, null));

        assertThat(view.paymentKo()).isEqualTo("결제 완료");
        assertThat(view.fulfillmentKo())
                .as("this repository has live-observed one status token and it is not a shipping one")
                .isEqualTo("확인되지 않음");
    }

    @Test
    @DisplayName("cancellation is never reported as \"취소되지 않음\"")
    void cancellationIsNeverNegated() {
        OrderContextView view = OrderContextView.of(paid(OrderFactState.OBSERVED_FRESH, null));

        assertThat(view.cancellationKo()).isEqualTo("확인되지 않음");
    }

    @Test
    @DisplayName("an unproven-freshness fact says when it was seen, in the seller's words")
    void staleFactsCarryTheirDate() {
        OrderContextView view = OrderContextView.of(
                paid(OrderFactState.OBSERVED_FRESHNESS_UNPROVEN, Instant.parse("2026-08-21T00:30:00Z")));

        assertThat(view.observedKo()).isEqualTo("마지막 확인 8월 21일 기준입니다.");
    }

    @Test
    @DisplayName("a blocked channel says the sentence a seller can act on")
    void aBlockedChannelSaysSo() {
        OrderContextView view = OrderContextView.of(OrderFact.unavailable(
                OrderFactState.SOURCE_UNAVAILABLE, ChannelDataState.BLOCKED, "NAVER"));

        assertThat(view.observedKo()).isEqualTo("현재 상태를 다시 확인할 수 없습니다.");
    }

    @Test
    @DisplayName("no developer enum and no identifier reaches a seller-visible string")
    void nothingRawIsShown() {
        OrderContextView view = OrderContextView.of(paid(OrderFactState.OBSERVED_FRESH, null));

        for (String shown : new String[] {view.summaryKo(), view.paymentKo(), view.fulfillmentKo(),
                view.cancellationKo(), view.observedKo()}) {
            assertThat(shown)
                    .doesNotContain("OBSERVED_")
                    .doesNotContain("PAYED")
                    .doesNotContain("PO-1")
                    .doesNotContain("NAVER");
        }
        assertThat(view.state()).as("the raw name travels for tests and diagnostics only")
                .isEqualTo("OBSERVED_FRESH");
    }

    private static OrderFact paid(OrderFactState state, Instant asOf) {
        return new OrderFact(state, OrderFactProvenance.STORED_CANONICAL,
                ChannelDataState.OBSERVED_FRESH, "NAVER",
                OrderPaymentState.PAID, null, null, "PAYED",
                Instant.parse("2026-08-21T00:00:00Z"), null, null,
                LocalDate.parse("2026-08-21"), asOf);
    }
}
