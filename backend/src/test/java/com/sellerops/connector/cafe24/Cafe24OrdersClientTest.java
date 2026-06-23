package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Cafe24 Admin orders-list page reader: URL/params, Bearer header, parsing,
 * and the 429 → {@link Cafe24RateLimitedException} mapping — all against the
 * recording fake, so no test can reach the network.
 */
class Cafe24OrdersClientTest {

    private static final LocalDate START = LocalDate.parse("2026-06-09");
    private static final LocalDate END = LocalDate.parse("2026-06-23");

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24OrdersClient client = new Cafe24OrdersClient(http);

    @Test
    void buildsTheMallOrdersUrlWithWindowParamsAndBearer() {
        http.enqueue(FakeCafe24HttpClient.ordersOk());

        client.fetchPage("access-1", "samplemall", START, END, 1000, 0);

        FakeCafe24HttpClient.Sent sent = http.sent.get(0);
        assertThat(sent.method()).isEqualTo("GET");
        assertThat(sent.uri().toString())
                .startsWith("https://samplemall.cafe24api.com/api/v2/admin/orders?")
                .contains("start_date=2026-06-09")
                .contains("end_date=2026-06-23")
                .contains("date_type=order_date")
                .contains("limit=1000")
                .contains("offset=0");
        assertThat(sent.headers().get("Authorization")).isEqualTo("Bearer access-1");
    }

    @Test
    void parsesOrderRows() {
        http.enqueue(FakeCafe24HttpClient.ordersOk(
                FakeCafe24HttpClient.order("o1", "2026-06-20T10:00:00+09:00", "1000.00")));

        List<Cafe24OrderRow> rows = client.fetchPage("access-1", "samplemall", START, END, 1000, 0);

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).orderId()).isEqualTo("o1");
        assertThat(rows.get(0).orderDate()).isEqualTo("2026-06-20T10:00:00+09:00");
        assertThat(rows.get(0).paymentAmount()).isEqualTo("1000.00");
    }

    @Test
    void emptyOrdersArrayYieldsEmptyList() {
        http.enqueue(FakeCafe24HttpClient.ordersOk());
        assertThat(client.fetchPage("access-1", "samplemall", START, END, 1000, 0)).isEmpty();
    }

    @Test
    void non200Throws() {
        http.enqueue(new Cafe24HttpClient.Response(500, "{\"error\":\"boom\"}", Map.of()));
        assertThatThrownBy(() -> client.fetchPage("access-1", "samplemall", START, END, 1000, 0))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 500");
    }

    @Test
    void rateLimitedCarriesTheResumptionHint() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429("4"));
        assertThatThrownBy(() -> client.fetchPage("access-1", "samplemall", START, END, 1000, 0))
                .isInstanceOf(Cafe24RateLimitedException.class)
                .satisfies(e -> assertThat(((Cafe24RateLimitedException) e).retryAfterSeconds())
                        .isEqualTo(4));
    }

    @Test
    void malformedMallIdFailsClosedBeforeAnyHttp() {
        for (String bad : new String[] {null, "", "evil.example.com", "mall/../x", "MALL", "a b"}) {
            assertThatThrownBy(() -> client.fetchPage("access-1", bad, START, END, 1000, 0))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("mall_id");
        }
        assertThat(http.sent).isEmpty();
    }
}
