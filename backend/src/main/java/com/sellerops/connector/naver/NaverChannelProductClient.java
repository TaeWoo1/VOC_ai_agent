package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

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
 * <p><b>READ only.</b> The same path accepts {@code PUT} for a full-body product update and the
 * neighbouring path accepts {@code DELETE}; neither verb is spelled in this file and a structural
 * test asserts their absence. No buyer field exists on this resource and none is projected.
 */
public class NaverChannelProductClient {

    static final String PATH_PREFIX = "/external/v2/products/channel-products/";

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
            Envelope envelope = mapper.readValue(body, Envelope.class);
            OriginProduct origin = envelope.originProduct();
            if (origin == null) {
                return null;
            }
            List<NaverProductDetail.Option> options = new ArrayList<>();
            List<String> optionNames = new ArrayList<>();
            List<String> imageUrls = new ArrayList<>();
            DetailAttribute attribute = origin.detailAttribute();
            if (attribute != null && attribute.optionInfo() != null
                    && attribute.optionInfo().optionCombinations() != null) {
                for (OptionCombination option : attribute.optionInfo().optionCombinations()) {
                    String name = joinOptionAxes(option);
                    if (name != null) {
                        // The identity is carried alongside the label because a variant with no id
                        // cannot be upserted — ProductKnowledgeWriter skips it rather than minting a
                        // duplicate on the next read. The reference elides this sub-structure
                        // ("하위 구조 생략"), so `id` is doc-inferred from the v1 option shape and is
                        // confirmed or refuted by the first live read, not assumed present.
                        options.add(new NaverProductDetail.Option(
                                option.id() == null ? null : Long.toString(option.id()), name));
                        optionNames.add(name);
                    }
                }
            }
            Images images = origin.images();
            if (images != null) {
                if (images.representativeImage() != null
                        && images.representativeImage().url() != null) {
                    imageUrls.add(images.representativeImage().url());
                }
                if (images.optionalImages() != null) {
                    for (Image image : images.optionalImages()) {
                        if (image != null && image.url() != null) {
                            imageUrls.add(image.url());
                        }
                    }
                }
            }
            return new NaverProductDetail(origin.name(), origin.detailContent(),
                    List.copyOf(options), List.copyOf(imageUrls));
        } catch (Exception e) {
            // The body carries the seller's whole listing — it never reaches a message.
            throw new IllegalStateException("네이버 상품 상세 응답을 해석할 수 없습니다.");
        }
    }

    /** "색상:검정 / 길이:2m" — the option's own axis labels, joined. Never invented when absent. */
    private static String joinOptionAxes(OptionCombination option) {
        List<String> parts = new ArrayList<>();
        for (String value : List.of(nullToEmpty(option.optionName1()), nullToEmpty(option.optionName2()),
                nullToEmpty(option.optionName3()))) {
            if (!value.isBlank()) {
                parts.add(value.strip());
            }
        }
        return parts.isEmpty() ? null : String.join(" / ", parts);
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    // ------------------------------------------------------------------ wire records (private)

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Envelope(@JsonProperty("originProduct") OriginProduct originProduct) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record OriginProduct(@JsonProperty("name") String name,
                                 @JsonProperty("detailContent") String detailContent,
                                 @JsonProperty("images") Images images,
                                 @JsonProperty("detailAttribute") DetailAttribute detailAttribute) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Images(@JsonProperty("representativeImage") Image representativeImage,
                          @JsonProperty("optionalImages") List<Image> optionalImages) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Image(@JsonProperty("url") String url) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record DetailAttribute(@JsonProperty("optionInfo") OptionInfo optionInfo) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record OptionInfo(
            @JsonProperty("optionCombinations") List<OptionCombination> optionCombinations) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record OptionCombination(@JsonProperty("id") Long id,
                                     @JsonProperty("optionName1") String optionName1,
                                     @JsonProperty("optionName2") String optionName2,
                                     @JsonProperty("optionName3") String optionName3) {
    }
}
