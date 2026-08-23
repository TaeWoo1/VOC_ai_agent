package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 고객 문의 returns the buyer's NAME, and nothing here may keep it.
 *
 * <p><b>This is the first resource in the repository that offers one.</b> Cafe24's board articles,
 * Coupang's inquiry endpoint and the NAVER order flow all either omit buyer identity or were read
 * without projecting it, so "buyer PII is not persisted" has held so far by the shape of what was on
 * offer. {@code GET /v1/pay-user/inquiries} makes {@code customerName} a REQUIRED response field, so
 * from here the rule has to hold by construction instead.
 *
 * <p>Construction, here, means four separate things, and each has its own assertion below: the field
 * is not declared on the projection record; it is not in the canonical row; the log line carries
 * counts and never a row or a body; and a parse failure does not put the response into an exception
 * message. The last two are the ones a reviewer forgets — a log statement is the easiest way to
 * publish exactly the data the persistence layer was careful not to store.
 */
class NaverInquiryPrivacyFenceTest {

    private static final Path NAVER_MAIN = Paths.get("src/main/java/com/sellerops/connector/naver");

    /**
     * A whole count expression, removed before the fence looks at a log argument.
     *
     * <p>{@code page.rows().size()} is a number and is most of what these log lines are for. Banning
     * the word {@code rows} would make the fence say something it does not mean, and the next person
     * would weaken it rather than argue with it. Removing the counts first makes it say the real rule:
     * a log line may carry HOW MANY, never WHAT.
     */
    private static final Pattern COUNT_EXPRESSION =
            Pattern.compile("[A-Za-z0-9_.()]*\\.(size|length)\\(\\)");
    private static final String BASE_URL = "https://fake.naver.test";
    private static final String TOKEN = "tok-1";

    /** A response carrying every buyer/order field the official contract lists. */
    private static final String FULL_RESPONSE = "{\"last\":true,\"totalElements\":1,\"content\":[{"
            + "\"inquiryNo\":7001,\"category\":\"배송\",\"title\":\"배송 문의\","
            + "\"inquiryContent\":\"언제 오나요?\","
            + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
            + "\"answerContentId\":55,\"answerContent\":\"내일 출고됩니다.\",\"answerTemplateNo\":3,"
            + "\"answerRegistrationDateTime\":\"2026-08-22T11:00:00.000+09:00\",\"answered\":true,"
            + "\"orderId\":\"2026082112345\",\"productNo\":\"6473457700\","
            + "\"productOrderIdList\":\"2026082112345678,2026082112345679\","
            + "\"productName\":\"종이컵보관함\",\"productOrderOption\":\"화이트\","
            + "\"customerId\":\"buyer-77\",\"customerName\":\"홍길동\"}]}";

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final NaverCustomerInquiriesClient client = new NaverCustomerInquiriesClient(http, BASE_URL);

    private static NaverInquiryCursor.Lane lane() {
        return NaverInquiryCursor.Lane.starting("2026-08-10", "2026-08-24");
    }

    @Test
    @DisplayName("the buyer fields are not on the projection record at all")
    void whatIsNotProjectedCannotBePersistedLater() throws IOException {
        String source = Files.readString(NAVER_MAIN.resolve("NaverCustomerInquiriesClient.java"));
        String record = source.substring(source.indexOf("record CustomerInquiry("));

        // A field absent from the record is a field no later edit can accidentally start storing by
        // adding one line to a mapper — it would have to be re-declared here first, in this file,
        // under the comment that says why it is not.
        assertThat(record).doesNotContain("@JsonProperty(\"customerId\")");
        assertThat(record).doesNotContain("@JsonProperty(\"customerName\")");
        assertThat(record).doesNotContain("@JsonProperty(\"orderId\")");
        assertThat(record).doesNotContain("@JsonProperty(\"productOrderIdList\")");
    }

    @Test
    @DisplayName("a full response with a real buyer name produces a canonical row that has none of it")
    void theCanonicalRowCarriesNoBuyerIdentity() {
        http.enqueue(FakeNaverHttpClient.ok(FULL_RESPONSE));

        CanonicalInquiry row = client.fetchPage(TOKEN, lane()).rows().get(0);

        // Every field of the record, rendered — the assertion is about the whole row and not about the
        // fields someone remembered to check.
        String rendered = row.toString();
        assertThat(rendered).doesNotContain("홍길동").doesNotContain("buyer-77");
        assertThat(rendered).doesNotContain("2026082112345");
        assertThat(row.author()).isNull();
        // What it DOES carry is the operational content, so this is a fence and not an amputation.
        assertThat(row.body()).isEqualTo("언제 오나요?");
        assertThat(row.answerBody()).isEqualTo("내일 출고됩니다.");
        assertThat(row.productRef().externalProductId()).isEqualTo("6473457700");
    }

    @Test
    @DisplayName("no log statement in either inquiry client can carry a row or a response body")
    void theLogLinesCarryCountsAndNeverContent() throws IOException {
        Pattern logCall = Pattern.compile("log\\.(info|warn|error|debug)\\((.*?)\\);", Pattern.DOTALL);
        List<String> offenders = new ArrayList<>();

        for (Path source : javaSources()) {
            Matcher matcher = logCall.matcher(Files.readString(source));
            while (matcher.find()) {
                // A COUNT of rows is fine and is most of what these lines are for; the rule is about
                // content. Removing the size calls first is what makes the check say that, instead of
                // banning the word "rows" and being argued with later.
                String args = COUNT_EXPRESSION.matcher(matcher.group(2)).replaceAll("<count>");
                // A body, a parsed row, a content list or a canonical row in a log argument is the same
                // disclosure the persistence layer refused — through a different door.
                for (String forbidden : List.of("body()", ".content()", ".contents()", "rows()",
                        "parsed,", "response,", "inquiry,", "qna,")) {
                    if (args.contains(forbidden)) {
                        offenders.add(source.getFileName() + " → " + forbidden);
                    }
                }
            }
        }

        assertThat(offenders).as("a log line is not a safe place to put what storage refused").isEmpty();
    }

    @Test
    @DisplayName("a response that cannot be parsed does not travel in the exception message")
    void aParseFailureDoesNotEchoTheResponse() {
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"content\":[{\"customerName\":\"홍길동\",\"inquiryNo\": not-json"));

        assertThatThrownBy(() -> client.fetchPage(TOKEN, lane()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("네이버 고객 문의 응답을 해석할 수 없습니다.")
                .hasMessageNotContaining("홍길동");
    }

    @Test
    @DisplayName("an HTTP failure message carries the status code and nothing from the body")
    void anErrorStatusDoesNotEchoTheResponse() {
        http.enqueue(new NaverHttpClient.Response(500,
                "{\"message\":\"내부 오류\",\"customerName\":\"홍길동\"}", java.util.Map.of()));

        assertThatThrownBy(() -> client.fetchPage(TOKEN, lane()))
                .hasMessage("네이버 고객 문의 조회에 실패했습니다 (HTTP 500).")
                .hasMessageNotContaining("홍길동");
    }

    @Test
    @DisplayName("the recording HTTP fake masks bearer material even in a failed assertion")
    void evenTheTestHarnessDoesNotPrintCredentials() {
        http.enqueue(FakeNaverHttpClient.ok(FULL_RESPONSE));
        client.fetchPage(TOKEN, lane());

        assertThat(http.sent.get(0).toString()).doesNotContain(TOKEN).contains("<masked>");
    }

    private static List<Path> javaSources() throws IOException {
        try (Stream<Path> walk = Files.walk(NAVER_MAIN)) {
            return walk.filter(p -> p.toString().endsWith(".java")).toList();
        }
    }
}
