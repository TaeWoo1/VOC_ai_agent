package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
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
 * one field Coupang uniquely provides unusable.
 *
 * <p><b>The catalogue walk is bounded by requests, not by page size.</b> One detail call per product
 * means a crawl costs {@code N + ceil(N/pageSize)} requests, and a page size chosen small to keep that
 * number down only spreads the same fan-out over more pages — it never bounds it. So the page size is
 * now the official maximum ({@link #MAX_PER_PAGE}) and the actual bound is
 * {@link #DEFAULT_REQUEST_BUDGET}: a walk that would exceed it stops with
 * {@link CoupangProductBudgetExhaustedException} rather than continuing, and the spend rides in
 * {@link CoupangProductCursor} so the ceiling covers the whole walk instead of one page of it.
 *
 * <p><b>Auth and the live guard.</b> Every request is HMAC-signed per call ({@link CoupangSigner}) and
 * passes {@link CoupangLiveCallGuard} — the same choke point every other Coupang read passes, so a real
 * gateway host without an armed approval fails closed here before any socket.
 *
 * <p><b>Wire shape.</b> Field names follow Coupang's published seller-product resource. Every field is
 * nullable; an absent one produces no fact and therefore {@code UNAVAILABLE} coverage, never a
 * fabricated value. What the mapper does NOT read it also cannot report, which is why
 * {@link CoupangWireShapeObserver} exists — off by default, and recording key names and counts only.
 * No buyer field exists on these resources and none is projected.
 */
public class CoupangSellerProductsClient {

    private static final Logger log = LoggerFactory.getLogger(CoupangSellerProductsClient.class);

    static final String LIST_PATH = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
    static final String MARKET = "KR";

    /** The provenance stamp every row this client produces carries. */
    public static final String SOURCE = "COUPANG:SELLER_PRODUCTS:v1";

    /** Coupang's documented maximum for this endpoint. */
    public static final int MAX_PER_PAGE = 100;

    /**
     * Marketplace requests one catalogue walk may spend, list and detail calls alike.
     *
     * <p>Not a general collection budget and deliberately not built as one: it is a number this one
     * read obeys, because this one read is the only path in the product whose cost scales with the
     * size of a seller's catalogue and has no other bound.
     */
    public static final int DEFAULT_REQUEST_BUDGET = 250;

    private final CoupangHttpClient http;
    private final CoupangSigner signer;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Clock clock;
    private final String baseUrl;
    private final String liveApprovalId;
    private final String standingReadGrantId;
    private final int requestBudget;
    private final boolean observeWireShape;

    public CoupangSellerProductsClient(CoupangHttpClient http, CoupangSigner signer, Clock clock,
                                       String baseUrl, String liveApprovalId, String standingReadGrantId) {
        this(http, signer, clock, baseUrl, liveApprovalId, standingReadGrantId,
                DEFAULT_REQUEST_BUDGET, false);
    }

    public CoupangSellerProductsClient(CoupangHttpClient http, CoupangSigner signer, Clock clock,
                                       String baseUrl, String liveApprovalId, String standingReadGrantId,
                                       int requestBudget, boolean observeWireShape) {
        this.http = http;
        this.signer = signer;
        this.clock = clock;
        this.baseUrl = baseUrl;
        this.liveApprovalId = liveApprovalId;
        this.standingReadGrantId = standingReadGrantId;
        this.requestBudget = requestBudget;
        this.observeWireShape = observeWireShape;
    }

    /**
     * One page of the vendor's catalogue, with each product's options resolved.
     *
     * <p>A detail call that fails does NOT fail the page: the product is still emitted with the identity
     * and status the list stated, and its option facet simply stays unavailable. Losing a whole page
     * because one product's detail 500'd would be a worse answer than a partial one that says so.
     *
     * <p>The budget is checked <b>before</b> the page, against its worst case (one list call plus one
     * detail per listed product). A page is therefore never half-read: either the walk can afford the
     * whole page or it stops and says so.
     */
    public FetchPage fetchProductPage(String accessKey, String secretKey, String vendorId,
                                      String cursorValue) {
        CoupangProductCursor cursor = CoupangProductCursor.parse(cursorValue);
        int spent = cursor.spent();
        if (spent > requestBudget - (1 + MAX_PER_PAGE)) {
            throw new CoupangProductBudgetExhaustedException(spent, requestBudget);
        }

        CoupangWireShapeObserver observer = observeWireShape ? new CoupangWireShapeObserver() : null;
        String nextToken = cursor.nextToken();
        ListEnvelope envelope = list(accessKey, secretKey, vendorId, nextToken, observer);
        spent++;

        List<CanonicalProduct> records = new ArrayList<>();
        int sourceRow = 1;
        Instant now = clock.instant();
        for (ListRow row : envelope.rows()) {
            if (row.sellerProductId() == null) {
                continue; // No identity ⇒ not storable. Skipped, never synthesized.
            }
            ProductDetail detail = null;
            try {
                detail = detail(accessKey, secretKey, vendorId, row.sellerProductId(), observer);
            } catch (CoupangRateLimitedException throttled) {
                throw throttled; // The page is retried whole; a partial page would look complete.
            } catch (RuntimeException e) {
                log.warn("Coupang seller-product detail unavailable: cause={}", e.getClass().getSimpleName());
            } finally {
                // Charged whether or not it answered: the request left this machine either way, and a
                // budget that only counts successes is not a bound on what we did to the marketplace.
                spent++;
            }
            records.add(toCanonical(row, detail, sourceRow++, now));
        }
        boolean hasMore = envelope.nextToken() != null && !envelope.nextToken().isBlank();
        log.info("쿠팡 상품 수집: listed={} mapped={} hasMore={} requests={} budget={}/{}",
                envelope.rows().size(), records.size(), hasMore, spent - cursor.spent(),
                spent, requestBudget);
        if (observer != null && !observer.isEmpty()) {
            // Aggregated schema only — key names, kinds and counts. Never a value; see the observer.
            for (String line : observer.summaryLines()) {
                log.info("쿠팡 상품 wire-shape {}", line);
            }
        }
        return FetchPage.of(DataType.PRODUCT, records,
                CoupangProductCursor.serialize(envelope.nextToken(), spent), hasMore,
                CoupangApiConnector.KIND);
    }

    private ListEnvelope list(String accessKey, String secretKey, String vendorId, String nextToken,
                              CoupangWireShapeObserver observer) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("vendorId", vendorId);
        params.put("maxPerPage", Integer.toString(MAX_PER_PAGE));
        if (nextToken != null && !nextToken.isBlank()) {
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
            JsonNode root = mapper.readTree(response.body());
            if (observer != null) {
                observer.observe("list", root);
            }
            ListResponse parsed = mapper.treeToValue(root, ListResponse.class);
            return new ListEnvelope(parsed.data() == null ? List.of() : parsed.data(), parsed.nextToken());
        } catch (Exception e) {
            throw new IllegalStateException("쿠팡 상품 목록 응답을 해석할 수 없습니다.");
        }
    }

    private ProductDetail detail(String accessKey, String secretKey, String vendorId, Long sellerProductId,
                                 CoupangWireShapeObserver observer) {
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
            JsonNode root = mapper.readTree(response.body());
            if (observer != null) {
                observer.observe("detail", root);
            }
            return mapper.treeToValue(root, DetailResponse.class).data();
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
