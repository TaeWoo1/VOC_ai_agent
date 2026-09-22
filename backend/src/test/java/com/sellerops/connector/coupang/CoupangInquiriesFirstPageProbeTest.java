package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The live preflight's Coupang read is <b>exactly one signed GET per answered-type bucket</b> — the approval says
 * 「미답변/답변 각 1페이지」, and a second page must be impossible, not merely unasked. Production collection
 * ({@code fetchInquiryPage}) is untouched and still sweeps.
 */
class CoupangInquiriesFirstPageProbeTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-09-22T03:00:00Z"), ZoneOffset.UTC);
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    private final List<Long> pauses = new ArrayList<>();
    private final CoupangInquiriesClient client = new CoupangInquiriesClient(
            http, new CoupangSigner(clock), clock, "https://api-gateway.coupang.com", "apr-api-read-0a1b2c3d",
            pauses::add);

    private static CoupangHttpClient.Response json(String body) {
        return new CoupangHttpClient.Response(200, body, Map.of("Content-Type", "application/json"));
    }

    private static String page(int totalPages, int items) {
        StringBuilder content = new StringBuilder();
        for (int i = 0; i < items; i++) {
            if (i > 0) content.append(',');
            content.append("{\"inquiryId\":").append(1000 + i).append(",\"content\":\"q\",\"inquiryAt\":\"2026-09-20 10:00:00\"}");
        }
        String pagination = totalPages < 0 ? "" : ",\"pagination\":{\"currentPage\":1,\"totalPages\":" + totalPages
                + ",\"totalElements\":999,\"countPerPage\":" + items + "}";
        return "{\"code\":200,\"message\":\"OK\",\"data\":{\"content\":[" + content + "]" + pagination + "}}";
    }

    private CoupangInquiriesClient.FirstPage probe(String type, LocalDate from, int size) {
        return client.probeFirstPage("AK", "SK", "A00012345", type, from, LocalDate.of(2026, 9, 22), size);
    }

    @Test
    void asksPageOneOnce_evenWhenTheProviderSaysThereAreFiveMore() {
        for (int i = 0; i < 5; i++) http.enqueue(json(page(5, 10)));

        CoupangInquiriesClient.FirstPage first = probe("NOANSWER", LocalDate.of(2026, 9, 16), 10);

        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).uri().getQuery())
                .contains("answeredType=NOANSWER").contains("pageNum=1").contains("pageSize=10")
                .contains("inquiryStartAt=2026-09-16").contains("inquiryEndAt=2026-09-22");
        assertThat(first.records()).isEqualTo(10);
        assertThat(first.morePages()).isTrue();
    }

    @Test
    void sayUnknownRatherThanAskAgain_whenAFullPageCarriesNoTotal() {
        http.enqueue(json(page(-1, 3)));
        assertThat(probe("ANSWERED", LocalDate.of(2026, 9, 16), 3).morePages()).isNull();
        http.enqueue(json(page(-1, 2)));
        assertThat(probe("ANSWERED", LocalDate.of(2026, 9, 16), 3).morePages()).isFalse();
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void clampsTheWindowToTheOfficialSevenDays() {
        http.enqueue(json(page(1, 0)));
        probe("NOANSWER", LocalDate.of(2026, 8, 1), 50);
        assertThat(http.sent.get(0).uri().getQuery()).contains("inquiryStartAt=2026-09-16");
    }

    @Test
    void anUnknownBucketAndAnUnarmedGateSendNothing() {
        assertThatThrownBy(() -> probe("ALL", LocalDate.of(2026, 9, 16), 10)).isInstanceOf(IllegalArgumentException.class);
        CoupangInquiriesClient unarmed = new CoupangInquiriesClient(
                http, new CoupangSigner(clock), clock, "https://api-gateway.coupang.com", "", pauses::add);
        assertThatThrownBy(() -> unarmed.probeFirstPage("AK", "SK", "A00012345", "NOANSWER",
                LocalDate.of(2026, 9, 16), LocalDate.of(2026, 9, 22), 10))
                .isInstanceOf(CoupangLiveApprovalRequiredException.class);
        assertThat(http.sent).isEmpty();
    }

    /** Structural: the bounded method has no loop and exactly one request — nothing a caller passes can add one. */
    @Test
    void theBoundedMethodHasNoLoopAndOneRequest() throws Exception {
        String src = Files.readString(Path.of(
                "src/main/java/com/sellerops/connector/coupang/CoupangInquiriesClient.java"));
        int start = src.indexOf("public FirstPage probeFirstPage(");
        int end = src.indexOf("\n    }\n", start);
        String body = src.substring(start, end);
        assertThat(body).doesNotContain("while").doesNotContain("for (").doesNotContain("pageNum");
        assertThat(body.split("getInquiries\\(", -1)).hasSize(2);
    }
}
