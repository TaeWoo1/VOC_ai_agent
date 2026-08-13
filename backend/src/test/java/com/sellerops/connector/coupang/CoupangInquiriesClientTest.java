package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Coupang 상품별 고객문의 collection contract, against the recording fake HTTP boundary.
 *
 * <p>What these pin, in order of how much damage getting them wrong would do: <b>no buyer PII ever
 * reaches a canonical row</b>, the platform's own answered classification is what decides status,
 * the request is the officially documented one and the signature covers the query actually sent,
 * an unrepresentable row is dropped rather than fabricated <i>and</i> never wedges the stream, and
 * every failure mode (throttle, empty body, wrong shape, runaway paging) fails closed without
 * echoing a provider value.
 */
class CoupangInquiriesClientTest {

    /** KST 2026-08-05 11:00 — the swept window is deterministic. */
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-05T02:00:00Z"), ZoneOffset.UTC);
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    private static final String TEST_APPROVAL_ID = "apr-test-approval";
    /** Records the pauses the sweep asks for instead of taking them — no test ever sleeps. */
    private final List<Long> pauses = new ArrayList<>();
    private final CoupangInquiriesClient client = new CoupangInquiriesClient(
            http, new CoupangSigner(clock), clock, "https://api-gateway.coupang.com", TEST_APPROVAL_ID,
            pauses::add);

    private static final String ACCESS_KEY = "AK-1";
    private static final String SECRET_KEY = "SK-1";
    private static final String VENDOR_ID = "A00012345";

    private FetchPage fetch(String cursorValue) {
        return client.fetchInquiryPage(ACCESS_KEY, SECRET_KEY, VENDOR_ID, cursorValue);
    }

    @SuppressWarnings("unchecked")
    private static List<CanonicalInquiry> rowsOf(FetchPage page) {
        return (List<CanonicalInquiry>) page.records();
    }

    private static CoupangHttpClient.Response json(int status, String body) {
        return new CoupangHttpClient.Response(status, body, Map.of("Content-Type", "application/json"));
    }

    /** One provider page: the given item JSON blobs, with pagination saying this is the last page. */
    private static String page(String... items) {
        return page(1, 1, items);
    }

    private static String page(int currentPage, int totalPages, String... items) {
        return "{\"code\":200,\"message\":\"OK\",\"data\":{\"content\":[" + String.join(",", items)
                + "],\"pagination\":{\"currentPage\":" + currentPage + ",\"totalPages\":" + totalPages
                + ",\"totalElements\":" + items.length + ",\"countPerPage\":50}}}";
    }

    private static String inquiry(long id, long sellerProductId, String content, String inquiryAt) {
        return "{\"inquiryId\":" + id + ",\"productId\":77,\"sellerProductId\":" + sellerProductId
                + ",\"sellerItemId\":88,\"vendorItemId\":99,\"content\":\"" + content
                + "\",\"inquiryAt\":\"" + inquiryAt + "\",\"orderIds\":[123],"
                + "\"commentDtoList\":[{\"inquiryCommentId\":5,\"inquiryId\":" + id
                + ",\"content\":\"판매자 답변\",\"inquiryCommentAt\":\"2026-08-04T10:00:00\"}]}";
    }

    /** Enqueue an empty page for each of the two answered buckets. */
    private void enqueueEmptyBuckets() {
        for (int i = 0; i < CoupangInquiriesClient.ANSWERED_TYPES.size(); i++) {
            http.enqueue(json(200, page()));
        }
    }

    // --- the official request ---------------------------------------------

    @Test
    void sweepsBothAnsweredBucketsWithTheOfficiallyDocumentedQuery() {
        enqueueEmptyBuckets();

        fetch(null);

        assertThat(http.sent).hasSize(2);
        String first = http.sent.get(0).uri().toString();
        assertThat(first).startsWith(
                "https://api-gateway.coupang.com/v2/providers/openapi/apis/api/v5/vendors/"
                        + VENDOR_ID + "/onlineInquiries?");
        // The window is the cursor's first backfill window: 7 KST dates ending today.
        assertThat(first).contains("inquiryStartAt=2026-07-30").contains("inquiryEndAt=2026-08-05");
        assertThat(first).contains("pageNum=1").contains("pageSize=50");
        // NOANSWER first, ANSWERED second — the order that makes ANSWERED win a race.
        assertThat(first).contains("answeredType=NOANSWER");
        assertThat(http.sent.get(1).uri().toString()).contains("answeredType=ANSWERED");
        // vendorId is the path segment, never repeated as a query parameter.
        assertThat(first.substring(first.indexOf('?'))).doesNotContain("vendorId=");
    }

    @Test
    void theSignatureCoversTheExactQueryThatWasSent() {
        enqueueEmptyBuckets();

        fetch(null);

        FakeCoupangHttpClient.Sent sent = http.sent.get(0);
        String query = sent.uri().getRawQuery();
        String expected = CoupangSigner.authorization(ACCESS_KEY, SECRET_KEY,
                new CoupangSigner(clock).signedDate(), "GET", sent.uri().getPath(), query);
        // A signature over a different query string than the one on the wire is a 401 that looks
        // like a bad credential — the exact misdiagnosis the connect test exists to avoid.
        assertThat(sent.headers().get("Authorization")).isEqualTo(expected);
        assertThat(sent.headers()).containsEntry("X-Requested-By", VENDOR_ID);
        assertThat(sent.headers()).containsEntry("X-MARKET", "KR");
    }

    // --- mapping ----------------------------------------------------------

    @Test
    void mapsToACanonicalInquiryKeyedByAPrefixedExternalId() {
        http.enqueue(json(200, page(inquiry(4001, 555, "언제 배송되나요", "2026-08-04T09:30:00"))));
        http.enqueue(json(200, page()));

        List<CanonicalInquiry> rows = rowsOf(fetch(null));

        assertThat(rows).hasSize(1);
        CanonicalInquiry row = rows.get(0);
        // Namespaced: a future 고객센터 stream numbers its inquiries independently, and an unprefixed
        // id would silently merge two different inquiries onto one dedup key.
        assertThat(row.externalId()).isEqualTo("onlineInquiry:4001");
        assertThat(row.body()).isEqualTo("언제 배송되나요");
        assertThat(row.sku()).isEqualTo("555");
        assertThat(row.productName()).isNull();
        assertThat(row.title()).isNull();
        // The bare local timestamp is read as KST, matching the window the query asked for.
        assertThat(row.receivedAt()).isEqualTo(Instant.parse("2026-08-04T00:30:00Z"));
    }

    @Test
    void theAnsweredBucketTheRowArrivedInIsItsStatus() {
        http.enqueue(json(200, page(inquiry(1, 10, "열린 문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page(inquiry(2, 10, "답변된 문의", "2026-08-03T09:00:00"))));

        List<CanonicalInquiry> rows = rowsOf(fetch(null));

        assertThat(rows).extracting(CanonicalInquiry::externalId, CanonicalInquiry::status,
                        CanonicalInquiry::informStatus)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple("onlineInquiry:1", "UNANSWERED", "NOANSWER"),
                        org.assertj.core.groups.Tuple.tuple("onlineInquiry:2", "ANSWERED", "ANSWERED"));
    }

    @Test
    void anInquiryAnsweredBetweenTheTwoCallsIsRecordedAnsweredNotLeftFalselyOpen() {
        // The same inquiry appears in BOTH buckets — the seller answered it mid-sweep.
        http.enqueue(json(200, page(inquiry(7, 10, "문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page(inquiry(7, 10, "문의", "2026-08-04T09:00:00"))));

        List<CanonicalInquiry> rows = rowsOf(fetch(null));

        assertThat(rows).hasSize(1);
        // Falsely open is the harmful direction: it opens a seller task for work already done.
        assertThat(rows.get(0).status()).isEqualTo("ANSWERED");
    }

    @Test
    void theProductKeyFallsBackFromSellerProductIdToOptionIdThenToThePlaceholder() {
        http.enqueue(json(200, page(
                "{\"inquiryId\":1,\"vendorItemId\":9001,\"content\":\"옵션만\",\"inquiryAt\":\"2026-08-04T09:00:00\"}",
                "{\"inquiryId\":2,\"content\":\"상품키 없음\",\"inquiryAt\":\"2026-08-04T09:00:00\"}")));
        http.enqueue(json(200, page()));

        List<CanonicalInquiry> rows = rowsOf(fetch(null));

        assertThat(rows.get(0).sku()).isEqualTo("9001");
        assertThat(rows.get(0).productName()).isNull();
        // No key at all: the shared placeholder bucket, never an invented product name.
        assertThat(rows.get(1).sku()).isNull();
        assertThat(rows.get(1).productName()).isEqualTo("(미지정 상품)");
    }

    @Test
    void buyerContactFieldsAreNeverCarriedEvenWhenThePayloadContainsThem() {
        // This endpoint is documented to carry no buyer PII — but "the provider added a field" must
        // not become "SellerOps started storing it". Undeclared fields are inert by construction.
        http.enqueue(json(200, page(
                "{\"inquiryId\":1,\"sellerProductId\":5,\"content\":\"문의 본문\","
                        + "\"inquiryAt\":\"2026-08-04T09:00:00\",\"buyerEmail\":\"buyer@example.com\","
                        + "\"buyerPhone\":\"010-0000-0000\",\"buyerName\":\"홍길동\"}")));
        http.enqueue(json(200, page()));

        List<CanonicalInquiry> rows = rowsOf(fetch(null));

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).author()).isNull();
        // Nothing anywhere on the record — not the body, not a stray field, not the toString.
        assertThat(rows.get(0).toString())
                .doesNotContain("buyer@example.com")
                .doesNotContain("010-0000-0000")
                .doesNotContain("홍길동");
    }

    @Test
    void theDeclaredResponseFieldsAreOnlyTheOnesThisClientReads() {
        // A structural guard on the DTO: adding a PII-bearing component here should have to be a
        // deliberate act that breaks this test, not a quiet widening.
        assertThat(CoupangInquiriesClient.OnlineInquiry.class.getRecordComponents())
                .extracting(java.lang.reflect.RecordComponent::getName)
                .containsExactlyInAnyOrder("inquiryId", "sellerProductId", "vendorItemId",
                        "content", "inquiryAt");
    }

    // --- rows that cannot be represented ----------------------------------

    @Test
    void unrepresentableRowsAreDroppedAndThePageStillLands() {
        http.enqueue(json(200, page(
                // No id → no dedup key; re-collecting would duplicate it forever.
                "{\"sellerProductId\":5,\"content\":\"아이디 없음\",\"inquiryAt\":\"2026-08-04T09:00:00\"}",
                // No text → nothing to show a seller, and the column is NOT NULL.
                "{\"inquiryId\":2,\"sellerProductId\":5,\"content\":\"  \",\"inquiryAt\":\"2026-08-04T09:00:00\"}",
                // Unparseable time → placing it would be a guess.
                "{\"inquiryId\":3,\"sellerProductId\":5,\"content\":\"시각 없음\",\"inquiryAt\":\"어제\"}",
                inquiry(4, 5, "정상 문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page()));

        FetchPage result = fetch(null);

        // The good row lands. Failing the whole page would re-fetch the same bad rows on every
        // retry, so the cursor could never advance past them — a permanently wedged stream.
        assertThat(rowsOf(result)).extracting(CanonicalInquiry::externalId)
                .containsExactly("onlineInquiry:4");
    }

    @Test
    void aTimestampIsReadAsKstUnlessItCarriesItsOwnOffset() {
        assertThat(CoupangInquiriesClient.parseKstInstant("2026-08-04T09:30:00+09:00"))
                .isEqualTo(Instant.parse("2026-08-04T00:30:00Z"));
        assertThat(CoupangInquiriesClient.parseKstInstant("2026-08-04T09:30:00"))
                .isEqualTo(Instant.parse("2026-08-04T00:30:00Z"));
        assertThat(CoupangInquiriesClient.parseKstInstant("2026-08-04"))
                .isEqualTo(Instant.parse("2026-08-03T15:00:00Z"));
        // Never a fallback to now(): a fabricated receipt time misleads every recency judgement.
        assertThat(CoupangInquiriesClient.parseKstInstant("어제")).isNull();
        assertThat(CoupangInquiriesClient.parseKstInstant("")).isNull();
        assertThat(CoupangInquiriesClient.parseKstInstant(null)).isNull();
    }

    // --- paging -----------------------------------------------------------

    @Test
    void pagesToTheReportedTotalThenStops() {
        http.enqueue(json(200, page(1, 2, inquiry(1, 5, "1페이지", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page(2, 2, inquiry(2, 5, "2페이지", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page(1, 1)));

        List<CanonicalInquiry> rows = rowsOf(fetch(null));

        assertThat(rows).hasSize(2);
        assertThat(http.sent).hasSize(3);
        assertThat(http.sent.get(0).uri().toString()).contains("pageNum=1");
        assertThat(http.sent.get(1).uri().toString()).contains("pageNum=2");
    }

    @Test
    void aShortPageWithNoPaginationEndsTheWindowSafely() {
        // No page total, but the page is short — a short page is an end-of-data signal on its own.
        http.enqueue(json(200, "{\"code\":200,\"data\":{\"content\":["
                + inquiry(1, 5, "문의", "2026-08-04T09:00:00") + "]}}"));
        http.enqueue(json(200, page()));

        assertThat(rowsOf(fetch(null))).hasSize(1);
        assertThat(http.sent).hasSize(2);
    }

    @Test
    void aFullPageWithNoPaginationFailsClosedRatherThanSilentlyTruncating() {
        // A full page and no total: there may be a second page and there is no way to tell. Stopping
        // here would drop inquiries and report success — the worst of the three options.
        StringBuilder items = new StringBuilder();
        for (int i = 1; i <= CoupangInquiriesClient.MAX_PAGE_SIZE; i++) {
            items.append(i > 1 ? "," : "").append(inquiry(i, 5, "문의", "2026-08-04T09:00:00"));
        }
        http.enqueue(json(200, "{\"code\":200,\"data\":{\"content\":[" + items + "]}}"));

        assertThatThrownBy(() -> fetch(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("페이지 정보가 없어");
    }

    @Test
    void aProviderThatNeverEndsItsPagingFailsClosedInsteadOfLoopingForever() {
        // totalPages far beyond the bound, always a full page: the defensive limit is the only
        // thing between this and an unbounded loop against a live gateway.
        for (int i = 0; i <= CoupangInquiriesClient.MAX_PAGES_PER_TYPE; i++) {
            http.enqueue(json(200, page(i + 1, 100_000, inquiry(i + 1, 5, "문의", "2026-08-04T09:00:00"))));
        }

        assertThatThrownBy(() -> fetch(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("페이지 상한");
        // The bound is a ceiling on REQUESTS, not on the page number it gives up at.
        assertThat(http.sent).hasSize(CoupangInquiriesClient.MAX_PAGES_PER_TYPE);
    }

    // --- failure modes ----------------------------------------------------

    @Test
    void aThrottledResponseSurfacesAsTheRateLimitSignal() {
        http.enqueue(new CoupangHttpClient.Response(429, "{\"message\":\"too many\"}", Map.of()));

        assertThatThrownBy(() -> fetch(null)).isInstanceOf(CoupangRateLimitedException.class);
    }

    @Test
    void anEmptyOrMisshapedTwoHundredBodyFailsClosedWithoutEchoingValues() {
        http.enqueue(json(200, ""));
        assertThatThrownBy(() -> fetch(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("비어 있");

        http.sent.clear();
        http.enqueue(json(200, "{\"data\":{\"content\":\"문의 본문이 통째로 문자열\"}}"));
        assertThatThrownBy(() -> fetch(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("해석할 수 없습니다")
                // The binding path (field NAMES) is actionable; the value never is.
                .hasMessageContaining("위치=")
                .hasMessageNotContaining("문의 본문이 통째로 문자열");
    }

    @Test
    void aNonOkStatusReportsOnlyTheSafeScalarErrorFields() {
        http.enqueue(json(403, "{\"code\":403,\"message\":\"[FORBIDDEN] Not allowed IP\","
                + "\"data\":{\"vendorId\":\"A00012345\",\"secretHint\":\"do-not-echo\"}}"));

        assertThatThrownBy(() -> fetch(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("HTTP 403")
                .hasMessageContaining("Not allowed IP")
                .hasMessageNotContaining("do-not-echo");
    }

    // --- rate limiting ----------------------------------------------------

    @Test
    void theSweepPacesItselfUnderTheDocumentedPerVendorRateLimit() {
        // The live proof took a 429 mid-sweep: 10 back-to-back calls is ~6/s against a documented
        // ceiling of 5/s. Every call after the first now waits.
        enqueueEmptyBuckets();

        fetch(null);

        assertThat(http.sent).hasSize(2);
        assertThat(pauses).hasSize(1);
        assertThat(pauses.get(0)).isEqualTo(CoupangInquiriesClient.MIN_CALL_INTERVAL_MS);
        // 4 calls/s — under the documented 5/s, with margin, because the limit is per vendorId and
        // the order stream may be sweeping the same vendor at the same time.
        assertThat(1000.0 / CoupangInquiriesClient.MIN_CALL_INTERVAL_MS).isLessThan(5.0);
    }

    @Test
    void theFirstCallIsNotDelayed() {
        http.enqueue(json(200, page(inquiry(1, 5, "문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page()));

        fetch(null);

        // A run that collects one window should not pay a pause it does not owe.
        assertThat(pauses).hasSize(1);
    }

    @Test
    void everyPagedCallIsPacedToo() {
        // Paging is where a burst actually comes from: pages within a bucket are back to back.
        http.enqueue(json(200, page(1, 3, inquiry(1, 5, "문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page(2, 3, inquiry(2, 5, "문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page(3, 3, inquiry(3, 5, "문의", "2026-08-04T09:00:00"))));
        http.enqueue(json(200, page()));

        fetch(null);

        assertThat(http.sent).hasSize(4);
        assertThat(pauses).hasSize(3);
        assertThat(pauses).allMatch(p -> p == CoupangInquiriesClient.MIN_CALL_INTERVAL_MS);
    }

    @Test
    void theSignatureIsStampedAfterThePauseNotBeforeIt() {
        // A signed-date is only valid for a few minutes. Signing and then sleeping would spend that
        // budget on our own throttle — so the pause must happen first, and this pins the order.
        String source = readClientSource();
        int paceCall = source.indexOf("pace();");
        int signCall = source.indexOf("signer.authorization(");
        assertThat(paceCall).isGreaterThan(0);
        assertThat(paceCall).isLessThan(signCall);
    }

    private static String readClientSource() {
        try {
            return java.nio.file.Files.readString(java.nio.file.Path.of(
                    "src/main/java/com/sellerops/connector/coupang/CoupangInquiriesClient.java"));
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }

    // --- cursor integration -----------------------------------------------

    @Test
    void theBackfillWalksBackwardAcrossFetchesAndThenSettlesIntoTheRoutineWindow() {
        String cursor = null;
        String firstFrom = null;
        int guard = 0;
        boolean more = true;
        while (more && guard++ < 50) {
            enqueueEmptyBuckets();
            http.sent.clear();
            FetchPage page = fetch(cursor);
            assertThat(page.dataType()).isEqualTo(DataType.INQUIRY);
            String uri = http.sent.get(0).uri().toString();
            if (firstFrom == null) {
                firstFrom = uri;
            }
            cursor = page.nextCursorValue();
            more = page.hasMore();
        }
        assertThat(guard).isLessThan(50);

        // Settled: the next run is the terminal routine window ending today.
        enqueueEmptyBuckets();
        http.sent.clear();
        FetchPage routine = fetch(cursor);
        assertThat(routine.hasMore()).isFalse();
        assertThat(http.sent.get(0).uri().toString())
                .contains("inquiryStartAt=2026-08-03").contains("inquiryEndAt=2026-08-05");
    }

    @Test
    void aCorruptCursorFailsClosedWithoutEchoingIt() {
        assertThatThrownBy(() -> fetch("{not-json"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("커서를 해석할 수 없습니다")
                .hasMessageNotContaining("{not-json");
        assertThat(http.sent).isEmpty();
    }
}
