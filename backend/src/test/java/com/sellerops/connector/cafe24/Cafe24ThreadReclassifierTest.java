package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.inquiry.Inquiry;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The repair, held to the same rule as the proof that justified it: it may only act on what the
 * source said about the exact rows it was told to ask about.
 *
 * <p>The tests that matter here are the ones about what it does <b>not</b> do — no date range, no
 * neighbour, no tombstone for a row the source stayed silent about, and no request past the cap.
 */
class Cafe24ThreadReclassifierTest {

    @Test
    @DisplayName("the request names exact article numbers and carries no window and no search")
    void theReadIsExactAndBounded() {
        FakeCafe24HttpClient http = new FakeCafe24HttpClient();
        http.enqueue(articlesOk());
        new Cafe24BoardArticlesClient(http)
                .fetchByArticleNumbers("tok", "demomall", 6, List.of(246L, 247L, 248L));

        URI uri = http.sent.get(0).uri();
        assertThat(uri.getPath()).isEqualTo("/api/v2/admin/boards/6/articles");
        assertThat(uri.getQuery()).contains("article_no=246,247,248");
        assertThat(uri.getQuery())
                .as("a date range is a history crawl; this read is a list of rows we already have")
                .doesNotContain("start_date").doesNotContain("end_date").doesNotContain("offset")
                .doesNotContain("search").doesNotContain("keyword");
    }

    @Test
    @DisplayName("a malformed article number stops the call rather than widening the read")
    void aBadNumberFailsClosed() {
        assertThatThrownBy(() -> Cafe24BoardArticlesClient
                .articlesByNumberUri("demomall", 6, java.util.Arrays.asList(246L, null)))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> Cafe24BoardArticlesClient
                .articlesByNumberUri("demomall", 6, List.of(0L)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("only this board's keys are asked about — a foreign external id is not an article")
    void theKeyMustBeThisBoards() {
        assertThat(Cafe24ThreadReclassifier.articleNumber("cafe24:b6:a247", 6)).isEqualTo(247L);
        assertThat(Cafe24ThreadReclassifier.articleNumber("cafe24:b4:a247", 6))
                .as("board 4 is the review board and shares the article-number space")
                .isNull();
        assertThat(Cafe24ThreadReclassifier.articleNumber("esm:12345", 6)).isNull();
        assertThat(Cafe24ThreadReclassifier.articleNumber(null, 6)).isNull();
        assertThat(Cafe24ThreadReclassifier.articleNumber("cafe24:b6:a0", 6)).isNull();
    }

    @Test
    @DisplayName("a dry run reads, counts, and writes nothing")
    void dryRunWritesNothing() {
        FakeCafe24HttpClient http = new FakeCafe24HttpClient();
        http.enqueue(articlesOk(article(246L, null, 0), article(247L, 246L, 1)));
        Inquiry root = stored("cafe24:b6:a246");
        Inquiry child = stored("cafe24:b6:a247");

        var outcome = reclassifier(http).reclassify("tok", "demomall", 6,
                List.of(root, child), 20, 6, true);

        assertThat(outcome.reclassified()).isEqualTo(1);
        assertThat(outcome.confirmedRoot()).isEqualTo(1);
        assertThat(outcome.returned()).isEqualTo(2);
        assertThat(child.getThreadRole()).as("dry run means dry").isNull();
        assertThat(root.getThreadRole()).isNull();
    }

    @Test
    @DisplayName("a row the source did not return is left exactly as it was")
    void silenceChangesNothing() {
        FakeCafe24HttpClient http = new FakeCafe24HttpClient();
        http.enqueue(articlesOk(article(246L, null, 0)));
        Inquiry present = stored("cafe24:b6:a246");
        Inquiry absent = stored("cafe24:b6:a999");

        var outcome = reclassifier(http).reclassify("tok", "demomall", 6,
                List.of(present, absent), 20, 6, true);

        assertThat(outcome.unreturned()).isEqualTo(1);
        assertThat(absent.getThreadRole())
                .as("absence in one read is not a deletion and not a role")
                .isNull();
        assertThat(absent.getOperationalState())
                .isEqualTo(com.sellerops.inquiry.InquiryOperationalState.ACTIVE);
    }

    @Test
    @DisplayName("the request cap stops the sweep and says so")
    void theCapIsCheckedBeforeEveryCall() {
        FakeCafe24HttpClient http = new FakeCafe24HttpClient();
        http.enqueue(articlesOk(article(246L, null, 0)));
        List<Inquiry> rows = List.of(stored("cafe24:b6:a246"), stored("cafe24:b6:a247"),
                stored("cafe24:b6:a248"), stored("cafe24:b6:a249"));

        var outcome = reclassifier(http).reclassify("tok", "demomall", 6, rows, 1, 1, true);

        assertThat(http.sent).hasSize(1);
        assertThat(outcome.requests()).isEqualTo(1);
        assertThat(outcome.budgetExhausted()).isTrue();
    }

    private static Cafe24ThreadReclassifier reclassifier(FakeCafe24HttpClient http) {
        return new Cafe24ThreadReclassifier(new Cafe24BoardArticlesClient(http), null, null);
    }

    private static Inquiry stored(String externalId) {
        Inquiry inquiry = new Inquiry();
        inquiry.setExternalId(externalId);
        return inquiry;
    }

    private static Cafe24HttpClient.Response articlesOk(String... articles) {
        return new Cafe24HttpClient.Response(200,
                "{\"articles\":[" + String.join(",", articles) + "]}", Map.of());
    }

    private static String article(long articleNo, Long parentNo, int depth) {
        return "{\"article_no\":" + articleNo
                + ",\"parent_article_no\":" + (parentNo == null ? "null" : parentNo)
                + ",\"reply_depth\":" + depth
                + ",\"reply_sequence\":1"
                + ",\"created_date\":\"2026-06-20T10:00:00+09:00\"}";
    }
}
