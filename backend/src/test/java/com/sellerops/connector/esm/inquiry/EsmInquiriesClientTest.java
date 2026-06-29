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
 * Orchestration tests for {@link EsmInquiriesClient}. All fixtures are synthetic
 * (no captured live response, no PII); the transport is a recording fake, so no
 * live URL or credential is exercised. INQUIRY remains NEEDS_VERIFICATION.
 */
class EsmInquiriesClientTest {

    private static final String BASE_URL = "https://example.test";
    private static final String AUTH = "Bearer test-token"; // synthetic, not a real credential

    private final RecordingEsmHttpClient http = new RecordingEsmHttpClient();
    private final EsmInquiriesClient client = new EsmInquiriesClient(http, BASE_URL);

    /** A synthetic one-item page with explicit paging metadata. */
    private static String page(String inquiryId, int totalCount, int pageNo, int pageSize) {
        return """
                {
                  "items": [
                    {
                      "inquiryId": "%s",
                      "qnaType": "PRODUCT",
                      "itemName": "테스트 상품",
                      "itemNo": "SKU-1",
                      "buyerId": "buyer-x",
                      "contents": "문의 내용",
                      "status": "미처리",
                      "regDate": "2026-06-03T09:00:00+09:00"
                    }
                  ],
                  "totalCount": %d,
                  "page": %d,
                  "pageSize": %d
                }
                """.formatted(inquiryId, totalCount, pageNo, pageSize);
    }

    @Test
    void oneWindowOnePageReturnsItemsAndIssuesOneCall() {
        http.enqueueOk(page("INQ-1", 1, 1, 50));

        List<CanonicalInquiry> result =
                client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, AUTH);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).externalId()).isEqualTo("INQ-1");
        assertThat(http.sent).hasSize(1);
        // No live URL: the call targets the synthetic base + provisional path only.
        assertThat(http.sent.get(0).uri().toString())
                .isEqualTo(BASE_URL + EsmInquiriesClient.INQUIRY_PATH);
    }

    @Test
    void multiPageWindowPaginatesUntilHasMoreIsFalse() {
        // totalCount 3, pageSize 2 => page 1 (2 items-worth) hasMore, page 2 stops.
        http.enqueueOk(page("INQ-1", 3, 1, 2));
        http.enqueueOk(page("INQ-2", 3, 2, 2));

        List<CanonicalInquiry> result =
                client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, AUTH);

        assertThat(result).extracting(CanonicalInquiry::externalId).containsExactly("INQ-1", "INQ-2");
        assertThat(http.sent).hasSize(2);
        // Page advanced on the second request.
        assertThat(http.sent.get(0).jsonBody()).contains("\"page\":1");
        assertThat(http.sent.get(1).jsonBody()).contains("\"page\":2");
    }

    @Test
    void multiWindowRangeSplitsIntoSevenDayWindows() {
        // Jun 1..16 inclusive => 3 windows (7 + 7 + 2); one page each.
        http.enqueueOk(page("INQ-W1", 1, 1, 50));
        http.enqueueOk(page("INQ-W2", 1, 1, 50));
        http.enqueueOk(page("INQ-W3", 1, 1, 50));

        List<CanonicalInquiry> result =
                client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 16), null, null, AUTH);

        assertThat(result).extracting(CanonicalInquiry::externalId)
                .containsExactly("INQ-W1", "INQ-W2", "INQ-W3");
        assertThat(http.sent).hasSize(3);
        assertThat(http.sent.get(0).jsonBody()).contains("2026-06-01").contains("2026-06-07");
        assertThat(http.sent.get(1).jsonBody()).contains("2026-06-08").contains("2026-06-14");
        assertThat(http.sent.get(2).jsonBody()).contains("2026-06-15").contains("2026-06-16");
    }

    @Test
    void emptyResponseYieldsNoItems() {
        http.enqueueOk("{\"items\": [], \"totalCount\": 0, \"page\": 1, \"pageSize\": 50}");

        List<CanonicalInquiry> result =
                client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, AUTH);

        assertThat(result).isEmpty();
        assertThat(http.sent).hasSize(1);
    }

    @Test
    void malformedResponseThrowsWithoutLoggingRawBody() {
        String rawBody = "<<garbage-not-json secret-marker-9999>>";
        http.enqueueOk(rawBody);

        assertThatThrownBy(() ->
                        client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, AUTH))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("문의 응답")
                .hasMessageNotContaining("secret-marker-9999");
    }

    @Test
    void nonSuccessStatusThrowsWithStatusOnlyNoBody() {
        http.enqueue(new EsmHttpClient.Response(500, "{\"error\":\"secret-marker-9999\"}", Map.of()));

        assertThatThrownBy(() ->
                        client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, AUTH))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 500")
                .hasMessageNotContaining("secret-marker-9999");
    }

    @Test
    void passesCallerSuppliedAuthorizationAndNeedsNoCredentialLogic() {
        http.enqueueOk(page("INQ-1", 1, 1, 50));

        client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), "PRODUCT", "미처리", AUTH);

        Map<String, String> headers = http.sent.get(0).headers();
        // The client forwards the caller's header verbatim; it derives no credential.
        assertThat(headers).containsEntry("Authorization", AUTH);
        assertThat(headers).containsEntry("Content-Type", "application/json");
        // Optional filters are forwarded into the request body.
        assertThat(http.sent.get(0).jsonBody()).contains("\"qnaType\":\"PRODUCT\"");
        assertThat(http.sent.get(0).jsonBody()).contains("\"status\":\"미처리\"");
    }

    @Test
    void probeSinglePageIssuesExactlyOneRequestAndDoesNotPaginate() {
        // The response advertises many more pages (totalCount 50, pageSize 1);
        // the probe must still fire exactly one call and never paginate.
        http.enqueueOk(page("INQ-1", 50, 1, 1));

        EsmHttpClient.Response response =
                client.probeSinglePage(LocalDate.of(2026, 6, 1), null, null, AUTH);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(http.sent).hasSize(1);
    }

    @Test
    void probeSinglePageEnforcesPageOnePageSizeOneAndSingleDayWindow() {
        http.enqueueOk(page("INQ-1", 1, 1, 1));

        client.probeSinglePage(LocalDate.of(2026, 6, 1), "PRODUCT", "처리완료", AUTH);

        String body = http.sent.get(0).jsonBody();
        assertThat(body).contains("\"page\":1");
        assertThat(body).contains("\"pageSize\":1");
        // from == to: a single-day window, no window walk.
        assertThat(body).contains("\"fromDate\":\"2026-06-01\"");
        assertThat(body).contains("\"toDate\":\"2026-06-01\"");
    }

    /** Drives fetchRange and returns the rate-limit exception it must throw. */
    private EsmInquiryRateLimitedException fetchExpectingRateLimit() {
        try {
            client.fetchRange(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 7), null, null, AUTH);
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
        http.enqueue(new EsmHttpClient.Response(429, "{}", Map.of("Retry-After", "30")));

        EsmInquiryRateLimitedException e = fetchExpectingRateLimit();

        assertThat(e.retryAfterSeconds()).isEqualTo(30);
    }

    @Test
    void rateLimitedWithHttpDateRetryAfterCarriesAbsoluteInstant() {
        http.enqueue(new EsmHttpClient.Response(
                429, "{}", Map.of("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT")));

        EsmInquiryRateLimitedException e = fetchExpectingRateLimit();

        assertThat(e.retryAfterSeconds()).isNull();
        assertThat(e.retryAfterAt()).contains(java.time.Instant.parse("2026-10-21T07:28:00Z"));
    }
}
