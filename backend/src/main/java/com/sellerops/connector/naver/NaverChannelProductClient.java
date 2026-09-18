package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ONE NAVER listing, read in full —
 * {@code GET /external/v2/products/channel-products/{channelProductNo}}.
 *
 * <p><b>Why a second product client exists.</b> {@link NaverProductsClient} maps
 * {@code detailContent}, {@code optionCombinations} and {@code storeKeepingUrl} and has never
 * received any of them: the LIST resource {@code POST /v1/products/search} does not send those fields
 * (live-observed 2026-08-22 over 69 listings, and confirmed by the data — 0 description facts and 0
 * variants from NAVER, against 12 and 405 from the other two channels). So the catalogue sweep is not
 * under-reading its response; it is calling the resource that does not carry the answer. This one
 * does, and the contract says so: {@code originProduct.detailContent} is marked **필수** in the
 * response schema ({@code docs/vendor/naver-commerce-api/get-v2-products-channel-products-channelProductNo.md}).
 *
 * <p><b>Keyed by the number we already store.</b> {@code channel_products.external_product_id} IS the
 * {@code channelProductNo}, so no new identifier vocabulary and no id-discovery step is needed. The
 * sibling origin-product resource would need an {@code originProductNo} the smart-store centre does
 * not publish, which is exactly the reason this one is the entry point.
 *
 * <p><b>One listing per call, and the caller decides which.</b> There is no sweep here and no paging.
 * Reading a whole catalogue this way is the structure {@link ProductDetailEnrichment} exists to
 * prevent; this class simply cannot express it.
 *
 * <p><b>What it projects</b> (Catalogue Knowledge Bootstrap v1, 2026-09-18): the 상세페이지 text, every option under its
 * axis label with the channel's usable flag and stock, the 추가상품, the 상품정보제공고시 fields under the schema's own
 * Korean titles ({@link NoticeLabels}), the NAVER shopping model name, the seller's tags, the category attribute ids
 * (named by {@link NaverProductAttributeClient}), and the listing's selling and display status. The paths are the
 * published schema, vendored beside the endpoint document; the legal-notice boilerplate and contact fields of the
 * 고시 are not projected — they are about the store's policy, not the product.
 *
 * <p><b>READ only.</b> The same path accepts {@code PUT} for a full-body product update and the
 * neighbouring path accepts {@code DELETE}; neither verb is spelled in this file and a structural
 * test asserts their absence. No buyer field exists on this resource and none is projected.
 */
public class NaverChannelProductClient {

    static final String PATH_PREFIX = "/external/v2/products/channel-products/";

    /**
     * The provenance of what a detail read states — distinct from the catalogue sweep's {@link NaverProductsClient#SOURCE}
     * so that the facts this read owns can be replaced as a set without touching what the sweep wrote.
     */
    public static final String SOURCE = "NAVER:PRODUCT_DETAIL_API:v2";

    private final NaverHttpClient http;
    private final String baseUrl;
    private final ObjectMapper mapper = new ObjectMapper();

    public NaverChannelProductClient(NaverHttpClient http, String baseUrl) {
        this.http = http;
        this.baseUrl = baseUrl;
    }

    /**
     * Read one listing's detail.
     *
     * @return the projection, or {@code null} when the channel does not have this listing (404) —
     *     absence is a result, and it is never turned into a deletion or an exception the caller has
     *     to interpret.
     * @throws NaverRateLimitedException on 429
     * @throws NaverProductPermissionException when the application does not hold the product group
     */
    public NaverProductDetail fetch(String accessToken, long channelProductNo) {
        if (channelProductNo <= 0) {
            throw new IllegalStateException("네이버 channelProductNo 형식이 올바르지 않습니다.");
        }
        URI uri = URI.create(baseUrl + PATH_PREFIX + channelProductNo);
        NaverHttpClient.Response response = http.get(uri, accessToken);
        int status = response.statusCode();
        if (status == 404) {
            return null;
        }
        if (status == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (status == 403) {
            // Same shape the catalogue sweep already reports: a PERMISSION, not an OAuth scope, and
            // therefore a re-consent item rather than something to retry.
            throw new NaverProductPermissionException(
                    "네이버 상품 API 권한이 없어 상품 상세를 조회할 수 없습니다.");
        }
        if (status != 200) {
            throw new IllegalStateException(
                    "네이버 상품 상세 조회에 실패했습니다 (HTTP " + status + ").");
        }
        return parse(response.body());
    }

    private NaverProductDetail parse(String body) {
        try {
            return project(mapper.readTree(body));
        } catch (RuntimeException | java.io.IOException e) {
            // The body carries the seller's whole listing — it never reaches a message.
            throw new IllegalStateException("네이버 상품 상세 응답을 해석할 수 없습니다.");
        }
    }

    /**
     * The projection, from the published schema's paths
     * ({@code docs/vendor/naver-commerce-api/get-v2-products-channel-products-channelProductNo.detailAttribute.md}).
     * Package-private so a test can hand it a body without an HTTP seam.
     */
    static NaverProductDetail project(JsonNode root) {
        JsonNode origin = root.path("originProduct");
        if (!origin.isObject()) {
            return null;
        }
        JsonNode attribute = origin.path("detailAttribute");
        JsonNode optionInfo = attribute.path("optionInfo");
        boolean stockManaged = optionInfo.path("useStockManagement").asBoolean(false);

        List<NaverProductDetail.Option> options = new ArrayList<>();
        JsonNode groups = optionInfo.path("optionCombinationGroupNames");
        for (JsonNode option : optionInfo.path("optionCombinations")) {
            String name = labelledAxes(groups, option);
            if (name != null) {
                // The identity is carried alongside the label because a variant with no id cannot be upserted —
                // ProductKnowledgeWriter skips it rather than minting a duplicate on the next read.
                options.add(new NaverProductDetail.Option(idOf(option), name, intOf(option, "price"),
                        intOf(option, "stockQuantity"), boolOf(option, "usable")));
            }
        }
        for (JsonNode option : optionInfo.path("optionSimple")) {
            String value = text(option, "name");
            if (value != null) {
                String group = text(option, "groupName");
                options.add(new NaverProductDetail.Option(idOf(option),
                        group == null ? value : group + ": " + value, null, null, boolOf(option, "usable")));
            }
        }
        // optionCustom is a free-text box the buyer fills in; it names no value and so states nothing.

        List<NaverProductDetail.Supplement> supplements = new ArrayList<>();
        for (JsonNode s : attribute.path("supplementProductInfo").path("supplementProducts")) {
            String name = text(s, "name");
            if (name != null) {
                supplements.add(new NaverProductDetail.Supplement(idOf(s), text(s, "groupName"), name,
                        intOf(s, "price"), intOf(s, "stockQuantity"), boolOf(s, "usable")));
            }
        }

        Map<String, String> facts = new LinkedHashMap<>();
        NoticeLabels.project(attribute.path("productInfoProvidedNotice"), facts);
        String model = text(attribute.path("naverShoppingSearchInfo"), "modelName");
        if (model != null) {
            facts.putIfAbsent("모델명", model);
        }
        List<String> tags = new ArrayList<>();
        for (JsonNode tag : attribute.path("seoInfo").path("sellerTags")) {
            String t = text(tag, "text");
            if (t != null) {
                tags.add(t);
            }
        }
        if (!tags.isEmpty()) {
            facts.put("판매자 태그", String.join(", ", tags));
        }

        List<NaverProductDetail.AttributeRef> attributes = new ArrayList<>();
        for (JsonNode a : attribute.path("productAttributes")) {
            Long seq = longOf(a, "attributeSeq");
            if (seq != null) {
                attributes.add(new NaverProductDetail.AttributeRef(seq, longOf(a, "attributeValueSeq"),
                        text(a, "attributeRealValue"), text(a, "attributeRealValueUnitCode")));
            }
        }

        List<String> imageUrls = new ArrayList<>();
        JsonNode images = origin.path("images");
        String representative = text(images.path("representativeImage"), "url");
        if (representative != null) {
            imageUrls.add(representative);
        }
        for (JsonNode image : images.path("optionalImages")) {
            String url = text(image, "url");
            if (url != null) {
                imageUrls.add(url);
            }
        }

        return new NaverProductDetail(text(origin, "name"), origin.path("detailContent").isTextual()
                ? origin.path("detailContent").asText() : null, options, imageUrls, text(origin, "statusType"),
                text(root.path("smartstoreChannelProduct"), "channelProductDisplayStatusType"),
                text(origin, "leafCategoryId"), stockManaged, supplements, facts, attributes);
    }

    /** 「용량: 9oz / 색상: 블랙」 — each value under the axis label the seller gave it. Never invented when absent. */
    static String labelledAxes(JsonNode groups, JsonNode option) {
        List<String> parts = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            String value = text(option, "optionName" + i);
            if (value == null) {
                continue;
            }
            String group = text(groups, "optionGroupName" + i);
            parts.add(group == null ? value : group + ": " + value);
        }
        return parts.isEmpty() ? null : String.join(" / ", parts);
    }

    private static String idOf(JsonNode node) {
        Long id = longOf(node, "id");
        return id == null ? null : Long.toString(id);
    }

    static String text(JsonNode node, String field) {
        JsonNode v = node == null ? null : node.get(field);
        if (v == null || v.isNull() || v.isContainerNode()) {
            return null;
        }
        String s = v.asText();
        return s == null || s.isBlank() ? null : s.strip();
    }

    private static Integer intOf(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isNumber() ? v.intValue() : null;
    }

    private static Long longOf(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isNumber() ? v.longValue() : null;
    }

    private static Boolean boolOf(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isBoolean() ? v.booleanValue() : null;
    }

}
