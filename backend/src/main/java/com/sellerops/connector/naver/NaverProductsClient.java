package com.sellerops.connector.naver;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * NAVER Commerce API seller-product collection — the seller's own SmartStore catalogue, read-only.
 *
 * <pre>POST /external/v1/products/search    {"page":n,"size":m}</pre>
 *
 * <p><b>Why this matters more here than on the other two channels.</b> NAVER is where this seller's
 * reviews actually are (3,880 of 3,916 on the demo org), and until now the ONLY product context
 * SellerOps had for them was the {@code 상품명} column of a review export
 * ({@code docs/slices/product-context-diagnosis-groundwork.md} §3). A real catalogue read replaces a
 * spreadsheet column with a listing that has a status, a price, an option table and a channel id.
 *
 * <p><b>Permission, not OAuth scope.</b> NAVER's Commerce API grants permissions per API group to the
 * application, and an application registered for orders only does not hold the product group. That
 * surfaces the way the missing order permission already does — at the resource endpoint, not at the
 * token mint — so the connector reports it as a re-consent item rather than retrying. Nothing here
 * attempts to widen a grant.
 *
 * <p><b>Wire shape is {@code NEEDS_VERIFICATION}.</b> Field names follow NAVER's published
 * channel-product resource and have not been observed live from this repository. Every field is
 * nullable; an absent one becomes {@code UNAVAILABLE} coverage, never a fabricated value. This resource
 * carries no buyer field and none is projected.
 */
public class NaverProductsClient {

    private static final Logger log = LoggerFactory.getLogger(NaverProductsClient.class);

    static final String SEARCH_PATH = "/external/v1/products/search";

    /** The provenance stamp every row this client produces carries. */
    public static final String SOURCE = "NAVER:PRODUCT_API:v1";

    /** One page. NAVER's product search pages by index; the caller advances the page number. */
    public static final int PAGE_SIZE = 50;

    private final NaverHttpClient http;
    private final Clock clock;
    private final String baseUrl;

    public NaverProductsClient(NaverHttpClient http, Clock clock, String baseUrl) {
        this.http = http;
        this.clock = clock;
        this.baseUrl = baseUrl;
    }

    /**
     * One page of the seller's catalogue.
     *
     * <p>The cursor is the next page index — the search resource has no opaque token, and inventing an
     * opaque wrapper around an integer would imply state that does not exist. A page shorter than
     * {@link #PAGE_SIZE} ends the sweep.
     */
    public FetchPage fetchProductPage(String accessToken, String cursorValue) {
        int page = parsePage(cursorValue);
        URI uri = URI.create(baseUrl + SEARCH_PATH);
        String body = "{\"page\":" + page + ",\"size\":" + PAGE_SIZE + "}";

        NaverHttpClient.Response response = http.postJson(uri, accessToken, body);
        if (response.statusCode() == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() == 401 || response.statusCode() == 403) {
            // The application does not hold the product API group. A different instruction from "the
            // credential is wrong", so it must not collapse into the same failure.
            throw new NaverProductPermissionException(
                    "네이버 커머스API 상품 조회 권한이 없습니다. 판매자 애플리케이션에 상품 API 권한이 필요합니다.");
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "네이버 상품 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }

        SearchResponse parsed;
        try {
            parsed = new ObjectMapper().readValue(response.body(), SearchResponse.class);
        } catch (Exception e) {
            // The body stays out of the message — a catalogue dump in a log is still a data dump.
            throw new IllegalStateException("네이버 상품 응답을 해석할 수 없습니다.");
        }

        List<OriginProduct> contents = parsed.contents() == null ? List.of() : parsed.contents();
        List<CanonicalProduct> records = new ArrayList<>();
        Instant now = clock.instant();
        int sourceRow = 1;
        for (OriginProduct origin : contents) {
            for (CanonicalProduct product : toCanonical(origin, sourceRow, now)) {
                records.add(product);
                sourceRow++;
            }
        }
        boolean hasMore = contents.size() >= PAGE_SIZE;
        log.info("네이버 상품 수집: origins={} listings={} page={} hasMore={}",
                contents.size(), records.size(), page, hasMore);
        return FetchPage.of(DataType.PRODUCT, records, Integer.toString(page + 1), hasMore,
                NaverApiConnector.KIND);
    }

    /**
     * One origin product becomes one canonical product PER CHANNEL LISTING.
     *
     * <p>NAVER's model is an origin product with channel products under it, and the channel product
     * number is what a review row, an order row and a storefront URL all carry. Collapsing the listings
     * into the origin would leave every one of those unresolvable — so the channel product is the unit
     * here, exactly as it is everywhere else in this repository.
     */
    static List<CanonicalProduct> toCanonical(OriginProduct origin, int startRow, Instant now) {
        List<CanonicalProduct> out = new ArrayList<>();
        List<ChannelProductRow> listings = origin.channelProducts() == null ? List.of() : origin.channelProducts();
        int row = startRow;
        for (ChannelProductRow listing : listings) {
            if (listing.channelProductNo() == null) {
                continue; // No identity ⇒ not storable. Skipped, never synthesized.
            }
            Map<String, String> attributes = new LinkedHashMap<>();
            List<CanonicalProductVariant> variants = new ArrayList<>();
            if (listing.optionCombinations() != null) {
                for (OptionCombination option : listing.optionCombinations()) {
                    if (option.id() == null) {
                        continue;
                    }
                    variants.add(new CanonicalProductVariant(
                            Long.toString(option.id()),
                            optionName(option),
                            blankToNull(option.sellerManagerCode()),
                            option.price(),
                            option.usable() == null ? null : (option.usable() ? "SALE" : "SUSPENSION")));
                }
            }
            String externalId = Long.toString(listing.channelProductNo());
            out.add(new CanonicalProduct(
                    externalId,
                    blankToNull(listing.name()),
                    // The seller's own management code wins over the channel number, matching
                    // ProductService's "SKU is the seller's identifier" rule; the export column that
                    // created these products carries the same value.
                    firstPresent(listing.sellerManagementCode(), externalId),
                    blankToNull(listing.storeKeepingUrl()),
                    listing.salePrice(),
                    listing.salePrice() == null ? null : "KRW",
                    blankToNull(listing.statusType()),
                    blankToNull(listing.brandName()),
                    blankToNull(listing.manufacturerName()),
                    listing.wholeCategoryName() != null ? blankToNull(listing.wholeCategoryName())
                            : blankToNull(listing.categoryId()),
                    blankToNull(listing.detailContent()),
                    attributes,
                    variants,
                    observedAt(listing, now),
                    SOURCE,
                    row++));
        }
        return out;
    }

    /** "색상:검정 / 길이:2m" — the option's own axis labels, joined. Never invented when absent. */
    private static String optionName(OptionCombination option) {
        List<String> parts = new ArrayList<>();
        for (String value : List.of(
                nullToEmpty(option.optionName1()), nullToEmpty(option.optionName2()),
                nullToEmpty(option.optionName3()))) {
            if (!value.isBlank()) {
                parts.add(value.strip());
            }
        }
        return parts.isEmpty() ? null : String.join(" / ", parts);
    }

    private static Instant observedAt(ChannelProductRow listing, Instant fallback) {
        Instant parsed = parseInstant(listing.modifiedDate());
        if (parsed == null) {
            parsed = parseInstant(listing.regDate());
        }
        return parsed == null ? fallback : parsed;
    }

    /** No offset ⇒ null, never an assumed zone: this value feeds a staleness verdict. */
    private static Instant parseInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value.strip()).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static int parsePage(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return 1; // NAVER's product search pages from 1.
        }
        try {
            return Math.max(Integer.parseInt(cursorValue.strip()), 1);
        } catch (NumberFormatException e) {
            return 1;
        }
    }

    private static String firstPresent(String... values) {
        for (String value : values) {
            String trimmed = blankToNull(value);
            if (trimmed != null) {
                return trimmed;
            }
        }
        return null;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record SearchResponse(@JsonProperty("contents") List<OriginProduct> contents,
                          @JsonProperty("totalElements") Integer totalElements) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record OriginProduct(@JsonProperty("originProductNo") Long originProductNo,
                         @JsonProperty("channelProducts") List<ChannelProductRow> channelProducts) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChannelProductRow(@JsonProperty("channelProductNo") Long channelProductNo,
                             @JsonProperty("name") String name,
                             @JsonProperty("statusType") String statusType,
                             @JsonProperty("salePrice") BigDecimal salePrice,
                             @JsonProperty("sellerManagementCode") String sellerManagementCode,
                             @JsonProperty("brandName") String brandName,
                             @JsonProperty("manufacturerName") String manufacturerName,
                             @JsonProperty("categoryId") String categoryId,
                             @JsonProperty("wholeCategoryName") String wholeCategoryName,
                             @JsonProperty("detailContent") String detailContent,
                             @JsonProperty("storeKeepingUrl") String storeKeepingUrl,
                             @JsonProperty("regDate") String regDate,
                             @JsonProperty("modifiedDate") String modifiedDate,
                             @JsonProperty("optionCombinations") List<OptionCombination> optionCombinations) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record OptionCombination(@JsonProperty("id") Long id,
                             @JsonProperty("optionName1") String optionName1,
                             @JsonProperty("optionName2") String optionName2,
                             @JsonProperty("optionName3") String optionName3,
                             @JsonProperty("sellerManagerCode") String sellerManagerCode,
                             @JsonProperty("price") BigDecimal price,
                             @JsonProperty("usable") Boolean usable) {
    }
}
