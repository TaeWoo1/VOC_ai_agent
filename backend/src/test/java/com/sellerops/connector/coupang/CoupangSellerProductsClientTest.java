package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalProduct;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Coupang catalogue read — paging, the request ceiling, and what a page is allowed to claim.
 *
 * <p><b>This file did not exist until 2026-08-23.</b> The client had shipped with no test at all, which
 * is how a page size chosen "small so the fan-out stays bounded" survived as if it were a bound: it
 * never was one, and nothing measured it. The pagination and budget contracts are pinned here so the
 * next change to either has to argue with a test rather than with a comment.
 *
 * <p>Every fixture body is fabricated. Coupang key NAMES are platform schema; the values are invented.
 */
class CoupangSellerProductsClientTest {

    private static final String BASE = "https://api-gateway.coupang.test";
    private final FakeCoupangHttpClient http = new FakeCoupangHttpClient();
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-23T00:00:00Z"), ZoneOffset.UTC);

    private CoupangSellerProductsClient client(int budget, boolean observe) {
        return new CoupangSellerProductsClient(http, new CoupangSigner(clock), clock, BASE, "", "",
                budget, observe);
    }

    private static CoupangHttpClient.Response ok(String body) {
        return new CoupangHttpClient.Response(200, body, Map.of());
    }

    private static String listBody(String nextToken, long... ids) {
        StringBuilder rows = new StringBuilder();
        for (long id : ids) {
            if (rows.length() > 0) {
                rows.append(',');
            }
            rows.append("{\"sellerProductId\":").append(id)
                .append(",\"sellerProductName\":\"이름\",\"statusName\":\"승인완료\"")
                .append(",\"brand\":\"브랜드\",\"displayCategoryCode\":63915}");
        }
        String token = nextToken == null ? "null" : "\"" + nextToken + "\"";
        return "{\"code\":200,\"nextToken\":" + token + ",\"data\":[" + rows + "]}";
    }

    /** A detail that also states the 노출상품ID, which the real resource does on every product. */
    private static String detailBodyWithDisplayId(long displayProductId, long vendorItemId) {
        return detailBody(vendorItemId, null)
                .replace("\"data\":{", "\"data\":{\"productId\":" + displayProductId + ",");
    }

    /** A list row that states the 노출상품ID — the fallback stream, used when a detail call failed. */
    private static String listBodyWithDisplayId(long sellerProductId, long displayProductId) {
        return listBody(null, sellerProductId)
                .replace("\"sellerProductId\":" + sellerProductId,
                        "\"sellerProductId\":" + sellerProductId + ",\"productId\":" + displayProductId);
    }

    private static String detailBody(long vendorItemId, String vendorSku) {
        return "{\"code\":200,\"data\":{\"sellerProductName\":\"이름\",\"brand\":\"브랜드\",\"items\":["
                + "{\"vendorItemId\":" + vendorItemId + ",\"itemName\":\"옵션\","
                + "\"externalVendorSku\":" + (vendorSku == null ? "null" : "\"" + vendorSku + "\"")
                + ",\"salePrice\":12900,\"attributes\":[{\"attributeTypeName\":\"길이\","
                + "\"attributeValueName\":\"2m\"}]}]}}";
    }

    // ──────────────────────────────────── the three identifiers stay three

    @Test
    void readsTheDisplayProductIdFromTheDetailWithoutDisturbingTheOtherTwo() {
        http.enqueue(ok(listBody(null, 111L)));
        http.enqueue(ok(detailBodyWithDisplayId(6473457702L, 9001L)));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);
        CanonicalProduct product = (CanonicalProduct) page.records().get(0);

        // 노출상품ID — new, and its own field.
        assertThat(product.externalDisplayProductId()).isEqualTo("6473457702");
        // 등록상품ID — still the listing key and, absent a seller SKU, still the SKU. Unchanged.
        assertThat(product.externalProductId()).isEqualTo("111");
        assertThat(product.sku()).isEqualTo("111");
        // 옵션ID — still the variant axis. Unchanged.
        assertThat(product.variants()).singleElement()
                .satisfies(v -> assertThat(v.externalVariantId()).isEqualTo("9001"));
    }

    @Test
    void theSellersOwnSkuStillWinsOverTheRegistrationIdWhenTheDisplayIdIsPresent() {
        http.enqueue(ok(listBody(null, 111L)));
        http.enqueue(ok(detailBodyWithDisplayId(6473457702L, 9001L)
                .replace("\"externalVendorSku\":null", "\"externalVendorSku\":\"MLD-777\"")));

        CanonicalProduct product = (CanonicalProduct) client(250, false)
                .fetchProductPage("ak", "sk", "V1", null).records().get(0);

        // The rule that decided the 2026-08-23 identity question is untouched by the new field.
        assertThat(product.sku()).isEqualTo("MLD-777");
        assertThat(product.externalDisplayProductId()).isEqualTo("6473457702");
    }

    @Test
    void fallsBackToTheListRowsDisplayIdWhenTheDetailCallFailed() {
        http.enqueue(ok(listBodyWithDisplayId(111L, 6473457702L)));
        http.enqueue(new CoupangHttpClient.Response(500, "{}", Map.of()));

        CanonicalProduct product = (CanonicalProduct) client(250, false)
                .fetchProductPage("ak", "sk", "V1", null).records().get(0);

        assertThat(product.externalDisplayProductId()).isEqualTo("6473457702");
        assertThat(product.variants()).isEmpty();
    }

    @Test
    void aDetailThatStatesNoDisplayIdIsNullAndNeverTheRegistrationId() {
        http.enqueue(ok(listBody(null, 111L)));
        http.enqueue(ok(detailBody(9001L, null)));

        CanonicalProduct product = (CanonicalProduct) client(250, false)
                .fetchProductPage("ak", "sk", "V1", null).records().get(0);

        // Null, not "111". A 등록상품ID standing in for a 노출상품ID would let a review naming one match a
        // listing keyed by the other — silently, on data that looks correct.
        assertThat(product.externalDisplayProductId()).isNull();
    }

    // ─────────────────────────────────────────────── pagination

    @Test
    void theFirstPageAsksForTheOfficialMaximumAndCarriesNoNextToken() {
        http.enqueue(ok(listBody(null, 111L)));
        http.enqueue(ok(detailBody(9001L, "SKU-1")));

        client(250, false).fetchProductPage("ak", "sk", "V1", null);

        URI listUri = http.sent.get(0).uri();
        assertThat(listUri.getQuery()).contains("maxPerPage=100").doesNotContain("nextToken");
        assertThat(CoupangSellerProductsClient.MAX_PER_PAGE).isEqualTo(100);
    }

    @Test
    void aNextTokenIsSentBackVerbatimOnTheFollowingPage() {
        http.enqueue(ok(listBody("TOKEN-2", 222L)));
        http.enqueue(ok(detailBody(9002L, null)));

        FetchPage first = client(250, false).fetchProductPage("ak", "sk", "V1", null);
        assertThat(first.hasMore()).isTrue();

        http.enqueue(ok(listBody(null, 333L)));
        http.enqueue(ok(detailBody(9003L, null)));
        FetchPage second = client(250, false)
                .fetchProductPage("ak", "sk", "V1", first.nextCursorValue());

        assertThat(http.sent.get(2).uri().getQuery()).contains("nextToken=TOKEN-2");
        assertThat(second.hasMore()).isFalse();
    }

    @Test
    void aFinishedWalkClearsTheCursorSoTheNextRunStartsOver() {
        http.enqueue(ok(listBody(null, 444L)));
        http.enqueue(ok(detailBody(9004L, null)));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);

        // Null, not a token with a spent counter still attached — otherwise the following walk would
        // inherit this one's budget and refuse immediately.
        assertThat(page.nextCursorValue()).isNull();
        assertThat(page.hasMore()).isFalse();
    }

    @Test
    void aCursorWrittenBeforeTheBudgetExistedStillResumes() {
        http.enqueue(ok(listBody(null, 555L)));
        http.enqueue(ok(detailBody(9005L, null)));

        client(250, false).fetchProductPage("ak", "sk", "V1", "BARE-TOKEN");

        assertThat(http.sent.get(0).uri().getQuery()).contains("nextToken=BARE-TOKEN");
    }

    // ─────────────────────────────────────────────── the request ceiling

    @Test
    void theSpendIsCarriedForwardInTheCursorRatherThanForgottenPerPage() {
        http.enqueue(ok(listBody("MORE", 1L, 2L, 3L)));
        http.enqueue(ok(detailBody(1L, null)));
        http.enqueue(ok(detailBody(2L, null)));
        http.enqueue(ok(detailBody(3L, null)));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);

        // 1 list + 3 details actually left the machine, and the cursor says so.
        assertThat(http.sent).hasSize(4);
        assertThat(CoupangProductCursor.parse(page.nextCursorValue()).spent()).isEqualTo(4);
    }

    @Test
    void aWalkThatCannotAffordAnotherWholePageStopsWithBudgetExhausted() {
        // A budget of 150 affords one worst-case page (101) and not two.
        String spentCursor = CoupangProductCursor.serialize("MORE", 101);

        assertThatThrownBy(() -> client(150, false).fetchProductPage("ak", "sk", "V1", spentCursor))
                .isInstanceOf(CoupangProductBudgetExhaustedException.class)
                .hasMessageContaining("BUDGET_EXHAUSTED")
                .hasMessageContaining("자동으로 이어서 수집하지 않습니다");

        // And it stopped BEFORE the marketplace, not after.
        assertThat(http.sent).isEmpty();
    }

    @Test
    void theCeilingIsTwoHundredAndFiftyRequestsPerWalk() {
        assertThat(CoupangSellerProductsClient.DEFAULT_REQUEST_BUDGET).isEqualTo(250);
    }

    @Test
    void aDetailThatFailsStillCostsARequestAndStillYieldsTheProduct() {
        http.enqueue(ok(listBody(null, 777L)));
        http.enqueue(new CoupangHttpClient.Response(500, "{}", Map.of()));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);

        assertThat(page.records()).hasSize(1);
        CanonicalProduct product = (CanonicalProduct) page.records().get(0);
        assertThat(product.externalProductId()).isEqualTo("777");
        // No detail ⇒ no option axis. Absent, never synthesized.
        assertThat(product.variants()).isEmpty();
        assertThat(page.dataType()).isEqualTo(DataType.PRODUCT);
    }

    // ─────────────────────────────────────────────── what a row may claim

    @Test
    void theVendorsOwnSkuWinsOverTheProductIdWhenTheDetailStatesOne() {
        http.enqueue(ok(listBody(null, 888L)));
        http.enqueue(ok(detailBody(9008L, "SELLER-SKU-8")));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);
        CanonicalProduct product = (CanonicalProduct) page.records().get(0);

        assertThat(product.sku()).isEqualTo("SELLER-SKU-8");
        assertThat(product.externalProductId()).isEqualTo("888");
        assertThat(product.variants()).singleElement()
                .satisfies(v -> assertThat(v.externalVariantId()).isEqualTo("9008"));
    }

    @Test
    void withNoVendorSkuTheProductIdIsTheSkuWhichIsWhatLetsAnInquiryFindIt() {
        http.enqueue(ok(listBody(null, 999L)));
        http.enqueue(ok(detailBody(9009L, null)));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);

        assertThat(((CanonicalProduct) page.records().get(0)).sku()).isEqualTo("999");
    }

    @Test
    void aRowWithNoIdentityIsSkippedRatherThanGivenOne() {
        http.enqueue(ok("{\"nextToken\":null,\"data\":[{\"sellerProductName\":\"이름\"}]}"));

        FetchPage page = client(250, false).fetchProductPage("ak", "sk", "V1", null);

        assertThat(page.records()).isEmpty();
        assertThat(http.sent).hasSize(1); // no detail call for a product that has no id
    }

    @Test
    void whatTheResourceDoesNotStateIsLeftNullRatherThanFilledIn() {
        http.enqueue(ok(listBody(null, 1010L)));
        http.enqueue(ok(detailBody(9010L, null)));

        CanonicalProduct product =
                (CanonicalProduct) client(250, false)
                        .fetchProductPage("ak", "sk", "V1", null).records().get(0);

        assertThat(product.productUrl()).isNull();
        assertThat(product.manufacturer()).isNull();
        assertThat(product.description()).isNull();
        // "we do not know when it changed" is not "it changed when we looked".
        assertThat(product.sourceUpdatedAt()).isNull();
        assertThat(product.observedAt()).isEqualTo(Instant.parse("2026-08-23T00:00:00Z"));
        assertThat(product.sourceKind()).isEqualTo("COUPANG:SELLER_PRODUCTS:v1");
    }

    @Test
    void aThrottledPageIsRetriedWholeRatherThanLandedHalfWritten() {
        http.enqueue(new CoupangHttpClient.Response(429, "{}", Map.of("Retry-After", "7")));

        assertThatThrownBy(() -> client(250, false).fetchProductPage("ak", "sk", "V1", null))
                .isInstanceOf(CoupangRateLimitedException.class);
    }

    // ─────────────────────────────────────────────── the observer stays off unless asked

    @Test
    void theWireShapeObserverIsOffByDefaultAndChangesNothingWhenOn() {
        http.enqueue(ok(listBody(null, 1111L)));
        http.enqueue(ok(detailBody(9011L, "SKU-11")));
        FetchPage off = client(250, false).fetchProductPage("ak", "sk", "V1", null);

        http.enqueue(ok(listBody(null, 1111L)));
        http.enqueue(ok(detailBody(9011L, "SKU-11")));
        FetchPage on = client(250, true).fetchProductPage("ak", "sk", "V1", null);

        assertThat(on.records()).hasSameSizeAs(off.records());
        assertThat(((CanonicalProduct) on.records().get(0)).sku())
                .isEqualTo(((CanonicalProduct) off.records().get(0)).sku());
        // Observation is not collection: it must not add a request.
        assertThat(http.sent).hasSize(4);
    }
}
