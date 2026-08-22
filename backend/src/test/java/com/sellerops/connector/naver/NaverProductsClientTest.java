package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalProduct;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * The PRODUCT lane's <b>recurrence</b> contract, and the honesty of what its one endpoint returns.
 *
 * <p>PRODUCT has no window and no changed-since parameter, so the only question a schedule raises is
 * whether a second cycle can still see a product the first cycle already read. It could not: the
 * runtime persists {@code nextCursorValue}, the sweep handed back the page AFTER the last one, and the
 * demo org's stored cursor sat at {@code 3} against a two-page catalogue. Every assertion about the
 * cursor here is that defect, written down.
 *
 * <p>The mapping assertions are the second half: a listing this endpoint does not carry must arrive as
 * absent, never as a plausible-looking value. Measured live on 2026-08-22 — 69 listings, zero of them
 * carrying a URL, an option combination, a detail body or a seller management code.
 */
class NaverProductsClientTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final String TOKEN = "tok-1";
    private static final Instant NOW = Instant.parse("2026-08-22T12:00:00Z");

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final NaverProductsClient client =
            new NaverProductsClient(http, Clock.fixed(NOW, ZoneOffset.UTC), BASE_URL);

    // --- fixtures ---

    /** One channel listing under one origin product, with only the fields the live endpoint sent. */
    private static String listing(long channelProductNo, String name) {
        return "{\"originProductNo\":" + (channelProductNo - 1) + ",\"channelProducts\":["
                + "{\"channelProductNo\":" + channelProductNo + ",\"name\":\"" + name + "\","
                + "\"statusType\":\"SALE\",\"salePrice\":12900,"
                + "\"wholeCategoryName\":\"생활/건강\",\"brandName\":\"선바로\","
                + "\"manufacturerName\":\"선바로산업\","
                + "\"modifiedDate\":\"2026-07-01T09:00:00.000+09:00\"}]}";
    }

    private static String searchBody(int count) {
        List<String> rows = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            rows.add(listing(6473457700L + i, "상품 " + i));
        }
        return "{\"totalElements\":" + count + ",\"contents\":[" + String.join(",", rows) + "]}";
    }

    private static int requestedPage(FakeNaverHttpClient.Sent sent) {
        String body = sent.jsonBody();
        String marker = "\"page\":";
        int at = body.indexOf(marker) + marker.length();
        int end = at;
        while (end < body.length() && Character.isDigit(body.charAt(end))) {
            end++;
        }
        return Integer.parseInt(body.substring(at, end));
    }

    // --- recurrence ---

    /**
     * The defect this whole contract exists for: without the restart, cycle 2 asks for page 3 of a
     * two-page catalogue, reads nothing, and no price change on any of the 69 products is ever seen
     * again.
     */
    @Test
    void aFinishedSweepRestartsAtPageOneSoTheNextCycleReObservesTheCatalogue() {
        http.enqueue(FakeNaverHttpClient.ok(searchBody(NaverProductsClient.PAGE_SIZE)));
        FetchPage first = client.fetchProductPage(TOKEN, null);

        assertThat(requestedPage(http.sent.get(0))).isEqualTo(1);
        assertThat(first.hasMore()).as("a full page means there may be more").isTrue();
        assertThat(first.nextCursorValue()).isEqualTo("2");

        http.enqueue(FakeNaverHttpClient.ok(searchBody(19)));
        FetchPage last = client.fetchProductPage(TOKEN, first.nextCursorValue());

        assertThat(requestedPage(http.sent.get(1))).isEqualTo(2);
        assertThat(last.hasMore()).isFalse();
        assertThat(last.nextCursorValue())
                .as("the sweep ends by pointing at the START of the catalogue, not past its end")
                .isEqualTo(NaverProductsClient.FIRST_PAGE);
    }

    /** A cursor parked past the catalogue by an older build heals itself in one empty page. */
    @Test
    void aCursorLeftPastTheEndOfTheCatalogueHealsInsteadOfStayingBlind() {
        http.enqueue(FakeNaverHttpClient.ok("{\"totalElements\":69,\"contents\":[]}"));

        FetchPage page = client.fetchProductPage(TOKEN, "3");

        assertThat(requestedPage(http.sent.get(0))).isEqualTo(3);
        assertThat(page.records()).isEmpty();
        assertThat(page.hasMore()).isFalse();
        assertThat(page.nextCursorValue()).isEqualTo(NaverProductsClient.FIRST_PAGE);
    }

    /**
     * Mid-sweep progress is still kept. Resetting on every page would make a rate-limited run restart
     * the catalogue forever instead of finishing it.
     */
    @Test
    void aMidSweepPageStillAdvancesSoAnInterruptedRunResumes() {
        http.enqueue(FakeNaverHttpClient.ok(searchBody(NaverProductsClient.PAGE_SIZE)));

        FetchPage page = client.fetchProductPage(TOKEN, "4");

        assertThat(page.hasMore()).isTrue();
        assertThat(page.nextCursorValue()).isEqualTo("5");
    }

    @Test
    void anUnreadableCursorStartsTheSweepRatherThanGuessingAPage() {
        http.enqueue(FakeNaverHttpClient.ok(searchBody(1)));

        client.fetchProductPage(TOKEN, "not-a-page");

        assertThat(requestedPage(http.sent.get(0))).isEqualTo(1);
    }

    // --- what the endpoint actually carries ---

    /**
     * Live on 2026-08-22 the list resource returned none of these four for any of 69 listings. They are
     * mapped here, so this asserts the absence arrives as absence — a fabricated storefront URL or an
     * invented option row would be a claim about the seller's catalogue that nobody observed.
     */
    @Test
    void fieldsTheListResourceDoesNotSendArriveAbsentRatherThanInvented() {
        http.enqueue(FakeNaverHttpClient.ok(searchBody(1)));

        FetchPage page = client.fetchProductPage(TOKEN, null);

        CanonicalProduct row = (CanonicalProduct) page.records().get(0);
        assertThat(row.productUrl()).isNull();
        assertThat(row.description()).isNull();
        assertThat(row.variants()).isEmpty();
        // With no sellerManagementCode the SKU falls back to the channel product number — the only
        // identifier the channel gave, not a generated one.
        assertThat(row.sku()).isEqualTo(row.externalProductId());
        // And what it DOES send is carried through, including the channel's own last-changed time.
        assertThat(row.name()).isEqualTo("상품 0");
        assertThat(row.price()).isEqualByComparingTo(new BigDecimal("12900"));
        assertThat(row.currency()).isEqualTo("KRW");
        assertThat(row.rawSellingStatus()).isEqualTo("SALE");
        assertThat(row.category()).isEqualTo("생활/건강");
        assertThat(row.observedAt()).isEqualTo(NOW);
        assertThat(row.sourceUpdatedAt()).isNotNull().isNotEqualTo(NOW);
    }

    /** Every row of this lane carries the one provenance stamp; a re-read must not restamp anything. */
    @Test
    void everyRowCarriesTheProductApiProvenance() {
        http.enqueue(FakeNaverHttpClient.ok(searchBody(3)));

        FetchPage page = client.fetchProductPage(TOKEN, null);

        assertThat(page.dataType()).isEqualTo(DataType.PRODUCT);
        assertThat(page.records().stream().map(CanonicalProduct.class::cast)
                .map(CanonicalProduct::sourceKind).collect(Collectors.toSet()))
                .containsExactly(NaverProductsClient.SOURCE);
    }

    /** A listing with no channel product number has no identity, so it is skipped — never synthesized. */
    @Test
    void aListingWithoutAChannelProductNumberIsSkippedNotInvented() {
        http.enqueue(FakeNaverHttpClient.ok(
                "{\"contents\":[{\"originProductNo\":1,\"channelProducts\":["
                        + "{\"name\":\"번호 없는 상품\",\"salePrice\":1000}]}]}"));

        FetchPage page = client.fetchProductPage(TOKEN, null);

        assertThat(page.records()).isEmpty();
        assertThat(page.nextCursorValue()).isEqualTo(NaverProductsClient.FIRST_PAGE);
    }

    /** Missing product-group permission is its own instruction, not "the credential is wrong". */
    @Test
    void missingProductPermissionIsReportedAsAPermissionProblem() {
        http.enqueue(new NaverHttpClient.Response(403, "{\"code\":\"GW.AUTHORIZATION\"}", java.util.Map.of()));

        assertThatThrownBy(() -> client.fetchProductPage(TOKEN, null))
                .isInstanceOf(NaverProductPermissionException.class)
                .hasMessageContaining("상품 API 권한");
    }
}
