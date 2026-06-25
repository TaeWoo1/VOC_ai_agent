package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Cafe24 Admin boards-list reader: URL, Bearer header, parsing, and the
 * 429 → {@link Cafe24RateLimitedException} mapping — all against the recording
 * fake, so no test can reach the network.
 */
class Cafe24BoardsClientTest {

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24BoardsClient client = new Cafe24BoardsClient(http);

    @Test
    void buildsTheMallBoardsUrlWithBearer() {
        http.enqueue(FakeCafe24HttpClient.boardsOk());

        client.list("access-1", "samplemall");

        FakeCafe24HttpClient.Sent sent = http.sent.get(0);
        assertThat(sent.method()).isEqualTo("GET");
        assertThat(sent.uri().toString())
                .isEqualTo("https://samplemall.cafe24api.com/api/v2/admin/boards");
        assertThat(sent.headers().get("Authorization")).isEqualTo("Bearer access-1");
    }

    @Test
    void parsesBoardRows() {
        http.enqueue(FakeCafe24HttpClient.boardsOk(
                FakeCafe24HttpClient.board(4, "상품 사용후기", "board"),
                FakeCafe24HttpClient.board(6, "상품 Q&A", "board")));

        List<Cafe24BoardRow> rows = client.list("access-1", "samplemall");

        assertThat(rows).hasSize(2);
        assertThat(rows.get(0).boardNo()).isEqualTo(4);
        assertThat(rows.get(0).boardName()).isEqualTo("상품 사용후기");
        assertThat(rows.get(0).boardType()).isEqualTo("board");
        assertThat(rows.get(1).boardNo()).isEqualTo(6);
        assertThat(rows.get(1).boardName()).isEqualTo("상품 Q&A");
    }

    @Test
    void emptyBoardsArrayYieldsEmptyList() {
        http.enqueue(FakeCafe24HttpClient.boardsOk());
        assertThat(client.list("access-1", "samplemall")).isEmpty();
    }

    @Test
    void non200Throws() {
        http.enqueue(new Cafe24HttpClient.Response(500, "{\"error\":\"boom\"}", Map.of()));
        assertThatThrownBy(() -> client.list("access-1", "samplemall"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 500");
    }

    @Test
    void rateLimitedCarriesTheResumptionHint() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429("4"));
        assertThatThrownBy(() -> client.list("access-1", "samplemall"))
                .isInstanceOf(Cafe24RateLimitedException.class)
                .satisfies(e -> assertThat(((Cafe24RateLimitedException) e).retryAfterSeconds())
                        .isEqualTo(4));
    }

    @Test
    void malformedMallIdFailsClosedBeforeAnyHttp() {
        for (String bad : new String[] {null, "", "evil.example.com", "mall/../x", "MALL", "a b"}) {
            assertThatThrownBy(() -> client.list("access-1", bad))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("mall_id");
        }
        assertThat(http.sent).isEmpty();
    }
}
