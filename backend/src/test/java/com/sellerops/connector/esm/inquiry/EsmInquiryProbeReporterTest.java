package com.sellerops.connector.esm.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.CountBucket;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.RegDateShape;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.RetryAfterForm;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.StatusClass;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Tests the redaction boundary: a raw probe response goes in, only sanitized
 * signals come out. All fixtures are synthetic (no live call, no real credential);
 * PII-bearing fields are seeded with {@code secret-marker-*} sentinels so any leak
 * is caught. INQUIRY remains NEEDS_VERIFICATION.
 */
class EsmInquiryProbeReporterTest {

    private final EsmInquiryProbeReporter reporter = new EsmInquiryProbeReporter();

    private static EsmHttpClient.Response ok(String body) {
        return new EsmHttpClient.Response(200, body, Map.of());
    }

    /** One synthetic row whose every PII-bearing field carries a unique sentinel. */
    private static final String ONE_ITEM = """
            {
              "items": [
                {
                  "inquiryId": "secret-marker-INQID",
                  "qnaType": "PRODUCT",
                  "itemName": "secret-marker-PRODUCT",
                  "itemNo": "secret-marker-ITEMNO",
                  "buyerId": "secret-marker-BUYER",
                  "contents": "secret-marker-CONTENTS",
                  "status": "처리완료",
                  "regDate": "2026-06-03T09:00:00+09:00"
                }
              ],
              "totalCount": 1, "page": 1, "pageSize": 1
            }
            """;

    @Test
    void recordsOnlySanitizedSignalsForASuccessfulPage() {
        EsmInquiryProbeReport r = reporter.report(ok(ONE_ITEM));

        assertThat(r.statusCode()).isEqualTo(200);
        assertThat(r.statusClass()).isEqualTo(StatusClass.SUCCESS);
        assertThat(r.parseOk()).isTrue();
        assertThat(r.bodyIsValidJson()).isTrue();
        assertThat(r.envelope().itemsPresent()).isTrue();
        assertThat(r.envelope().totalCountPresent()).isTrue();
        assertThat(r.envelope().pagePresent()).isTrue();
        assertThat(r.envelope().pageSizePresent()).isTrue();
        assertThat(r.itemFields().inquiryId()).isTrue();
        assertThat(r.itemFields().buyerId()).isTrue();
        assertThat(r.itemFields().contents()).isTrue();
        assertThat(r.itemFields().itemName()).isTrue();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ONE);
        assertThat(r.statusTokens()).containsExactly("처리완료");
        assertThat(r.regDateShape()).isEqualTo(RegDateShape.OFFSET_BEARING);
        assertThat(r.retryAfterForm()).isEqualTo(RetryAfterForm.NONE);
    }

    @Test
    void redactsEveryPiiBearingValueFromTheReport() {
        EsmInquiryProbeReport r = reporter.report(ok(ONE_ITEM));

        String rendered = r.toString();
        assertThat(rendered)
                .doesNotContain("secret-marker-INQID")
                .doesNotContain("secret-marker-PRODUCT")
                .doesNotContain("secret-marker-ITEMNO")
                .doesNotContain("secret-marker-BUYER")
                .doesNotContain("secret-marker-CONTENTS");
        // Only the allowed reply-status token is carried.
        assertThat(r.statusTokens()).containsExactly("처리완료");
    }

    @Test
    void timezonelessRegDateIsRecordedAsShapeOnlyNeverTheValue() {
        String body = """
                {"items":[{"status":"미처리","regDate":"2026-06-03 09:00:00"}],
                 "totalCount":1,"page":1,"pageSize":1}
                """;

        EsmInquiryProbeReport r = reporter.report(ok(body));

        assertThat(r.regDateShape()).isEqualTo(RegDateShape.TIMEZONE_LESS);
        assertThat(r.toString()).doesNotContain("2026-06-03");
    }

    @Test
    void emptyPageBucketsToZeroWithNoStatusTokens() {
        EsmInquiryProbeReport r =
                reporter.report(ok("{\"items\":[],\"totalCount\":0,\"page\":1,\"pageSize\":1}"));

        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
        assertThat(r.statusTokens()).isEmpty();
        assertThat(r.regDateShape()).isEqualTo(RegDateShape.NONE);
    }

    @Test
    void malformedBodyRecordsParseFailedWithoutLeakingBody() {
        EsmInquiryProbeReport r = reporter.report(ok("<<garbage secret-marker-9999>>"));

        assertThat(r.parseOk()).isFalse();
        assertThat(r.bodyIsValidJson()).isFalse();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
        assertThat(r.toString()).doesNotContain("secret-marker-9999");
    }

    @Test
    void nonSuccessStatusRecordsClassOnlyAndNeverInspectsBody() {
        EsmInquiryProbeReport r = reporter.report(
                new EsmHttpClient.Response(401, "{\"error\":\"secret-marker-9999\"}", Map.of()));

        assertThat(r.statusClass()).isEqualTo(StatusClass.UNAUTHORIZED);
        assertThat(r.parseOk()).isFalse();
        assertThat(r.bodyIsValidJson()).isFalse();
        assertThat(r.itemCountBucket()).isEqualTo(CountBucket.ZERO);
        assertThat(r.toString()).doesNotContain("secret-marker-9999");
    }

    @Test
    void rateLimitedRecordsRetryAfterFormOnlyNotTheLiteralValue() {
        EsmInquiryProbeReport numeric = reporter.report(new EsmHttpClient.Response(
                429, "{\"trace\":\"secret-marker-9999\"}", Map.of("Retry-After", "30")));
        assertThat(numeric.statusClass()).isEqualTo(StatusClass.RATE_LIMITED);
        assertThat(numeric.retryAfterForm()).isEqualTo(RetryAfterForm.SECONDS);
        assertThat(numeric.parseOk()).isFalse();
        assertThat(numeric.toString()).doesNotContain("secret-marker-9999").doesNotContain("30");

        EsmInquiryProbeReport httpDate = reporter.report(new EsmHttpClient.Response(
                429, "{}", Map.of("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT")));
        assertThat(httpDate.retryAfterForm()).isEqualTo(RetryAfterForm.HTTP_DATE);

        EsmInquiryProbeReport none =
                reporter.report(new EsmHttpClient.Response(429, "{}", Map.of()));
        assertThat(none.retryAfterForm()).isEqualTo(RetryAfterForm.NONE);
    }
}
