package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The recurrence contract of the NAVER INQUIRY lane: two sources, one cursor slot, no runaway.
 *
 * <p>This is the test that would have caught the defects the other two channels shipped first. A
 * routine cursor that only ever resumes turns "what is new" into "where I stopped" and walks ten weeks
 * of history one page at a time (NAVER ORDER, 70 days); a sweep that hands back the page after the
 * last one parks the cursor past the end and goes permanently blind (NAVER PRODUCT, cursor 3 against
 * a 2-page catalogue). Both are asserted here BEFORE any live call, because both were found after one.
 */
class NaverInquiryRecurrenceTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final String TOKEN = "tok-1";
    private static final Instant NOW = Instant.parse("2026-08-24T03:00:00Z");

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);

    private NaverInquiryCollector both() {
        return new NaverInquiryCollector(new NaverProductQnaClient(http, BASE_URL),
                new NaverCustomerInquiriesClient(http, BASE_URL), clock);
    }

    private static String qnaPage(boolean last) {
        return "{\"last\":" + last + ",\"contents\":[{\"questionId\":1,"
                + "\"createDate\":\"2026-08-20T10:00:00.000+09:00\",\"question\":\"q\","
                + "\"answered\":false}]}";
    }

    private static String customerPage(boolean last) {
        return "{\"last\":" + last + ",\"content\":[{\"inquiryNo\":2,\"title\":\"t\","
                + "\"inquiryContent\":\"c\","
                + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
                + "\"answered\":false}]}";
    }

    @Test
    @DisplayName("the first routine window opens at this repository's own recency ceiling, not further")
    void theFirstWindowIsBoundedByTheExistingRecencyCeiling() {
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));
        http.enqueue(FakeNaverHttpClient.ok(customerPage(true)));

        NaverInquiryCollector collector = both();
        String afterQna = collector.fetchInquiryPage(TOKEN, null).nextCursorValue();
        collector.fetchInquiryPage(TOKEN, afterQna);

        // 14 days = NaverOrdersClient.ROUTINE_MAX_LAG, which this repository already means by "recent
        // operational acquisition" on this channel. No new number was chosen for inquiries.
        assertThat(http.sent.get(0).uri().toString()).contains("fromDate=2026-08-10");
        assertThat(http.sent.get(1).uri().toString()).contains("startSearchDate=2026-08-10");
    }

    @Test
    @DisplayName("the next window opens where the last one ended — the overlap NAVER itself asks for")
    void theNextWindowSharesTheBoundaryWithThePrevious() {
        // A finished sweep, both lanes done, ending at a known instant.
        String finished = "{\"qna\":{\"from\":\"2026-08-01T00:00:00.000+09:00\","
                + "\"to\":\"2026-08-23T12:00:00.000+09:00\",\"page\":3,\"done\":true},"
                + "\"customer\":{\"from\":\"2026-08-01\",\"to\":\"2026-08-23\",\"page\":1,\"done\":true},"
                + "\"active\":\"PRODUCT_QNA\",\"bounded\":false}";
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));

        both().fetchInquiryPage(TOKEN, finished);

        // Exactly the previous end, with no invented margin: the vendor asks callers to overlap the
        // previous toDate into the next fromDate, and a shared boundary IS that overlap. Re-delivery
        // at the boundary is idempotent because both resources carry stable identifiers.
        assertThat(http.sent.get(0).uri().toString())
                .contains("fromDate=2026-08-23T12%3A00%3A00.000%2B09%3A00");
    }

    @Test
    @DisplayName("a cursor that fell far behind restarts at the ceiling instead of walking the backlog")
    void aStaleRoutineCursorRestartsRatherThanSweepingHistory() {
        String stale = "{\"qna\":{\"from\":\"2026-05-01T00:00:00.000+09:00\","
                + "\"to\":\"2026-06-14T00:00:00.000+09:00\",\"page\":1,\"done\":true},"
                + "\"customer\":{\"from\":\"2026-05-01\",\"to\":\"2026-06-14\",\"page\":1,\"done\":true},"
                + "\"active\":\"PRODUCT_QNA\",\"bounded\":false}";
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));

        both().fetchInquiryPage(TOKEN, stale);

        // Not 2026-06-14. The skipped span is an operator's bounded backfill and is logged as such —
        // it is neither silently swept nor silently dropped.
        assertThat(http.sent.get(0).uri().toString()).contains("fromDate=2026-08-10");
    }

    @Test
    @DisplayName("an operator's bounded window is never recomputed and never widened")
    void aBoundedWindowIsTheOperatorsAndStays() {
        NaverInquiryCollector collector = both();
        String seed = collector.boundedWindowSeed(java.time.LocalDate.parse("2026-03-01"),
                java.time.LocalDate.parse("2026-03-31"));
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(false)));

        FetchPage page = collector.fetchInquiryPage(TOKEN, seed);

        assertThat(http.sent.get(0).uri().toString()).contains("fromDate=2026-03-01");
        // Page 2 of the SAME window — a bounded run pages inside its scope, it does not move it.
        assertThat(page.nextCursorValue()).contains("\"page\":2").contains("\"bounded\":true");
    }

    @Test
    @DisplayName("one lane's progress never writes the other lane's position")
    void theTwoLanesAdvanceIndependently() {
        NaverInquiryCollector collector = both();
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(false)));

        FetchPage first = collector.fetchInquiryPage(TOKEN, null);

        assertThat(first.nextCursorValue()).contains("\"page\":2");
        // The customer lane is still at its own page 1, untouched by the QNA page turn.
        assertThat(first.nextCursorValue()).contains("\"customer\":{\"from\":\"2026-08-10\"")
                .contains("\"page\":1");
        assertThat(first.hasMore()).isTrue();
    }

    @Test
    @DisplayName("a finished source hands over to the other, and the run ends when both are done")
    void theActiveSourceFlipsWhenALaneFinishes() {
        NaverInquiryCollector collector = both();
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));
        FetchPage afterQna = collector.fetchInquiryPage(TOKEN, null);
        assertThat(afterQna.hasMore()).as("고객 문의 has not been read yet").isTrue();

        http.enqueue(FakeNaverHttpClient.ok(customerPage(true)));
        FetchPage afterCustomer = collector.fetchInquiryPage(TOKEN, afterQna.nextCursorValue());

        assertThat(http.sent.get(1).uri().toString()).contains("/pay-user/inquiries");
        assertThat(afterCustomer.hasMore()).isFalse();
        assertThat(afterCustomer.dataType()).isEqualTo(DataType.INQUIRY);
    }

    @Test
    @DisplayName("a finished cursor is handed back so the NEXT cycle can re-observe, not parked past the end")
    void afinishedSweepDoesNotParkTheCursorPastTheEnd() {
        NaverInquiryCollector collector = both();
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));
        String afterQna = collector.fetchInquiryPage(TOKEN, null).nextCursorValue();
        http.enqueue(FakeNaverHttpClient.ok(customerPage(true)));
        String afterBoth = collector.fetchInquiryPage(TOKEN, afterQna).nextCursorValue();

        // The next cycle: both lanes are done, so the windows recompute rather than asking for an
        // empty page forever. This is the PRODUCT cursor defect, asserted before it can happen here.
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));
        collector.fetchInquiryPage(TOKEN, afterBoth);

        assertThat(http.sent.get(2).uri().toString()).contains("page=1");
        assertThat(http.sent.get(2).uri().toString()).contains("/contents/qnas");
    }

    @Test
    @DisplayName("with one source wired, the other is never called — which is how a proof isolates one")
    void anUnwiredSourceIsNeverCalled() {
        NaverInquiryCollector qnaOnly = new NaverInquiryCollector(
                new NaverProductQnaClient(http, BASE_URL), null, clock);
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));

        FetchPage page = qnaOnly.fetchInquiryPage(TOKEN, null);

        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).uri().toString()).contains("/contents/qnas");
        // The sweep is COMPLETE with one source: an unwired lane is not waited on.
        assertThat(page.hasMore()).isFalse();
    }

    @Test
    @DisplayName("with only 고객 문의 wired, 상품 문의 is never called either")
    void theIsolationHoldsInBothDirections() {
        NaverInquiryCollector customerOnly = new NaverInquiryCollector(
                null, new NaverCustomerInquiriesClient(http, BASE_URL), clock);
        http.enqueue(FakeNaverHttpClient.ok(customerPage(true)));

        customerOnly.fetchInquiryPage(TOKEN, null);

        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).uri().toString()).contains("/pay-user/inquiries");
    }

    @Test
    @DisplayName("a garbage cursor restarts the recent window rather than resuming a lie")
    void anUnreadableCursorFailsToAFreshRecentWindow() {
        http.enqueue(FakeNaverHttpClient.ok(qnaPage(true)));

        both().fetchInquiryPage(TOKEN, "{not-json");

        assertThat(http.sent.get(0).uri().toString()).contains("fromDate=2026-08-10").contains("page=1");
    }
}
