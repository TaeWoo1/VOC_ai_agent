package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Reads one page of a mall's product catalogue
 * ({@code GET https://{mall_id}.cafe24api.com/api/v2/admin/products}) with the Bearer access token.
 *
 * <p>Mirrors {@link Cafe24BoardArticlesClient} exactly: {@link Cafe24HttpClient} is the only network
 * boundary, a 429 becomes {@link Cafe24RateLimitedException} carrying the official resumption hint, one
 * page per call with the caller advancing {@code offset}, and no token or response material reaches a
 * message. Read-only — this class has no POST and there is nothing here that could write a product.
 *
 * <p><b>Scope and consent.</b> The read needs {@code mall.read_product}. Malls connected before
 * Operator Graph v2 granted only {@code mall.read_community,mall.read_order}, so for them this returns
 * {@code insufficient_scope} until the seller re-consents. That is a seller decision and this code
 * never attempts to work around it — the capability surface reports the re-consent requirement and the
 * PRODUCT facets stay {@code UNAVAILABLE} in the meantime.
 */
public class Cafe24ProductsClient {

    static final String PRODUCTS_PATH = "/api/v2/admin/products";

    /** Cafe24 Admin list endpoints cap {@code limit} at 100; a full page means "there may be more". */
    public static final int PAGE_LIMIT = 100;

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24ProductsClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * One page of the catalogue.
     *
     * @throws Cafe24RateLimitedException on HTTP 429
     * @throws Cafe24OAuthException classified as {@code INSUFFICIENT_SCOPE} on 403, so a caller can tell
     *     "this mall has not granted product access" from "this token is dead"
     */
    public List<Cafe24ProductRow> fetchPage(String accessToken, String mallId, int limit, int offset) {
        URI uri = productsUri(mallId, limit, offset);
        Cafe24HttpClient.Response response =
                http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() == 403 || response.statusCode() == 401) {
            // A missing grant and a dead token are different operator instructions ("판매자가 다시
            // 동의해야 합니다" vs "다시 연결해야 합니다"), and collapsing them mis-guides the seller.
            throw Cafe24OAuthException.resourceScope(response.statusCode(),
                    "카페24 상품 조회 권한(mall.read_product)이 없습니다. 판매자의 재동의가 필요합니다.");
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "카페24 상품 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parse(response.body());
    }

    static URI productsUri(String mallId, int limit, int offset) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        Map<String, String> params = new LinkedHashMap<>();
        params.put("limit", Integer.toString(Math.min(Math.max(limit, 1), PAGE_LIMIT)));
        params.put("offset", Integer.toString(Math.max(offset, 0)));
        String query = params.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                        + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        return URI.create("https://" + mallId + ".cafe24api.com" + PRODUCTS_PATH + "?" + query);
    }

    private List<Cafe24ProductRow> parse(String body) {
        try {
            ProductsResponse parsed = mapper.readValue(body, ProductsResponse.class);
            return parsed.products() != null ? parsed.products() : List.of();
        } catch (Exception e) {
            // The body stays out of the message — a catalogue dump in a log is still a data dump.
            throw new IllegalStateException("카페24 상품 응답을 해석할 수 없습니다.");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ProductsResponse(@JsonProperty("products") List<Cafe24ProductRow> products) {
    }
}
