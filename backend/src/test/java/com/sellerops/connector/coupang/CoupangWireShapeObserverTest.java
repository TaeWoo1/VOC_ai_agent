package com.sellerops.connector.coupang;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The observer's whole licence is that its output contains no data — so that is what this file spends
 * most of its assertions on.
 *
 * <p>The fixture deliberately carries the kinds of value that must never escape: a product title, a
 * price, a seller SKU, a description, an identifier. If any of them can be found in the summary, the
 * observer is not safe to run against a real catalogue and not safe to quote in an evidence document.
 */
class CoupangWireShapeObserverTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String BODY = """
            {"code":200,"nextToken":"TOKEN-77","data":[
              {"sellerProductId":13571113,"sellerProductName":"전선몰딩 1호 3m",
               "statusName":"승인완료","brand":"몰딩공방","displayCategoryCode":63915,
               "items":[
                 {"vendorItemId":88991122,"itemName":"화이트 3m","externalVendorSku":"MLD-777",
                  "salePrice":12900,"attributes":[{"attributeTypeName":"길이","attributeValueName":"3m"}]},
                 {"vendorItemId":88991133,"itemName":"블랙 3m","externalVendorSku":null,
                  "salePrice":13900,"attributes":[]}],
               "contents":[{"contentDetails":[{"content":"상세페이지 본문입니다"}]}]}]}
            """;

    private CoupangWireShapeObserver observed() throws Exception {
        CoupangWireShapeObserver observer = new CoupangWireShapeObserver();
        observer.observe("list", MAPPER.readTree(BODY));
        return observer;
    }

    @Test
    void noValueFromTheBodyAppearsAnywhereInTheSummary() throws Exception {
        String summary = String.join("\n", observed().summaryLines());

        assertThat(summary)
                .doesNotContain("전선몰딩")          // a product title
                .doesNotContain("몰딩공방")          // a brand value
                .doesNotContain("화이트")            // an option name
                .doesNotContain("MLD-777")           // the seller's own SKU
                .doesNotContain("12900")             // a price
                .doesNotContain("13571113")          // a product identifier
                .doesNotContain("88991122")          // an option identifier
                .doesNotContain("상세페이지 본문")    // description content
                .doesNotContain("TOKEN-77")          // even the paging token
                .doesNotContain("승인완료")          // a status value
                .doesNotContain("3m");               // an attribute value
    }

    @Test
    void keyNamesAndTheirFillCountsAreRecorded() throws Exception {
        List<String> lines = observed().summaryLines();

        assertThat(lines).anySatisfy(line ->
                assertThat(line).contains("$.data[].sellerProductId").contains("present=1/1").contains("nonNull=1"));
        // Two items, one with a vendor SKU and one with an explicit null — present twice, filled once.
        assertThat(lines).anySatisfy(line ->
                assertThat(line).contains("$.data[].items[].externalVendorSku")
                        .contains("present=2/2").contains("nonNull=1"));
    }

    @Test
    void arrayCardinalityIsCountedNotSampled() throws Exception {
        assertThat(observed().summaryLines()).anySatisfy(line ->
                assertThat(line).contains("array $.data[].items")
                        .contains("occurrences=1").contains("elements=2"));
    }

    @Test
    void aKeyThatNeverAppearsIsReportedAsAbsentRatherThanOmitted() throws Exception {
        List<String> watched = observed().watchedKeyLines();

        // The four negative claims the mapper makes, and the identifiers the proof set out to settle.
        assertThat(watched).contains("watched manufacture = ABSENT");
        assertThat(watched).contains("watched images = ABSENT");
        assertThat(watched).contains("watched notices = ABSENT");
        assertThat(watched).contains("watched productId = ABSENT");
        assertThat(watched).anySatisfy(line -> assertThat(line).startsWith("watched contents = list "));
        assertThat(watched).anySatisfy(line -> assertThat(line).startsWith("watched vendorItemId = list "));
    }

    @Test
    void everyWatchedKeyGetsALineWhetherOrNotItWasSeen() throws Exception {
        assertThat(observed().watchedKeyLines()).hasSize(CoupangWireShapeObserver.WATCHED_KEYS.size());
    }

    @Test
    void anEmptyObserverSaysSoRatherThanReportingAnEmptySchema() {
        assertThat(new CoupangWireShapeObserver().isEmpty()).isTrue();
    }
}
