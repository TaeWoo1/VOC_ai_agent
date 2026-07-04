package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Orchestration tests for {@link EsmInquiriesClient}. The success body is a
 * top-level JSON array (no pagination envelope), so a window is one call. All
 * fixtures are synthetic (no captured live response, no PII); the transport is a
 * recording fake, so no live URL or credential is exercised. INQUIRY is
 * official-doc confirmed but live-response unverified.
 */
class EsmInquiriesClientTest {

    private static final String BASE_URL = "https://example.test";
    private static final String AUTH = "Bearer test-token"; // synthetic, not a real credential

    private final RecordingEsmHttpClient http = new RecordingEsmHttpClient();
    private final EsmInquiriesClient client = new EsmInquiriesClient(http, BASE_URL);

    /** A synthetic success body: a top-level array with one inquiry row. */
    private static String oneItemArray(String messageNo) {
        return """
                [
                  {
                    "messageNo": "%s",
                    "qnaType": 1,
                    "goodsNo": "SKU-1",
                    "details": "문의 내용",
                    "informStatus": "미처리",
                    "receiveDate": "2026-06-03T09:00:00+09:00",
                    "reAsking": false
                  }
                ]
                """.formatted(messageNo);
    }

    @Test
    void oneWindowReturnsItemsAndIssuesOneCall() {
        http.enqueueOk(oneItemArray("INQ-1"));

        List<CanonicalInquiry> result = client.fetchRange(
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).externalId()).isEqualTo("INQ-1");
        assertThat(http.sent).hasSize(1);
        // No live URL: the call targets the synthetic base + provisional path only.
        assertThat(http.sent.get(0).uri().toString())
                .isEqualTo(BASE_URL + EsmInquiriesClient.INQUIRY_PATH);
    }

    @Test
    void multiWindowRangeSplitsIntoSevenDayWindowsOneCallEach() {
        // Jun 1..16 inclusive => 3 windows (7 + 7 + 2); one call each, no pagination.
        http.enqueueOk(oneItemArray("INQ-W1"));
        http.enqueueOk(oneItemArray("INQ-W2"));
        http.enqueueOk(oneItemArray("INQ-W3"));

        List<CanonicalInquiry> result = client.fetchRange(
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 16), null, null, null, AUTH);

        assertThat(result).extracting(CanonicalInquiry::externalId)
                .containsExactly("INQ-W1", "INQ-W2", "INQ-W3");
        assertThat(http.sent).hasSize(3);
        assertThat(http.sent.get(0).jsonBody()).contains("2026-06-01").contains("2026-06-07");
        assertThat(http.sent.get(1).jsonBody()).contains("2026-06-08").contains("2026-06-14");
        assertThat(http.sent.get(2).jsonBody()).contains("2026-06-15").contains("2026-06-16");
        // No pagination fields are emitted.
        assertThat(http.sent.get(0).jsonBody()).doesNotContain("page").doesNotContain("pageSize");
    }

    @Test
    void emptyArrayYieldsNoItems() {
        http.enqueueOk("[]");

        List<CanonicalInquiry> result = client.fetchRange(
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH);

        assertThat(result).isEmpty();
        assertThat(http.sent).hasSize(1);
    }

    @Test
    void malformedResponseThrowsWithoutLoggingRawBody() {
        http.enqueueOk("<<garbage-not-json secret-marker-9999>>");

        assertThatThrownBy(() -> client.fetchRange(
                        LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("문의 응답")
                .hasMessageNotContaining("secret-marker-9999");
    }

    @Test
    void nonSuccessStatusThrowsWithStatusOnlyNoBody() {
        http.enqueue(new EsmHttpClient.Response(500, "{\"error\":\"secret-marker-9999\"}", Map.of()));

        assertThatThrownBy(() -> client.fetchRange(
                        LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 500")
                .hasMessageNotContaining("secret-marker-9999");
    }

    @Test
    void failureBodyResultCodeIsSurfacedButNeverTheMessage() {
        http.enqueue(new EsmHttpClient.Response(
                400, "{\"resultCode\":4001,\"message\":\"secret-marker-9999\"}", Map.of()));

        assertThatThrownBy(() -> client.fetchRange(
                        LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 400")
                .hasMessageContaining("resultCode 4001")
                .hasMessageNotContaining("secret-marker-9999");
    }

    @Test
    void passesCallerSuppliedAuthorizationAndForwardsNumericFilters() {
        http.enqueueOk(oneItemArray("INQ-1"));

        client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), 1, 2, 3, AUTH);

        Map<String, String> headers = http.sent.get(0).headers();
        // The client forwards the caller's header verbatim; it derives no credential.
        assertThat(headers).containsEntry("Authorization", AUTH);
        assertThat(headers).containsEntry("Content-Type", "application/json");
        // Numeric filters are forwarded into the request body (never quoted strings).
        String body = http.sent.get(0).jsonBody();
        assertThat(body).contains("\"qnaType\":1");
        assertThat(body).contains("\"status\":2");
        assertThat(body).contains("\"type\":3");
    }

    @Test
    void omittedFiltersAreAbsentFromTheRequestBody() {
        http.enqueueOk(oneItemArray("INQ-1"));

        client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH);

        String body = http.sent.get(0).jsonBody();
        assertThat(body).contains("\"fromDate\":\"2026-06-01\"").contains("\"toDate\":\"2026-06-07\"");
        assertThat(body).doesNotContain("qnaType").doesNotContain("status").doesNotContain("type");
    }

    @Test
    void probeSinglePageIssuesExactlyOneRequestForASingleDayWindow() {
        http.enqueueOk(oneItemArray("INQ-1"));

        EsmHttpClient.Response response =
                client.probeSinglePage(LocalDate.of(2026, 6, 1), null, null, null, AUTH);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(http.sent).hasSize(1);
        String body = http.sent.get(0).jsonBody();
        // from == to: a single-day window, no window walk, no pagination fields.
        assertThat(body).contains("\"fromDate\":\"2026-06-01\"");
        assertThat(body).contains("\"toDate\":\"2026-06-01\"");
        assertThat(body).doesNotContain("page").doesNotContain("pageSize");
    }

    /** Drives fetchRange and returns the rate-limit exception it must throw. */
    private EsmInquiryRateLimitedException fetchExpectingRateLimit() {
        try {
            client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, null, AUTH);
        } catch (EsmInquiryRateLimitedException e) {
            return e;
        }
        throw new AssertionError("expected EsmInquiryRateLimitedException");
    }

    @Test
    void rateLimitedWithoutRetryAfterThrowsTypedExceptionWithNoHint() {
        http.enqueue(new EsmHttpClient.Response(429, "{\"trace\":\"secret-marker-9999\"}", Map.of()));

        EsmInquiryRateLimitedException e = fetchExpectingRateLimit();

        assertThat(e.retryAfterSeconds()).isNull();
        assertThat(e.retryAfterAt()).isEmpty();
        // Body never leaks into the message.
        assertThat(e.getMessage()).contains("429").doesNotContain("secret-marker-9999");
    }

    @Test
    void rateLimitedWithNumericRetryAfterCarriesSeconds() {
        http.enqueue(new EsmHttpClient.Response(429, "[]", Map.of("Retry-After", "30")));

        EsmInquiryRateLimitedException e = fetchExpectingRateLimit();

        assertThat(e.retryAfterSeconds()).isEqualTo(30);
    }

    @Test
    void rateLimitedWithHttpDateRetryAfterCarriesAbsoluteInstant() {
        http.enqueue(new EsmHttpClient.Response(
                429, "[]", Map.of("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT")));

        EsmInquiryRateLimitedException e = fetchExpectingRateLimit();

        assertThat(e.retryAfterSeconds()).isNull();
        assertThat(e.retryAfterAt()).contains(java.time.Instant.parse("2026-10-21T07:28:00Z"));
    }
}
