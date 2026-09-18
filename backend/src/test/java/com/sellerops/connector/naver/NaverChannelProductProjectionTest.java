package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What one channel-product read states, projected from a body shaped exactly as the published schema
 * ({@code docs/vendor/naver-commerce-api/get-v2-products-channel-products-channelProductNo.detailAttribute.md}).
 * The values are synthetic; the paths are the contract's.
 */
class NaverChannelProductProjectionTest {

    private static final String BODY = """
            {"originProduct":{
               "statusType":"SALE","leafCategoryId":"50003307","name":"하향식 컵 디스펜서",
               "detailContent":"<p>종이컵을 한 장씩</p>",
               "images":{"representativeImage":{"url":"https://shop-phinf.pstatic.net/a.jpg"}},
               "detailAttribute":{
                 "naverShoppingSearchInfo":{"modelName":"CD-9","brandName":"브랜드"},
                 "seoInfo":{"sellerTags":[{"text":"컵디스펜서"},{"code":1,"text":"종이컵"}]},
                 "optionInfo":{
                   "useStockManagement":true,
                   "optionCombinationGroupNames":{"optionGroupName1":"용량","optionGroupName2":"색상"},
                   "optionCombinations":[
                     {"id":101,"optionName1":"9oz","optionName2":"블랙","stockQuantity":12,"price":0,"usable":true},
                     {"id":102,"optionName1":"13oz","optionName2":"블랙","stockQuantity":0,"price":1000,"usable":true},
                     {"id":103,"optionName1":"6.5oz","optionName2":"화이트","stockQuantity":5,"usable":false}
                   ]},
                 "supplementProductInfo":{"supplementProducts":[
                     {"id":7,"groupName":"뚜껑","name":"9oz 컵 뚜껑","price":2000,"usable":true},
                     {"id":8,"groupName":"홀더","name":"벽걸이 홀더","usable":false}
                   ]},
                 "productAttributes":[{"attributeSeq":10,"attributeValueSeq":2001},
                                      {"attributeSeq":11,"attributeValueSeq":0,"attributeRealValue":"266","attributeRealValueUnitCode":"U1"}],
                 "productInfoProvidedNotice":{"productInfoProvidedNoticeType":"KITCHEN_UTENSILS",
                   "kitchenUtensils":{"itemName":"컵 디스펜서","material":"ABS","size":"9oz 종이컵 전용 (지름 75mm)",
                     "returnCostReason":"0","noRefundReason":"1","afterServiceDirector":"010-0000-0000",
                     "customerServicePhoneNumber":"02-000-0000","manufacturer":"상세페이지 참조"}}
               }},
             "smartstoreChannelProduct":{"channelProductDisplayStatusType":"ON"}}
            """;

    @Test
    @DisplayName("options carry their axis label, the channel's usable flag and stock; 추가상품, 고시, model and tags are stated")
    void projectsTheStructuredListing() throws Exception {
        NaverProductDetail d = NaverChannelProductClient.project(new ObjectMapper().readTree(BODY));

        assertThat(d.options()).extracting(NaverProductDetail.Option::optionName)
                .containsExactly("용량: 9oz / 색상: 블랙", "용량: 13oz / 색상: 블랙", "용량: 6.5oz / 색상: 화이트");
        assertThat(d.stockManaged()).isTrue();
        assertThat(d.options().get(0).purchasable(true)).isTrue();
        assertThat(d.options().get(1).purchasable(true)).as("managed stock of zero").isFalse();
        assertThat(d.options().get(2).purchasable(true)).as("usable=false").isFalse();

        assertThat(d.supplements()).extracting(NaverProductDetail.Supplement::label)
                .containsExactly("뚜껑: 9oz 컵 뚜껑", "홀더: 벽걸이 홀더");
        assertThat(d.supplements().get(1).offered()).isFalse();

        assertThat(d.facts()).containsEntry("품명", "컵 디스펜서").containsEntry("재질", "ABS")
                .containsEntry("크기", "9oz 종이컵 전용 (지름 75mm)").containsEntry("모델명", "CD-9")
                .containsEntry("판매자 태그", "컵디스펜서, 종이컵");
        assertThat(d.facts().values()).as("legal clauses, codes and phone numbers are not product statements")
                .noneMatch(v -> v.equals("0") || v.equals("1") || v.contains("010-") || v.contains("02-"));
        assertThat(d.attributes()).hasSize(2);
        assertThat(d.effectiveStatus()).isEqualTo("SALE");
        assertThat(d.leafCategoryId()).isEqualTo("50003307");
    }

    @Test
    @DisplayName("a SmartStore listing whose display is suspended cannot be bought, whatever the origin status says")
    void suspendedDisplayIsNotOnSale() throws Exception {
        NaverProductDetail d = NaverChannelProductClient.project(new ObjectMapper().readTree(
                BODY.replace("\"channelProductDisplayStatusType\":\"ON\"",
                        "\"channelProductDisplayStatusType\":\"SUSPENSION\"")));
        assertThat(d.effectiveStatus()).isEqualTo("SUSPENSION");
    }

    @Test
    @DisplayName("attribute ids are named from the category catalogue — once per category, never guessed")
    void attributesAreNamedFromTheCatalogue() throws Exception {
        List<String> calls = new ArrayList<>();
        NaverHttpClient http = new NaverHttpClient() {
            @Override
            public Response postForm(java.net.URI uri, Map<String, String> form) {
                throw new AssertionError();
            }

            @Override
            public Response get(java.net.URI uri, String token) {
                calls.add(uri.getPath());
                String body = switch (uri.getPath()) {
                    case NaverProductAttributeClient.ATTRIBUTES_PATH ->
                            "[{\"attributeSeq\":10,\"attributeName\":\"용량\"},{\"attributeSeq\":11,\"attributeName\":\"높이\"}]";
                    case NaverProductAttributeClient.VALUES_PATH ->
                            "[{\"attributeSeq\":10,\"attributeValueSeq\":2001,\"minAttributeValue\":\"9\",\"minAttributeValueUnitCode\":\"U2\"}]";
                    case NaverProductAttributeClient.UNITS_PATH ->
                            "[{\"id\":\"U1\",\"unitCodeName\":\"mm\"},{\"id\":\"U2\",\"unitCodeName\":\"oz\"}]";
                    default -> throw new AssertionError(uri.getPath());
                };
                return new Response(200, body, Map.of());
            }

            @Override
            public Response postJson(java.net.URI uri, String token, String json) {
                throw new AssertionError();
            }
        };
        NaverProductAttributeClient client = new NaverProductAttributeClient(http, "https://api.commerce.naver.com",
                Clock.fixed(Instant.parse("2026-09-18T00:00:00Z"), ZoneOffset.UTC));
        NaverProductDetail d = NaverChannelProductClient.project(new ObjectMapper().readTree(BODY));

        Map<String, String> named = client.name("t", d.leafCategoryId(), d.attributes());
        assertThat(named).containsEntry("용량", "9oz").containsEntry("높이", "266mm");

        client.name("t", d.leafCategoryId(), d.attributes());
        assertThat(client.reads()).as("cached per category: three reads, not six").isEqualTo(3);
        assertThat(calls).allMatch(p -> p.startsWith("/external/v1/product-attributes/"));

        List<NaverProductDetail.AttributeRef> unknown = List.of(new NaverProductDetail.AttributeRef(99L, 1L, null, null));
        assertThat(client.name("t", d.leafCategoryId(), unknown)).as("an id the catalogue does not name").isEmpty();
    }
}
