package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Cafe24 Admin board-articles page reader: URL/board path/params, Bearer
 * header, parsing (incl. nullable tolerance), and the 429 → rate-limit / non-200
 * mappings — all against the recording fake, so no test can reach the network.
 */
class Cafe24BoardArticlesClientTest {

    private static final LocalDate START = LocalDate.parse("2026-04-01");
    private static final LocalDate END = LocalDate.parse("2026-06-25");

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24BoardArticlesClient client = new Cafe24BoardArticlesClient(http);

    @Test
    void buildsTheBoardArticlesUrlWithWindowParamsAndBearer() {
        http.enqueue(FakeCafe24HttpClient.articlesOk());

        client.fetchPage("access-1", "samplemall", 4, START, END, 50, 0);

        FakeCafe24HttpClient.Sent sent = http.sent.get(0);
        assertThat(sent.method()).isEqualTo("GET");
        assertThat(sent.uri().toString())
                .startsWith("https://samplemall.cafe24api.com/api/v2/admin/boards/4/articles?")
                .contains("start_date=2026-04-01")
                .contains("end_date=2026-06-25")
                .contains("limit=50")
                .contains("offset=0");
        assertThat(sent.headers().get("Authorization")).isEqualTo("Bearer access-1");
    }

    @Test
    void omitsDateParamsWhenNull() {
        http.enqueue(FakeCafe24HttpClient.articlesOk());

        client.fetchPage("access-1", "samplemall", 6, null, null, 50, 100);

        String uri = http.sent.get(0).uri().toString();
        assertThat(uri)
                .startsWith("https://samplemall.cafe24api.com/api/v2/admin/boards/6/articles?")
                .contains("limit=50")
                .contains("offset=100")
                .doesNotContain("start_date")
                .doesNotContain("end_date");
    }

    @Test
    void parsesArticleRows() {
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(1001L, "좋은 상품", "잘 쓰고 있어요", 77L, 5,
                        "2026-06-20T10:00:00+09:00", "N")));

        List<Cafe24BoardArticleRow> rows = client.fetchPage("access-1", "samplemall", 4, null, null, 50, 0);

        assertThat(rows).hasSize(1);
        Cafe24BoardArticleRow row = rows.get(0);
        assertThat(row.articleNo()).isEqualTo(1001L);
        assertThat(row.title()).isEqualTo("좋은 상품");
        assertThat(row.content()).isEqualTo("잘 쓰고 있어요");
        assertThat(row.productNo()).isEqualTo(77L);
        assertThat(row.rating()).isEqualTo(5);
        assertThat(row.createdDate()).isEqualTo("2026-06-20T10:00:00+09:00");
        assertThat(row.replyStatus()).isEqualTo("N");
    }

    @Test
    void toleratesNullableFields() {
        http.enqueue(FakeCafe24HttpClient.articlesOk(
                FakeCafe24HttpClient.article(2002L, null, null, null, null, null, null)));

        Cafe24BoardArticleRow row = client.fetchPage("access-1", "samplemall", 4, null, null, 50, 0).get(0);
        assertThat(row.articleNo()).isEqualTo(2002L);
        assertThat(row.title()).isNull();
        assertThat(row.content()).isNull();
        assertThat(row.productNo()).isNull();
        assertThat(row.rating()).isNull();
        assertThat(row.createdDate()).isNull();
        assertThat(row.replyStatus()).isNull();
    }

    @Test
    void emptyArticlesArrayYieldsEmptyList() {
        http.enqueue(FakeCafe24HttpClient.articlesOk());
        assertThat(client.fetchPage("access-1", "samplemall", 4, null, null, 50, 0)).isEmpty();
    }

    @Test
    void non200ThrowsWithoutLeakingBody() {
        http.enqueue(new Cafe24HttpClient.Response(500,
                "{\"article\":{\"content\":\"민감한 고객 본문\"}}", Map.of()));

        assertThatThrownBy(() -> client.fetchPage("access-1", "samplemall", 4, null, null, 50, 0))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 500")
                .hasMessageNotContaining("민감한 고객 본문");
    }

    @Test
    void rateLimitedCarriesTheResumptionHint() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429("5"));
        assertThatThrownBy(() -> client.fetchPage("access-1", "samplemall", 4, null, null, 50, 0))
                .isInstanceOf(Cafe24RateLimitedException.class)
                .satisfies(e -> assertThat(((Cafe24RateLimitedException) e).retryAfterSeconds())
                        .isEqualTo(5));
    }

    @Test
    void malformedMallIdFailsClosedBeforeAnyHttp() {
        for (String bad : new String[] {null, "", "evil.example.com", "mall/../x", "MALL", "a b"}) {
            assertThatThrownBy(() -> client.fetchPage("access-1", bad, 4, null, null, 50, 0))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("mall_id");
        }
        assertThat(http.sent).isEmpty();
    }

    @Test
    void invalidBoardNoFailsClosedBeforeAnyHttp() {
        for (int bad : new int[] {0, -1}) {
            assertThatThrownBy(() -> client.fetchPage("access-1", "samplemall", bad, null, null, 50, 0))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("board_no");
        }
        assertThat(http.sent).isEmpty();
    }
}
