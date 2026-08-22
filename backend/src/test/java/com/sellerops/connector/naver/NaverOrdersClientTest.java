package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalOrder;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Slice 1b: the officially recommended two-call flow against fixture JSON built
 * strictly from maintainer-confirmed field names — windowing, more-continuation,
 * dedup, batching, cumulative day totals, and fail-safe behavior. No network.
 */
class NaverOrdersClientTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final String TOKEN = "tok-1";
    /** 2026-06-12 15:00 KST. */
    private static final Instant NOW = Instant.parse("2026-06-12T06:00:00Z");

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final NaverOrdersClient client = client(100);

    private NaverOrdersClient client(int batchSize) {
        return new NaverOrdersClient(http, Clock.fixed(NOW, ZoneOffset.UTC), BASE_URL, batchSize);
    }

    // --- fixtures (confirmed field names only) ---

    private static String lcsItem(String productOrderId, String orderId, String paymentDate) {
        return "{\"productOrderId\":\"" + productOrderId + "\",\"orderId\":\"" + orderId + "\","
                + "\"productOrderStatus\":\"PAYED\",\"lastChangedType\":\"PAYED\","
                + "\"lastChangedDate\":\"" + paymentDate + "\","
                + "\"paymentDate\":\"" + paymentDate + "\"}";
    }

    private static String lcsBody(String moreJson, String... items) {
        return "{\"data\":{\"lastChangeStatuses\":[" + String.join(",", items) + "]"
                + (moreJson != null ? ",\"more\":" + moreJson : "") + "}}";
    }

    private static String detailItem(String productOrderId, Long amount) {
        return "{\"productOrder\":{\"productOrderId\":\"" + productOrderId + "\""
                + (amount != null ? ",\"initialPaymentAmount\":" + amount : "") + "}}";
    }

    private static String detailBody(String... items) {
        return "{\"data\":[" + String.join(",", items) + "]}";
    }

    // --- tests ---

    @Test
    void firstFetchQueriesInitialWindowWithConfirmedParams() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, null);

        FakeNaverHttpClient.Sent request = http.sent.get(0);
        assertThat(request.method()).isEqualTo("GET");
        assertThat(request.bearer()).isEqualTo(TOKEN);
        assertThat(request.uri().getPath()).isEqualTo("/external/v1/pay-order/seller/product-orders/last-changed-statuses");
        String query = request.uri().getQuery(); // decoded
        assertThat(query).contains("lastChangedType=PAYED");
        assertThat(query).contains("lastChangedFrom=");
        assertThat(query).contains("lastChangedTo=");
        assertThat(query).contains("+09:00"); // KST offsets, encoded exactly once
        assertThat(query).doesNotContain("moreSequence");

        assertThat(page.records()).isEmpty();
        // Initial 24h backfill window ends at "now" — nothing further to drain.
        assertThat(page.hasMore()).isFalse();
        assertThat(page.nextCursorValue()).contains("windowFrom");
    }

    @Test
    void datetimeParamsUseFixedThreeDigitMillisecondFormatEvenForSubMillisClock() {
        // The live HTTP-400 case: a real wall-clock instant carries microseconds, which
        // OffsetDateTime.toString() would emit as 6 fraction digits (and a zero-fraction
        // instant as minute-only) — both rejected by Naver. The fixed formatter must
        // always emit exactly 3 millisecond digits with a +09:00 offset.
        Instant microNow = Instant.parse("2026-06-13T10:14:53.173737Z");
        NaverOrdersClient liveClient =
                new NaverOrdersClient(http, Clock.fixed(microNow, ZoneOffset.UTC), BASE_URL, 100);
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage page = liveClient.fetchOrderSummaryPage(TOKEN, null);

        String query = http.sent.get(0).uri().getQuery(); // decoded
        String millisOffset = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\+09:00";
        assertThat(query).containsPattern("lastChangedFrom=" + millisOffset);
        assertThat(query).containsPattern("lastChangedTo=" + millisOffset);
        // Never a 6-digit microsecond fraction, never a minute-only (no-seconds) stamp.
        assertThat(query).doesNotContainPattern("\\.\\d{6}");
        assertThat(query).doesNotContainPattern("T\\d{2}:\\d{2}\\+09:00");

        // The emitted cursor's window bounds round-trip through OffsetDateTime.parse.
        String cursor = page.nextCursorValue();
        for (String key : new String[] {"windowFrom", "windowTo"}) {
            Matcher m = Pattern.compile("\"" + key + "\":\"([^\"]+)\"").matcher(cursor);
            assertThat(m.find()).as("cursor carries %s", key).isTrue();
            assertThat(m.group(1)).matches(millisOffset);
            OffsetDateTime.parse(m.group(1)); // must not throw
        }
    }

    /**
     * The bounded lane exists because the only way to read NAVER orders was to resume the routine
     * cursor from wherever it stood. On the canonical demo org that meant walking 70 days forward
     * from a position frozen in June to answer a question about this week.
     */
    @Test
    void aBoundedWindowStartsAtTheRequestedDateAndStopsAtIt() {
        // NOW is 2026-06-12 15:00 KST. Ask for a two-day range that ENDS before now.
        String seed = client.boundedWindowSeed(LocalDate.of(2026, 6, 9), LocalDate.of(2026, 6, 10));
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage first = client.fetchOrderSummaryPage(TOKEN, seed);

        // It starts at the requested date's first KST instant — not at "now minus 24h".
        assertThat(http.sent.get(0).uri().getQuery())
                .contains("lastChangedFrom=2026-06-09T00:00:00.000+09:00");
        // Two days of 24h windows: one more to walk.
        assertThat(first.hasMore()).isTrue();

        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));
        FetchPage second = client.fetchOrderSummaryPage(TOKEN, first.nextCursorValue());

        assertThat(http.sent.get(1).uri().getQuery())
                .contains("lastChangedFrom=2026-06-10T00:00:00.000+09:00")
                .contains("lastChangedTo=2026-06-11T00:00:00.000+09:00");
        // And it STOPS at the end of the requested range rather than continuing to "now".
        assertThat(second.hasMore()).isFalse();
    }

    @Test
    void aBoundedWindowReachingTodayStopsAtNowRatherThanAskingForTheFuture() {
        String seed = client.boundedWindowSeed(LocalDate.of(2026, 6, 12), LocalDate.of(2026, 6, 12));
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, seed);

        assertThat(http.sent.get(0).uri().getQuery())
                .contains("lastChangedFrom=2026-06-12T00:00:00.000+09:00")
                .contains("lastChangedTo=2026-06-12T15:00:00.000+09:00"); // = NOW, not tomorrow
        assertThat(page.hasMore()).isFalse();
    }

    /**
     * Ingestion overwrites daily totals by (channel, date). A bounded run that emitted the two days
     * BEFORE its range — which the routine two-day carry would have it do — would replace whatever
     * is stored for those dates with a count of only the orders that changed inside the range.
     */
    @Test
    void aBoundedWindowNeverWritesADailyTotalBeforeItsOwnStartDate() {
        String seed = client.boundedWindowSeed(LocalDate.of(2026, 6, 10), LocalDate.of(2026, 6, 10));
        // Two orders changed inside the window: one placed inside the range, one placed before it.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO-IN", "O-1", "2026-06-10T09:00:00.000+09:00"),
                lcsItem("PO-BEFORE", "O-2", "2026-06-08T09:00:00.000+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(
                detailItem("PO-IN", 12000L), detailItem("PO-BEFORE", 34000L))));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, seed);

        assertThat(page.records()).hasSize(1);
        CanonicalOrderSummary only = (CanonicalOrderSummary) page.records().get(0);
        assertThat(only.summaryDate()).isEqualTo(LocalDate.of(2026, 6, 10));
        assertThat(only.orderCount()).isEqualTo(1);
    }

    // --- routine lane freshness (the schedule's contract) ---

    /**
     * The defect a NAVER ORDER schedule would have shipped with.
     *
     * <p>The demo org's routine cursor sat at 2026-06-14 for ten weeks while its schedule was paused.
     * Resuming it means walking 24h at a time from there — 69 consecutive windows before the first
     * recent order is seen, and a daily total written for every date passed on the way. Both are the
     * wrong lane: routine's job is what is new, and recovering ten weeks of history is an operator's
     * bounded backfill, approved as its own run.
     */
    @Test
    void aRoutineCursorTenWeeksBehindRestartsAtTheRecentHorizonInsteadOfWalkingHistory() {
        String stale = "{\"windowFrom\":\"2026-04-01T13:00:00.000+09:00\","
                + "\"windowTo\":\"2026-04-01T13:00:00.000+09:00\",\"moreFrom\":null,"
                + "\"moreSequence\":null,\"dayTotals\":{\"2026-04-01\":{\"orders\":3,\"amount\":9000}}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, stale);

        String query = http.sent.get(0).uri().getQuery();
        // NOW is 2026-06-12 15:00 KST; the horizon is 14 days back, aligned to the KST start of day so
        // every date this cursor emits is one it covered in full.
        assertThat(query).contains("lastChangedFrom=2026-05-29T00:00:00.000+09:00");
        assertThat(query).doesNotContain("2026-04");
        // The restart is a restart, not a resume: the abandoned window's carried totals go with it.
        assertThat(page.nextCursorValue()).doesNotContain("2026-04-01");
        assertThat(page.hasMore()).as("it still has to walk forward to now").isTrue();
    }

    /**
     * The other half of the same rule. A lag inside the horizon is an outage, and walking it off
     * contiguously IS freshness recovery — it is also the only way a status change on an older order
     * gets re-observed, so the overlap must survive.
     */
    @Test
    void aRoutineCursorInsideTheRecencyHorizonIsResumedContiguouslyNotRestarted() {
        String recent = "{\"windowFrom\":\"2026-06-10T15:00:00.000+09:00\","
                + "\"windowTo\":\"2026-06-10T15:00:00.000+09:00\",\"moreFrom\":null,"
                + "\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        client.fetchOrderSummaryPage(TOKEN, recent);

        assertThat(http.sent.get(0).uri().getQuery())
                .contains("lastChangedFrom=2026-06-10T15:00:00.000+09:00");
    }

    /**
     * A restarted routine cursor starts cold, so the two-day carry would have it emit totals for the
     * days BEFORE its own start — counting only the orders that happened to change inside the window.
     * Ingestion overwrites daily totals by (channel, date), so that lands as a complete-looking
     * undercount over whatever was already stored.
     */
    @Test
    void aRestartedRoutineCursorWritesNoDailyTotalBeforeItsOwnStartDate() {
        String stale = "{\"windowFrom\":\"2026-04-01T13:00:00.000+09:00\","
                + "\"windowTo\":\"2026-04-01T13:00:00.000+09:00\",\"moreFrom\":null,"
                + "\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO-IN", "O-1", "2026-05-29T09:00:00.000+09:00"),
                lcsItem("PO-BEFORE", "O-2", "2026-05-27T09:00:00.000+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(
                detailItem("PO-IN", 12000L), detailItem("PO-BEFORE", 34000L))));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, stale);

        assertThat(page.records()).hasSize(1);
        assertThat(((CanonicalOrderSummary) page.records().get(0)).summaryDate())
                .isEqualTo(LocalDate.of(2026, 5, 29));
    }

    /**
     * A backfill cursor is an operator's approved range, and being far behind "now" is what it is FOR.
     * Restarting it would silently change what was approved.
     */
    @Test
    void anOperatorsBoundedWindowIsNeverRestartedNoMatterHowFarBackItReaches() {
        String seed = client.boundedWindowSeed(LocalDate.of(2026, 4, 1), LocalDate.of(2026, 4, 2));
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        client.fetchOrderSummaryPage(TOKEN, seed);

        assertThat(http.sent.get(0).uri().getQuery())
                .contains("lastChangedFrom=2026-04-01T00:00:00.000+09:00");
    }

    /**
     * The restart replaces the routine lane's place; it must not acquire an END. A routine cursor that
     * stopped at a fixed instant would stop collecting the moment it reached it.
     */
    @Test
    void aRestartedRoutineCursorKeepsWalkingToNowAndNeverStopsAtAFixedEnd() {
        String stale = "{\"windowFrom\":\"2026-04-01T13:00:00.000+09:00\","
                + "\"windowTo\":\"2026-04-01T13:00:00.000+09:00\",\"moreFrom\":null,"
                + "\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));
        FetchPage page = client.fetchOrderSummaryPage(TOKEN, stale);

        assertThat(page.nextCursorValue()).contains("\"toExclusive\":null");

        // Walk it to the end of the horizon and it is still hungry rather than settled.
        String cursor = page.nextCursorValue();
        for (int window = 0; window < 14; window++) {
            http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));
            cursor = client.fetchOrderSummaryPage(TOKEN, cursor).nextCursorValue();
        }
        assertThat(cursor).contains("2026-06-12T15:00:00.000+09:00"); // caught up to NOW
    }

    // --- the run must END (sub-millisecond clock) ---

    /**
     * <b>Every other test in this file uses a round-millisecond clock, and that is why this defect
     * shipped.</b>
     *
     * <p>The cursor writes exactly three millisecond digits (NAVER's required format), so an instant
     * that goes into it comes back out truncated. Production reads {@code Clock.systemUTC()}, which
     * ticks in MICROseconds, so the truncated {@code windowFrom} was permanently before {@code now},
     * {@code isCaughtUp} answered false forever, and {@code hasMore} never went false — a routine run
     * paged until the executor's 10,000-page guard, one live marketplace request at a time.
     *
     * <p>Observed twice on the demo org: 2026-06-14, 13 minutes 30 seconds and 0 rows, recorded
     * SUCCESS; and again on 2026-08-22 the moment the routine lane could reach "now" at all.
     *
     * <p>The fake fails the test on any un-enqueued call, so a regression here surfaces as a runaway
     * rather than a silent pass.
     */
    @Test
    void aRunThatCatchesUpStopsEvenWhenTheClockIsFinerThanTheCursorCanWrite() {
        // 2026-06-12 15:00:00.409075 KST — a real wall clock, microseconds and all.
        Instant subMillis = Instant.parse("2026-06-12T06:00:00.409075Z");
        NaverOrdersClient fine = new NaverOrdersClient(http, Clock.fixed(subMillis, ZoneOffset.UTC),
                BASE_URL, 100);

        // One 24h window ending at "now": the initial cursor's whole job, and it must finish it.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));
        FetchPage page = fine.fetchOrderSummaryPage(TOKEN, null);

        assertThat(http.sent).hasSize(1);
        assertThat(page.hasMore())
                .as("a window that reached now is caught up — sub-millisecond remainder is not work")
                .isFalse();

        // And the cursor it produced reports caught up to the SAME clock, so the next run makes no call.
        FetchPage next = fine.fetchOrderSummaryPage(TOKEN, page.nextCursorValue());
        assertThat(http.sent).as("no HTTP for a caught-up cursor").hasSize(1);
        assertThat(next.hasMore()).isFalse();
    }

    /**
     * The same guarantee for the path that actually spun: a routine restart walks a BOUNDED number of
     * windows and then stops, on a microsecond clock.
     */
    @Test
    void aRoutineRestartWalksABoundedNumberOfWindowsAndThenStops() {
        Instant subMillis = Instant.parse("2026-06-12T06:00:00.409075Z");
        NaverOrdersClient fine = new NaverOrdersClient(http, Clock.fixed(subMillis, ZoneOffset.UTC),
                BASE_URL, 100);
        String stale = "{\"windowFrom\":\"2026-04-01T13:00:00.000+09:00\","
                + "\"windowTo\":\"2026-04-01T13:00:00.000+09:00\",\"moreFrom\":null,"
                + "\"moreSequence\":null,\"dayTotals\":{}}";

        // The restart opens at 2026-05-29 00:00 KST and must reach 2026-06-12 15:00 KST: 15 windows.
        // One more response than that is enqueued, so an off-by-one would be visible rather than fatal.
        int expectedWindows = 15;
        for (int i = 0; i <= expectedWindows; i++) {
            http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));
        }

        String cursor = stale;
        int pages = 0;
        boolean hasMore = true;
        while (hasMore && pages < 40) { // the loop the executor runs, with a guard that FAILS the test
            FetchPage page = fine.fetchOrderSummaryPage(TOKEN, cursor);
            cursor = page.nextCursorValue();
            hasMore = page.hasMore();
            pages++;
        }

        assertThat(hasMore).as("the run must end on its own, not on a page guard").isFalse();
        assertThat(pages).isEqualTo(expectedWindows);
    }

    @Test
    void twoCallFlowMapsToDailySummariesGroupedByKstPaymentDate() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"),
                lcsItem("PO2", "O1", "2026-06-11T23:30:00+09:00"),
                lcsItem("PO3", "O2", "2026-06-12T01:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(
                detailItem("PO1", 10000L), detailItem("PO2", 20000L), detailItem("PO3", 5000L))));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, null);

        assertThat(page.dataType()).isEqualTo(DataType.ORDER_SUMMARY);
        List<CanonicalOrderSummary> summaries = page.records().stream()
                .map(CanonicalOrderSummary.class::cast).toList();
        assertThat(summaries).hasSize(2);
        CanonicalOrderSummary june11 = summaries.stream()
                .filter(s -> s.summaryDate().equals(LocalDate.parse("2026-06-11"))).findFirst().orElseThrow();
        // orderCount counts paid product-order rows (상품주문 단위), documented semantics.
        assertThat(june11.orderCount()).isEqualTo(2);
        assertThat(june11.salesAmount()).isEqualTo(30000L);
        CanonicalOrderSummary june12 = summaries.stream()
                .filter(s -> s.summaryDate().equals(LocalDate.parse("2026-06-12"))).findFirst().orElseThrow();
        assertThat(june12.orderCount()).isEqualTo(1);
        assertThat(june12.salesAmount()).isEqualTo(5000L);

        // The detail call asked for exactly the page's product orders.
        FakeNaverHttpClient.Sent detail = http.sent.get(1);
        assertThat(detail.method()).isEqualTo("POST_JSON");
        assertThat(detail.uri().getPath()).isEqualTo("/external/v1/pay-order/seller/product-orders/query");
        assertThat(detail.jsonBody()).contains("PO1").contains("PO2").contains("PO3")
                .contains("productOrderIds");
    }

    @Test
    void emitsPerOrderRecordsConsistentWithTheDailySummary() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"),
                lcsItem("PO2", "O1", "2026-06-11T23:30:00+09:00"),
                lcsItem("PO3", "O2", "2026-06-12T01:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(
                detailItem("PO1", 10000L), detailItem("PO2", 20000L), detailItem("PO3", 5000L))));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, null);

        List<CanonicalOrder> orders = page.orders().stream().map(CanonicalOrder.class::cast).toList();
        assertThat(orders).hasSize(3);
        CanonicalOrder po1 = orders.stream().filter(o -> o.externalOrderId().equals("PO1")).findFirst().orElseThrow();
        assertThat(po1.parentOrderId()).isEqualTo("O1");
        assertThat(po1.rawStatusCode()).isEqualTo("PAYED");
        assertThat(po1.paymentAmount()).isEqualTo(10000L);
        assertThat(po1.summaryDate()).isEqualTo(LocalDate.parse("2026-06-11"));
        assertThat(po1.paidAt()).isEqualTo(OffsetDateTime.parse("2026-06-11T22:00:00+09:00").toInstant());
        assertThat(po1.statusChangedAt()).isEqualTo(OffsetDateTime.parse("2026-06-11T22:00:00+09:00").toInstant());

        // Consistency: for every date the per-order aggregate equals the daily summary — both derive
        // from the same countable set, so this can never silently drift.
        List<CanonicalOrderSummary> summaries = page.records().stream()
                .map(CanonicalOrderSummary.class::cast).toList();
        for (CanonicalOrderSummary summary : summaries) {
            List<CanonicalOrder> forDate = orders.stream()
                    .filter(o -> o.summaryDate().equals(summary.summaryDate())).toList();
            assertThat(forDate).hasSize(summary.orderCount());
            assertThat(forDate.stream().mapToLong(CanonicalOrder::paymentAmount).sum())
                    .isEqualTo(summary.salesAmount());
        }
    }

    @Test
    void missingProductOrderStatusFailsClosed() {
        // The one required per-order status field, absent → fail closed for the page (symmetric with
        // the amount invariant), never a per-order row carrying a null status.
        String itemNoStatus = "{\"productOrderId\":\"PO1\",\"orderId\":\"O1\","
                + "\"lastChangedType\":\"PAYED\",\"lastChangedDate\":\"2026-06-11T22:00:00+09:00\","
                + "\"paymentDate\":\"2026-06-11T22:00:00+09:00\"}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null, itemNoStatus)));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("주문 상태");
    }

    @Test
    void duplicateProductOrderIdsAreDedupedBeforeDetailQueryAndCountedOnce() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"),
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, null);

        String body = http.sent.get(1).jsonBody();
        assertThat(body.indexOf("PO1")).isEqualTo(body.lastIndexOf("PO1")); // requested once
        CanonicalOrderSummary summary = (CanonicalOrderSummary) page.records().get(0);
        assertThat(summary.orderCount()).isEqualTo(1);
        assertThat(summary.salesAmount()).isEqualTo(10000L);
    }

    @Test
    void morePresentContinuesSameWindowWithMoreSequence() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(
                "{\"moreFrom\":\"2026-06-11T22:00:01+09:00\",\"moreSequence\":\"seq-2\"}",
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));

        FetchPage first = client.fetchOrderSummaryPage(TOKEN, null);

        assertThat(first.hasMore()).isTrue();
        assertThat(first.nextCursorValue()).contains("seq-2").contains("2026-06-11T22:00:01+09:00");

        // The continuation call resumes from moreFrom with moreSequence set.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));
        client.fetchOrderSummaryPage(TOKEN, first.nextCursorValue());
        String query = http.sent.get(2).uri().getQuery();
        assertThat(query).contains("moreSequence=seq-2");
        assertThat(query).contains("lastChangedFrom=2026-06-11T22:00:01+09:00");
    }

    @Test
    void noMoreAdvancesWindowContiguously() {
        String cursor = "{\"windowFrom\":\"2026-06-10T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, cursor);

        // Old windowTo becomes the new windowFrom (official gap-avoidance rule),
        // re-emitted in the fixed 3-digit-millisecond ISO offset format.
        assertThat(page.nextCursorValue()).contains("\"windowFrom\":\"2026-06-11T15:00:00.000+09:00\"");
        assertThat(page.hasMore()).isTrue(); // still behind "now" — more windows to drain
    }

    @Test
    void cumulativeDayTotalsConvergeAcrossPagesOfTheSameDate() {
        // Page 1: one paid order on 06-11, window continues.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(
                "{\"moreFrom\":\"2026-06-11T22:00:01+09:00\",\"moreSequence\":\"seq-2\"}",
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));
        FetchPage first = client.fetchOrderSummaryPage(TOKEN, null);
        CanonicalOrderSummary firstSummary = (CanonicalOrderSummary) first.records().get(0);
        assertThat(firstSummary.orderCount()).isEqualTo(1);
        assertThat(firstSummary.salesAmount()).isEqualTo(10000L);

        // Page 2 (same window): another order, same date — emission is cumulative,
        // because ingestion upserts by (channel, date) and overwrites.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO2", "O2", "2026-06-11T23:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO2", 20000L))));
        FetchPage second = client.fetchOrderSummaryPage(TOKEN, first.nextCursorValue());

        CanonicalOrderSummary secondSummary = (CanonicalOrderSummary) second.records().get(0);
        assertThat(secondSummary.summaryDate()).isEqualTo(LocalDate.parse("2026-06-11"));
        assertThat(secondSummary.orderCount()).isEqualTo(2);
        assertThat(secondSummary.salesAmount()).isEqualTo(30000L);
    }

    @Test
    void rateLimitedLastChangedCallThrowsWithoutDetailCall() {
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(NaverRateLimitedException.class);
        assertThat(http.sent).hasSize(1); // no detail call after the throttle
    }

    @Test
    void rateLimitedDetailCallThrows() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(NaverRateLimitedException.class);
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void missingAmountFieldFailsSafelyWithoutTokenMaterial() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", null))));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("initialPaymentAmount")
                .hasMessageNotContaining(TOKEN);
    }

    @Test
    void detailResponseMissingARequestedProductOrderFailsSafely() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody())); // empty data

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("누락")
                .hasMessageNotContaining(TOKEN);
    }

    @Test
    void detailQueriesAreBatchedByConfiguredSize() {
        NaverOrdersClient tiny = client(1);
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"),
                lcsItem("PO2", "O2", "2026-06-11T23:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO2", 20000L))));

        FetchPage page = tiny.fetchOrderSummaryPage(TOKEN, null);

        assertThat(http.sent).hasSize(3); // 1 LCS + 2 single-id detail batches
        assertThat(http.sent.get(1).jsonBody()).contains("PO1").doesNotContain("PO2");
        assertThat(http.sent.get(2).jsonBody()).contains("PO2").doesNotContain("PO1");
        CanonicalOrderSummary summary = (CanonicalOrderSummary) page.records().get(0);
        assertThat(summary.salesAmount()).isEqualTo(30000L);
    }

    @Test
    void boundaryStampedOrderRedeliveredInNextWindowIsNotDoubleCounted() {
        // Window 1: PO1 stamped exactly on windowTo — the shared boundary instant.
        String window1 = "{\"windowFrom\":\"2026-06-10T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T15:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));
        FetchPage first = client.fetchOrderSummaryPage(TOKEN, window1);
        assertThat(((CanonicalOrderSummary) first.records().get(0)).orderCount()).isEqualTo(1);
        assertThat(first.nextCursorValue()).contains("PO1"); // promoted to the skip set

        // Window 2 (windowFrom == old windowTo): the API re-delivers PO1.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T15:00:00+09:00"),
                lcsItem("PO2", "O2", "2026-06-11T16:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO2", 20000L))));
        FetchPage second = client.fetchOrderSummaryPage(TOKEN, first.nextCursorValue());

        // Detail asked only for PO2; the daily total counts PO1 exactly once.
        assertThat(http.sent.get(3).jsonBody()).contains("PO2").doesNotContain("PO1");
        CanonicalOrderSummary summary = (CanonicalOrderSummary) second.records().get(0);
        assertThat(summary.summaryDate()).isEqualTo(LocalDate.parse("2026-06-11"));
        assertThat(summary.orderCount()).isEqualTo(2);
        assertThat(summary.salesAmount()).isEqualTo(30000L);
    }

    @Test
    void pageBoundaryOrderRedeliveredOnContinuationPageIsNotDoubleCounted() {
        // Page 1 ends with PO1 stamped exactly at more.moreFrom — the continuation
        // re-uses that instant as lastChangedFrom and may re-deliver PO1.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(
                "{\"moreFrom\":\"2026-06-11T22:00:00+09:00\",\"moreSequence\":\"seq-2\"}",
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO1", 10000L))));
        FetchPage first = client.fetchOrderSummaryPage(TOKEN, null);
        assertThat(((CanonicalOrderSummary) first.records().get(0)).orderCount()).isEqualTo(1);

        // Page 2 re-delivers PO1 alongside the genuinely new PO2.
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"),
                lcsItem("PO2", "O2", "2026-06-11T23:00:00+09:00"))));
        http.enqueue(FakeNaverHttpClient.ok(detailBody(detailItem("PO2", 20000L))));
        FetchPage second = client.fetchOrderSummaryPage(TOKEN, first.nextCursorValue());

        assertThat(http.sent.get(3).jsonBody()).contains("PO2").doesNotContain("PO1");
        CanonicalOrderSummary summary = (CanonicalOrderSummary) second.records().get(0);
        assertThat(summary.orderCount()).isEqualTo(2);
        assertThat(summary.salesAmount()).isEqualTo(30000L);
    }

    @Test
    void boundaryStampedStragglerIsSkippedInBothWindowsAndNeverCounted() {
        // Old paymentDate (beyond the horizon) AND stamped on the window boundary:
        // skipped as a straggler now, edge-captured, and skipped again when the
        // next window re-delivers it — never counted, never queried for detail.
        String window1 = "{\"windowFrom\":\"2026-06-10T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        String stragglerOnBoundary =
                "{\"productOrderId\":\"PO1\",\"orderId\":\"O1\",\"productOrderStatus\":\"PAYED\","
                        + "\"lastChangedType\":\"PAYED\",\"lastChangedDate\":\"2026-06-11T15:00:00+09:00\","
                        + "\"paymentDate\":\"2026-06-05T10:00:00+09:00\"}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null, stragglerOnBoundary)));
        FetchPage first = client.fetchOrderSummaryPage(TOKEN, window1);
        assertThat(first.records()).isEmpty();

        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null, stragglerOnBoundary)));
        FetchPage second = client.fetchOrderSummaryPage(TOKEN, first.nextCursorValue());

        assertThat(second.records()).isEmpty();
        assertThat(http.sent).hasSize(2); // two LCS calls, zero detail calls
    }

    @Test
    void stragglerOlderThanEmissionHorizonIsSkippedNotPartiallyOverwritten() {
        // paymentDate 2026-06-05 is before the horizon (windowFrom date - 2d =
        // 2026-06-08): its carried total was pruned long ago, so emitting would
        // overwrite a final daily total with a partial recount — skip instead.
        String cursor = "{\"windowFrom\":\"2026-06-10T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                "{\"productOrderId\":\"PO1\",\"orderId\":\"O1\",\"productOrderStatus\":\"PAYED\","
                        + "\"lastChangedType\":\"PAYED\",\"lastChangedDate\":\"2026-06-10T16:00:00+09:00\","
                        + "\"paymentDate\":\"2026-06-05T10:00:00+09:00\"}")));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, cursor);

        assertThat(http.sent).hasSize(1); // no detail call for a skipped straggler
        assertThat(page.records()).isEmpty();
        assertThat(page.nextCursorValue()).doesNotContain("2026-06-05");
    }

    @Test
    void semanticallyInvalidCursorFailsAsCursorError() {
        // Parseable JSON, impossible window: windowTo precedes windowFrom.
        String cursor = "{\"windowFrom\":\"2026-06-12T15:00+09:00\",\"windowTo\":\"2026-06-11T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, cursor))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("커서")
                .hasMessageNotContaining(TOKEN);
        assertThat(http.sent).isEmpty();
    }

    @Test
    void zeroWidthSettledWindowReExtendsToNowInsteadOfQueryingZeroWidth() {
        // After a backfill catches up, advanced() can leave windowTo == windowFrom at a
        // PAST instant. A later run (now beyond it) must re-query (windowFrom, now], never
        // a zero-width [from == to] range, which Naver rejects with HTTP 400.
        // windowFrom == windowTo == 14:00 KST; NOW = 15:00 KST.
        String cursor = "{\"windowFrom\":\"2026-06-12T14:00:00.000+09:00\","
                + "\"windowTo\":\"2026-06-12T14:00:00.000+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, cursor);

        assertThat(http.sent).hasSize(1); // a real query was issued, not skipped
        String query = http.sent.get(0).uri().getQuery(); // decoded
        // from stays at 14:00; to is widened to now (15:00) — a non-empty window.
        assertThat(query).contains("lastChangedFrom=2026-06-12T14:00:00.000+09:00");
        assertThat(query).contains("lastChangedTo=2026-06-12T15:00:00.000+09:00");
        Matcher from = Pattern.compile("lastChangedFrom=([^&]+)").matcher(query);
        Matcher to = Pattern.compile("lastChangedTo=([^&]+)").matcher(query);
        assertThat(from.find()).isTrue();
        assertThat(to.find()).isTrue();
        assertThat(from.group(1)).isNotEqualTo(to.group(1)); // never zero-width
        assertThat(page.hasMore()).isFalse(); // [14:00,15:00] advances to caught-up
    }

    @Test
    void caughtUpZeroWidthWindowAtNowStillMakesNoHttpCall() {
        // windowFrom == windowTo == NOW (15:00 KST): genuinely caught up to the present,
        // nothing to widen — no HTTP call, distinct from the past-instant case above.
        String cursor = "{\"windowFrom\":\"2026-06-12T15:00:00.000+09:00\","
                + "\"windowTo\":\"2026-06-12T15:00:00.000+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, cursor);

        assertThat(http.sent).isEmpty();
        assertThat(page.records()).isEmpty();
        assertThat(page.hasMore()).isFalse();
    }

    @Test
    void caughtUpCursorReturnsEmptyPageWithoutAnyHttpCall() {
        String cursor = "{\"windowFrom\":\"2026-06-12T15:00+09:00\",\"windowTo\":\"2026-06-12T15:00+09:00\","
                + "\"moreFrom\":null,\"moreSequence\":null,\"dayTotals\":{}}";

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, cursor);

        assertThat(http.sent).isEmpty();
        assertThat(page.records()).isEmpty();
        assertThat(page.hasMore()).isFalse();
    }

    @Test
    void malformedCursorFailsSafely() {
        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, "not-json"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("커서")
                .hasMessageNotContaining(TOKEN);
        assertThat(http.sent).isEmpty();
    }

    // --- non-2xx diagnostics (sanitized, non-PII) ---

    @Test
    void nonOkLastChangedAppendsSanitizedNaverCodeAndMessage() {
        http.enqueue(new NaverHttpClient.Response(400,
                "{\"code\":\"GW.INVALID_PARAM\",\"message\":\"lastChangedTo 형식 오류\"}", Map.of()));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("변경 주문 조회에 실패")
                .hasMessageContaining("HTTP 400")
                .hasMessageContaining("code=GW.INVALID_PARAM")
                .hasMessageContaining("message=lastChangedTo 형식 오류")
                .hasMessageNotContaining(TOKEN);
    }

    @Test
    void nonOkDetailQueryAlsoAppendsSanitizedNaverError() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null,
                lcsItem("PO1", "O1", "2026-06-11T22:00:00+09:00"))));
        http.enqueue(new NaverHttpClient.Response(403,
                "{\"code\":\"GW.FORBIDDEN\",\"message\":\"권한이 없습니다\"}", Map.of()));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("주문 상세 조회에 실패")
                .hasMessageContaining("HTTP 403")
                .hasMessageContaining("code=GW.FORBIDDEN");
    }

    @Test
    void longNaverErrorMessageIsTruncated() {
        http.enqueue(new NaverHttpClient.Response(400,
                "{\"message\":\"" + "x".repeat(500) + "\"}", Map.of()));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 400")
                .hasMessageContaining("…")                       // truncation marker
                .hasMessageNotContaining("x".repeat(300));       // 500 x's capped at 200
    }

    @Test
    void malformedErrorBodyFallsBackToBareStatusWithoutEchoingBytes() {
        http.enqueue(new NaverHttpClient.Response(400, "not-json <html>boom</html>", Map.of()));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 400")
                .hasMessageNotContaining("[")        // no sanitized-detail block
                .hasMessageNotContaining("not-json") // raw body never echoed
                .hasMessageNotContaining("boom");
    }

    @Test
    void nestedAndUnknownErrorFieldsAreNeverLeaked() {
        // A body mixing a safe scalar with nested/array fields that could hold PII.
        http.enqueue(new NaverHttpClient.Response(400,
                "{\"code\":\"GW.X\",\"data\":{\"buyerName\":\"홍길동\",\"phone\":\"010-1234-5678\"},"
                        + "\"orders\":[{\"productOrderId\":\"PO-SECRET\"}]}", Map.of()));

        assertThatThrownBy(() -> client.fetchOrderSummaryPage(TOKEN, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("code=GW.X")
                .hasMessageNotContaining("홍길동")
                .hasMessageNotContaining("010-1234-5678")
                .hasMessageNotContaining("PO-SECRET")
                .hasMessageNotContaining("buyerName");
    }

    // --- read-only order-access probe (connect-test) ---

    @Test
    void probeConfirmsOnOkWithOneReadOnlyGetAndNoDetailCall() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null, lcsItem("PO1", "O1",
                "2026-06-12T14:59:00+09:00"))));

        NaverOrdersClient.OrderAccessProbe probe = client.probeOrderAccess(TOKEN);

        assertThat(probe).isEqualTo(NaverOrdersClient.OrderAccessProbe.CONFIRMED);
        // Exactly one GET (last-changed), never a detail POST, never a persisted cursor.
        assertThat(http.sent).hasSize(1);
        assertThat(http.sent.get(0).method()).isEqualTo("GET");
        String uri = http.sent.get(0).uri().toString();
        assertThat(uri).contains("last-changed-statuses");
        assertThat(uri).contains("lastChangedType=PAYED");
    }

    @Test
    void probeWindowIsNonZeroAndUsesTheConfirmedWireFormat() {
        http.enqueue(FakeNaverHttpClient.ok(lcsBody(null)));

        client.probeOrderAccess(TOKEN);

        String query = http.sent.get(0).uri().getQuery(); // decoded
        String from = firstGroup(query, "lastChangedFrom=([^&]+)");
        String to = firstGroup(query, "lastChangedTo=([^&]+)");
        String millisOffset = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\+09:00";
        // 3-digit-millisecond ISO offset — the same format the proven first-collection call uses.
        assertThat(from).matches(millisOffset);
        assertThat(to).matches(millisOffset);
        // A zero-width window is what Naver rejects with HTTP 400; the probe must span time.
        assertThat(OffsetDateTime.parse(from).toInstant()).isBefore(OffsetDateTime.parse(to).toInstant());
    }

    private static String firstGroup(String haystack, String regex) {
        Matcher m = Pattern.compile(regex).matcher(haystack);
        assertThat(m.find()).as("matches %s", regex).isTrue();
        return m.group(1);
    }

    @Test
    void probeReturnsAccessDeniedOnForbiddenWithUnrecognizedCode() {
        // 403 is order-access-denied by HTTP-standard meaning; the code cannot yet be
        // split into permission vs call-IP, so the hedged verdict is returned — never guessed.
        http.enqueue(new NaverHttpClient.Response(403,
                "{\"code\":\"GW.FORBIDDEN\",\"message\":\"권한이 없습니다\"}", Map.of()));

        assertThat(client.probeOrderAccess(TOKEN))
                .isEqualTo(NaverOrdersClient.OrderAccessProbe.ACCESS_DENIED);
    }

    @Test
    void probeIsRateLimitedOn429() {
        http.enqueue(FakeNaverHttpClient.rateLimited429());

        assertThat(client.probeOrderAccess(TOKEN))
                .isEqualTo(NaverOrdersClient.OrderAccessProbe.RATE_LIMITED);
    }

    @Test
    void probeIsUnavailableOnServerErrorMalformedParamAndNetworkFailure() {
        http.enqueue(new NaverHttpClient.Response(500, "{\"code\":\"GW.INTERNAL\"}", Map.of()));
        assertThat(client.probeOrderAccess(TOKEN))
                .isEqualTo(NaverOrdersClient.OrderAccessProbe.UNAVAILABLE);

        // A malformed-param 400 is a we-side error, not a denial — inconclusive.
        http.enqueue(new NaverHttpClient.Response(400,
                "{\"code\":\"GW.INVALID_PARAM\",\"message\":\"형식 오류\"}", Map.of()));
        assertThat(client.probeOrderAccess(TOKEN))
                .isEqualTo(NaverOrdersClient.OrderAccessProbe.UNAVAILABLE);

        // An at-resource 401 despite a minted token is transient, not a denial.
        http.enqueue(new NaverHttpClient.Response(401, "{\"code\":\"GW.UNAUTHORIZED\"}", Map.of()));
        assertThat(client.probeOrderAccess(TOKEN))
                .isEqualTo(NaverOrdersClient.OrderAccessProbe.UNAVAILABLE);

        http.enqueueNetworkFailure();
        assertThat(client.probeOrderAccess(TOKEN))
                .isEqualTo(NaverOrdersClient.OrderAccessProbe.UNAVAILABLE);
    }

    @Test
    void probeNeverEchoesTokenOrProviderBodyOnForbidden() {
        // The probe returns only a classification enum — no throw, no message carrying the
        // token or the (potentially PII-bearing) provider body.
        http.enqueue(new NaverHttpClient.Response(403,
                "{\"code\":\"GW.FORBIDDEN\",\"data\":{\"buyerName\":\"홍길동\"}}", Map.of()));

        NaverOrdersClient.OrderAccessProbe probe = client.probeOrderAccess(TOKEN);

        assertThat(probe).isEqualTo(NaverOrdersClient.OrderAccessProbe.ACCESS_DENIED);
        assertThat(http.sent.get(0).bearer()).isEqualTo(TOKEN); // token used as bearer, never in output
    }

    @Test
    void successfulResponseBodyIsNeverRoutedThroughErrorDiagnostics() {
        // A 200 body carrying a "message" field is parsed as data, never surfaced as an
        // error detail — httpErrorDetail runs only on the non-2xx path.
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"data\":{\"lastChangeStatuses\":[],\"more\":null},\"message\":\"should-not-surface\"}"));

        FetchPage page = client.fetchOrderSummaryPage(TOKEN, null);

        assertThat(page.records()).isEmpty(); // normal empty page, no throw, no leak
    }
}
