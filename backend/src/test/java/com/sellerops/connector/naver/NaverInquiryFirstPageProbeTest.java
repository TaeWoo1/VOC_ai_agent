package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.BoundedReadProbe.SourcePage;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * NAVER's two official inquiry lanes are verified <b>independently, one page each</b>. The production collector reads
 * whichever lane is outstanding and walks it; the preflight asks each lane's page 1 once, and one lane failing does
 * not keep the other from being asked.
 */
class NaverInquiryFirstPageProbeTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final String TOKEN = "tok";
    private final Clock clock = Clock.fixed(Instant.parse("2026-09-22T03:00:00Z"), ZoneOffset.UTC);
    private final FakeNaverHttpClient http = new FakeNaverHttpClient();

    private List<SourcePage> probe(NaverInquiryCollector collector) {
        return collector.probeFirstPages(TOKEN, LocalDate.of(2026, 9, 16), LocalDate.of(2026, 9, 22));
    }

    @Test
    void eachLaneIsAskedOnce_aNextPageIsReportedNotRequested_andAFailureStaysInItsLane() {
        NaverInquiryCollector collector = new NaverInquiryCollector(
                new NaverProductQnaClient(http, BASE_URL), new NaverCustomerInquiriesClient(http, BASE_URL), clock);
        // Product Q&A says three more pages exist; customer inquiries refuse the call.
        http.enqueue(FakeNaverHttpClient.ok("{\"last\":false,\"totalPages\":4,\"contents\":[{"
                + "\"questionId\":2,\"createDate\":\"2026-09-20T10:00:00.000+09:00\","
                + "\"question\":\"q\",\"answered\":false}]}"));
        http.enqueue(new NaverHttpClient.Response(403, "{\"code\":\"FORBIDDEN\"}", java.util.Map.of()));

        List<SourcePage> pages = probe(collector);

        assertThat(http.sent).hasSize(2);
        assertThat(pages).extracting(SourcePage::source, SourcePage::outcome).containsExactly(
                org.assertj.core.groups.Tuple.tuple(NaverInquiryCursor.SOURCE_PRODUCT_QNA, SourcePage.SUCCESS),
                org.assertj.core.groups.Tuple.tuple(NaverInquiryCursor.SOURCE_CUSTOMER, SourcePage.FAILED));
        assertThat(pages.get(0).records()).isEqualTo(1);
        assertThat(pages.get(0).morePages()).isTrue();
        assertThat(pages.get(1).failure()).isNotNull();
    }

    @Test
    void anUnwiredLaneIsReportedAndNotCalled() {
        NaverInquiryCollector collector = new NaverInquiryCollector(new NaverProductQnaClient(http, BASE_URL), null, clock);
        http.enqueue(FakeNaverHttpClient.ok("{\"contents\":[],\"last\":true}"));

        List<SourcePage> pages = probe(collector);

        assertThat(http.sent).hasSize(1);
        assertThat(pages.get(1).outcome()).isEqualTo(SourcePage.NOT_WIRED);
        assertThat(pages.get(0).morePages()).isFalse();
    }
}
