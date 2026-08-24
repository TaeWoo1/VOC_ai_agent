package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.order.fact.ExactOrderObservation;
import com.sellerops.order.fact.ExactOrderReadOutcome;
import com.sellerops.order.fact.OrderCancellationState;
import com.sellerops.order.fact.OrderFulfillmentState;
import com.sellerops.order.fact.OrderPaymentState;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The exact single-order READ, against the recording fake — so no test reaches the network.
 *
 * <p>What is asserted here is the shape of ONE request and the translation of THREE fields. The
 * request shape matters as much as the mapping: an exact lookup that quietly grew a date range or an
 * embed would still pass a mapping test.
 */
class Cafe24ExactOrderReaderTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-08-25T02:00:00Z");

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24OrdersClient orders = new Cafe24OrdersClient(http);
    private final StubAuthorizer authorizer = new StubAuthorizer();
    private final Cafe24ExactOrderReader reader =
            new Cafe24ExactOrderReader(authorizer, orders, Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    @DisplayName("one order is one request, with no window, no page and no embed")
    void theRequestIsOneOrderAndNothingElse() {
        http.enqueue(ok("""
                {"order":{"order_id":"20260825-0000001","paid":"T","canceled":"F",
                 "shipping_status":"F","order_date":"2026-08-25T10:00:00+09:00"}}"""));

        reader.read(ORG, ACCOUNT, "20260825-0000001");

        assertThat(http.sent).hasSize(1);
        URI uri = http.sent.get(0).uri();
        assertThat(uri.toString())
                .isEqualTo("https://samplemall.cafe24api.com/api/v2/admin/orders/20260825-0000001");
        assertThat(uri.getQuery())
                .as("no embed, no fields, no date, no limit — a query string is where a lookup grows")
                .isNull();
        assertThat(http.sent.get(0).headers().get("Authorization")).isEqualTo("Bearer access-1");
    }

    @Test
    @DisplayName("the three state fields translate through three separate tables")
    void theThreeStatesAreReadSeparately() {
        http.enqueue(ok("""
                {"order":{"order_id":"o1","paid":"T","canceled":"F","shipping_status":"M",
                 "order_date":"2026-08-20T10:00:00+09:00","payment_date":"2026-08-20T10:05:00+09:00"}}"""));

        ExactOrderObservation observed = reader.read(ORG, ACCOUNT, "o1");

        assertThat(observed.outcome()).isEqualTo(ExactOrderReadOutcome.OK);
        assertThat(observed.payment()).isEqualTo(OrderPaymentState.PAID);
        assertThat(observed.cancellation()).isEqualTo(OrderCancellationState.NOT_CANCELLED);
        assertThat(observed.fulfillment())
                .as("T means paid and not-cancelled but DELIVERED; M means partial but IN TRANSIT")
                .isEqualTo(OrderFulfillmentState.IN_TRANSIT);
        assertThat(observed.observedAt()).isEqualTo(NOW);
        assertThat(observed.paidAt()).isEqualTo(Instant.parse("2026-08-20T01:05:00Z"));
    }

    @Test
    @DisplayName("the same letter means different things in different fields")
    void theSameLetterIsNotTheSameMeaning() {
        assertThat(Cafe24ExactOrderReader.payment("T")).isEqualTo(OrderPaymentState.PAID);
        assertThat(Cafe24ExactOrderReader.cancellation("T")).isEqualTo(OrderCancellationState.CANCELLED);
        assertThat(Cafe24ExactOrderReader.fulfillment("T")).isEqualTo(OrderFulfillmentState.DELIVERED);

        assertThat(Cafe24ExactOrderReader.payment("F")).isEqualTo(OrderPaymentState.UNPAID);
        assertThat(Cafe24ExactOrderReader.cancellation("F")).isEqualTo(OrderCancellationState.NOT_CANCELLED);
        assertThat(Cafe24ExactOrderReader.fulfillment("F"))
                .isEqualTo(OrderFulfillmentState.AWAITING_SHIPMENT);

        assertThat(Cafe24ExactOrderReader.payment("M")).isEqualTo(OrderPaymentState.PARTIALLY_PAID);
        assertThat(Cafe24ExactOrderReader.cancellation("M"))
                .isEqualTo(OrderCancellationState.PARTIALLY_CANCELLED);
        assertThat(Cafe24ExactOrderReader.fulfillment("M")).isEqualTo(OrderFulfillmentState.IN_TRANSIT);
    }

    @Test
    @DisplayName("an unrecognized token is unknown, never a nearby meaning")
    void anUnrecognizedTokenIsUnknown() {
        assertThat(Cafe24ExactOrderReader.payment("Z")).isEqualTo(OrderPaymentState.UNKNOWN);
        assertThat(Cafe24ExactOrderReader.cancellation(null)).isEqualTo(OrderCancellationState.UNKNOWN);
        assertThat(Cafe24ExactOrderReader.fulfillment("")).isEqualTo(OrderFulfillmentState.UNKNOWN);
    }

    @Test
    @DisplayName("a 404 is NOT_FOUND and every other failure is not")
    void failuresAreCategorized() {
        http.enqueue(new Cafe24HttpClient.Response(404, "{}", Map.of()));
        assertThat(reader.read(ORG, ACCOUNT, "o1").outcome()).isEqualTo(ExactOrderReadOutcome.NOT_FOUND);

        http.enqueue(new Cafe24HttpClient.Response(403, "{}", Map.of()));
        assertThat(reader.read(ORG, ACCOUNT, "o1").outcome())
                .isEqualTo(ExactOrderReadOutcome.UNAUTHORIZED);

        http.enqueue(new Cafe24HttpClient.Response(429, "{}", Map.of()));
        assertThat(reader.read(ORG, ACCOUNT, "o1").outcome())
                .isEqualTo(ExactOrderReadOutcome.RATE_LIMITED);

        http.enqueue(new Cafe24HttpClient.Response(500, "{}", Map.of()));
        assertThat(reader.read(ORG, ACCOUNT, "o1").outcome())
                .as("'we could not reach it' and 'it does not exist' lead a customer opposite ways")
                .isEqualTo(ExactOrderReadOutcome.TRANSPORT_ERROR);
    }

    @Test
    @DisplayName("an answer about a different order is not a fact about ours")
    void anEchoMismatchIsRefused() {
        http.enqueue(ok("""
                {"order":{"order_id":"SOMEONE-ELSE","paid":"T","canceled":"T","shipping_status":"T"}}"""));

        assertThat(reader.read(ORG, ACCOUNT, "o1").outcome())
                .isEqualTo(ExactOrderReadOutcome.TRANSPORT_ERROR);
    }

    @Test
    @DisplayName("an order id that is not a plain identifier is refused before any HTTP")
    void anUnexpectedOrderIdShapeFailsClosed() {
        assertThatThrownBy(() -> Cafe24OrdersClient.orderDetailUri("samplemall", "../orders?limit=1000"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> Cafe24OrdersClient.orderDetailUri("samplemall", ""))
                .isInstanceOf(IllegalStateException.class);

        assertThat(reader.read(ORG, ACCOUNT, "../orders?limit=1000").outcome())
                .isEqualTo(ExactOrderReadOutcome.TRANSPORT_ERROR);
        assertThat(http.sent).as("refused targets never become requests").isEmpty();
    }

    @Test
    @DisplayName("an unopenable connection is UNAUTHORIZED, and nothing about the order is claimed")
    void anAuthorizationFailureClaimsNothing() {
        authorizer.fail = true;

        ExactOrderObservation observed = reader.read(ORG, ACCOUNT, "o1");

        assertThat(observed.outcome()).isEqualTo(ExactOrderReadOutcome.UNAUTHORIZED);
        assertThat(observed.cancellation()).isNull();
        assertThat(http.sent).isEmpty();
    }

    @Test
    @DisplayName("a timezone-less mall timestamp stays unknown rather than being assumed KST")
    void aTimezonelessTimestampStaysUnknown() {
        http.enqueue(ok("""
                {"order":{"order_id":"o1","paid":"T","canceled":"F","shipping_status":"F",
                 "order_date":"2026-08-20 10:00:00","payment_date":"2026-08-20 10:00:00"}}"""));

        ExactOrderObservation observed = reader.read(ORG, ACCOUNT, "o1");

        assertThat(observed.paidAt()).isNull();
        assertThat(observed.orderedAt()).isNull();
    }

    @Test
    @DisplayName("the projection has no room for a person")
    void theProjectionHasNoRoomForAPerson() {
        http.enqueue(ok("""
                {"order":{"order_id":"o1","paid":"T","canceled":"F","shipping_status":"F",
                 "member_id":"buyer01","member_email":"a@b.co","billing_name":"홍길동",
                 "bank_account_owner_name":"홍길동","payment_amount":"39000.00",
                 "transaction_ids":["tx-1"],
                 "buyer":{"name":"홍길동","phone":"010-0000-0000"},
                 "receivers":[{"name":"홍길동","address1":"서울"}]}}"""));

        ExactOrderObservation observed = reader.read(ORG, ACCOUNT, "o1");

        assertThat(observed.ok()).isTrue();
        assertThat(observed.toString())
                .as("nothing a person could be identified by survives the parse boundary")
                .doesNotContain("홍길동")
                .doesNotContain("buyer01")
                .doesNotContain("a@b.co")
                .doesNotContain("39000")
                .doesNotContain("tx-1")
                .doesNotContain("010-");
        for (var component : ExactOrderObservation.class.getRecordComponents()) {
            assertThat(component.getName().toLowerCase())
                    .doesNotContain("buyer").doesNotContain("member").doesNotContain("name")
                    .doesNotContain("phone").doesNotContain("address").doesNotContain("email")
                    .doesNotContain("amount");
        }
    }

    private static Cafe24HttpClient.Response ok(String body) {
        return new Cafe24HttpClient.Response(200, body, Map.of());
    }

    /** Stands in for the vault-backed authorizer; no credential is involved in any test here. */
    private static final class StubAuthorizer extends Cafe24Authorizer {

        private boolean fail;

        private StubAuthorizer() {
            super(null, null, "", "");
        }

        @Override
        public Authorized authorize(UUID orgId, UUID sellerAccountId) {
            if (fail) {
                throw new IllegalStateException("connection unavailable");
            }
            return new Authorized("samplemall", "access-1");
        }
    }
}
