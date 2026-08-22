package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Coupang WING Open API seller-product collection — the vendor's own catalogue, read-only.
 *
 * <pre>GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products
 *     ?vendorId={vendorId}&amp;nextToken={token}&amp;maxPerPage={n}
 * GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}</pre>
 *
 * <p><b>Two calls per page, on purpose.</b> The list endpoint answers identity and status; the option
 * axis — {@code vendorItemId}, option name, per-option price and the vendor's own SKU — lives only on
 * the detail resource. That option axis is precisely what {@code reviews.source_option_id} (V37) has
 * been storing since 2026-08 with nothing to resolve it against, so a list-only read would leave the
 * one field Coupang uniquely provides unusable. The page is small ({@link #MAX_PER_PAGE}) so the detail
 * fan-out stays bounded and a rate-limit surfaces as a page-level retry rather than a half-written page.
 *
 * <p><b>Auth and the live guard.</b> Every request is HMAC-signed per call ({@link CoupangSigner}) and
 * passes {@link CoupangLiveCallGuard} — the same choke point every other Coupang read passes, so a real
 * gateway host without an armed approval fails closed here before any socket.
 *
 * <p><b>Wire shape is {@code NEEDS_VERIFICATION}.</b> Field names follow Coupang's published
 * seller-product resource and have not been observed live from this repository. Every field is nullable;
 * an absent one produces no fact and therefore {@code UNAVAILABLE} coverage, never a fabricated value.
 * No buyer field exists on these resources and none is projected.
 */
public class CoupangSellerProductsClient {

    private static final Logger log = LoggerFactory.getLogger(CoupangSellerProductsClient.class);

    static final String LIST_PATH = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
    static final String MARKET = "KR";

    /** The provenance stamp every row this client produces carries. */
    public static final String SOURCE = "COUPANG:SELLER_PRODUCTS:v1";

    /**
     * Small deliberately. Each listed product costs one detail call, so the page size IS the fan-out;
     * a large page would turn one throttle into a lost page of work.
     */
    public static final int MAX_PER_PAGE = 10;

    private final CoupangHttpClient http;
    private final CoupangSigner signer;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Clock clock;
    private final String baseUrl;
    private final String liveApprovalId;
    private final String standingReadGrantId;

    public CoupangSellerProductsClient(CoupangHttpClient http, CoupangSigner signer, Clock clock,
                                       String baseUrl, String liveApprovalId, String standingReadGrantId) {
        this.http = http;
        this.signer = signer;
        this.clock = clock;
        this.baseUrl = baseUrl;
        this.liveApprovalId = liveApprovalId;
        this.standingReadGrantId = standingReadGrantId;
    }

    /**
     * One page of the vendor's catalogue, with each product's options resolved.
     *
     * <p>A detail call that fails does NOT fail the page: the product is still emitted with the identity
     * and status the list stated, and its option facet simply stays unavailable. Losing a whole page
     * because one product's detail 500'd would be a worse answer than a partial one that says so.
     */
    public FetchPage fetchProductPage(String accessKey, String secretKey, String vendorId,
                                      String cursorValue) {
        String nextToken = cursorValue == null || cursorValue.isBlank() ? null : cursorValue.strip();
        ListEnvelope envelope = list(accessKey, secretKey, vendorId, nextToken);

        List<CanonicalProduct> records = new ArrayList<>();
        int sourceRow = 1;
        Instant now = clock.instant();
        for (ListRow row : envelope.rows()) {
            if (row.sellerProductId() == null) {
                continue; // No identity ⇒ not storable. Skipped, never synthesized.
            }
            ProductDetail detail = null;
            try {
                detail = detail(accessKey, secretKey, vendorId, row.sellerProductId());
            } catch (CoupangRateLimitedException throttled) {
                throw throttled; // The page is retried whole; a partial page would look complete.
            } catch (RuntimeException e) {
                log.warn("Coupang seller-product detail unavailable: cause={}", e.getClass().getSimpleName());
            }
            records.add(toCanonical(row, detail, sourceRow++, now));
        }
        boolean hasMore = envelope.nextToken() != null && !envelope.nextToken().isBlank();
        log.info("쿠팡 상품 수집: listed={} mapped={} hasMore={}", envelope.rows().size(), records.size(), hasMore);
        return FetchPage.of(DataType.PRODUCT, records, envelope.nextToken(), hasMore,
                CoupangApiConnector.KIND);
    }

    private ListEnvelope list(String accessKey, String secretKey, String vendorId, String nextToken) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("vendorId", vendorId);
        params.put("maxPerPage", Integer.toString(MAX_PER_PAGE));
        if (nextToken != null) {
            params.put("nextToken", nextToken);
        }
        String query = encode(params);
        CoupangHttpClient.Response response = signedGet(LIST_PATH, query, accessKey, secretKey, vendorId);
        if (response.statusCode() == 429) {
            throw CoupangRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "쿠팡 상품 목록 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        try {
            ListResponse parsed = mapper.readValue(response.body(), ListResponse.class);
            return new ListEnvelope(parsed.data() == null ? List.of() : parsed.data(), parsed.nextToken());
        } catch (Exception e) {
            throw new IllegalStateException("쿠팡 상품 목록 응답을 해석할 수 없습니다.");
        }
    }

    private ProductDetail detail(String accessKey, String secretKey, String vendorId, Long sellerProductId) {
        String path = LIST_PATH + "/" + sellerProductId;
        CoupangHttpClient.Response response = signedGet(path, "", accessKey, secretKey, vendorId);
        if (response.statusCode() == 429) {
            throw CoupangRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "쿠팡 상품 상세 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        try {
            return mapper.readValue(response.body(), DetailResponse.class).data();
        } catch (Exception e) {
            throw new IllegalStateException("쿠팡 상품 상세 응답을 해석할 수 없습니다.");
        }
    }

    /**
     * List row + optional detail → one canonical product.
     *
     * <p>The detail's item list becomes the variant axis. An item's {@code externalVendorSku} is the
     * seller's own code and is preferred as the product SKU when the list row carries none — the same
     * "the seller's own identifier wins" rule {@code ProductService} follows.
     */
    static CanonicalProduct toCanonical(ListRow row, ProductDetail detail, int sourceRow, Instant now) {
        List<CanonicalProductVariant> variants = new ArrayList<>();
        Map<String, String> attributes = new LinkedHashMap<>();
        String sku = null;
        BigDecimal price = null;

        if (detail != null && detail.items() != null) {
            for (DetailItem item : detail.items()) {
                if (item.vendorItemId() == null) {
                    continue;
                }
                variants.add(new CanonicalProductVariant(
                        Long.toString(item.vendorItemId()),
                        blankToNull(item.itemName()),
                        blankToNull(item.externalVendorSku()),
                        item.salePrice(),
                        null));
                if (sku == null) {
                    sku = blankToNull(item.externalVendorSku());
                }
                if (price == null) {
                    price = item.salePrice();
                }
                if (item.attributes() != null) {
                    for (DetailAttribute attribute : item.attributes()) {
                        String name = blankToNull(attribute.attributeTypeName());
                        String value = blankToNull(attribute.attributeValueName());
                        if (name != null && value != null) {
                            attributes.putIfAbsent(name, value);
                        }
                    }
                }
            }
        }

        String externalId = Long.toString(row.sellerProductId());
        return new CanonicalProduct(
                externalId,
                blankToNull(row.sellerProductName()),
                sku != null ? sku : externalId,
                null, // The seller API states no storefront URL — UNAVAILABLE, not guessed from an id.
                price,
                price == null ? null : "KRW",
                blankToNull(row.statusName()),
                blankToNull(row.brand()),
                null, // manufacturer is not on this resource
                row.displayCategoryCode() == null ? null : Long.toString(row.displayCategoryCode()),
                null, // description lives in a separate contents resource; not read, so not claimed
                attributes,
                variants,
                now,
                // The seller-products resource states no last-modified time. Null, not the read
                // instant — "we do not know when it changed" is not "it changed just now".
                null,
                SOURCE,
                sourceRow);
    }

    private CoupangHttpClient.Response signedGet(String path, String query, String accessKey,
                                                 String secretKey, String vendorId) {
        // The same choke point every Coupang read passes. A real gateway host with no armed approval
        // fails closed here, before signing and before any socket.
        CoupangLiveCallGuard.ensureLiveReadAllowed(baseUrl, liveApprovalId, standingReadGrantId);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", signer.authorization(accessKey, secretKey, "GET", path, query));
        headers.put("X-Requested-By", vendorId);
        headers.put("X-MARKET", MARKET);
        URI uri = URI.create(baseUrl + path + (query.isEmpty() ? "" : "?" + query));
        return http.get(uri, headers);
    }

    /** The one query string used for BOTH the signature and the URI, so they cannot diverge. */
    private static String encode(Map<String, String> params) {
        StringBuilder out = new StringBuilder();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (out.length() > 0) {
                out.append('&');
            }
            out.append(entry.getKey()).append('=')
               .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
        }
        return out.toString();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private record ListEnvelope(List<ListRow> rows, String nextToken) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ListResponse(@JsonProperty("data") List<ListRow> data,
                        @JsonProperty("nextToken") String nextToken) {
    }

    /** One catalogue row. Every field nullable — an absent one becomes UNAVAILABLE, never a default. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ListRow(@JsonProperty("sellerProductId") Long sellerProductId,
                   @JsonProperty("sellerProductName") String sellerProductName,
                   @JsonProperty("statusName") String statusName,
                   @JsonProperty("brand") String brand,
                   @JsonProperty("displayCategoryCode") Long displayCategoryCode) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DetailResponse(@JsonProperty("data") ProductDetail data) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProductDetail(@JsonProperty("sellerProductName") String sellerProductName,
                         @JsonProperty("brand") String brand,
                         @JsonProperty("items") List<DetailItem> items) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DetailItem(@JsonProperty("vendorItemId") Long vendorItemId,
                      @JsonProperty("itemName") String itemName,
                      @JsonProperty("externalVendorSku") String externalVendorSku,
                      @JsonProperty("salePrice") BigDecimal salePrice,
                      @JsonProperty("attributes") List<DetailAttribute> attributes) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DetailAttribute(@JsonProperty("attributeTypeName") String attributeTypeName,
                           @JsonProperty("attributeValueName") String attributeValueName) {
    }
}
