package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Names the category attributes a listing carries — NAVER's attribute catalogue, read-only.
 *
 * <pre>
 * GET /v1/product-attributes/attributes?categoryId=      attributeSeq → attributeName
 * GET /v1/product-attributes/attribute-values?categoryId= attributeValueSeq → min/max value + unit code
 * GET /v1/product-attributes/attribute-value-units        unit code → unit name
 * </pre>
 *
 * <p><b>Why a second read exists.</b> A channel product names its attributes only by id
 * ({@code detailAttribute.productAttributes[].attributeSeq/attributeValueSeq}); «attribute 10032, value 88213» is not a
 * statement anyone can check a customer's question against. The three contracts are vendored under
 * {@code docs/vendor/naver-commerce-api/get-v1-product-attributes-*.md}. A value is rendered from the fields the
 * contract publishes and nothing else: the seller's {@code attributeRealValue} (range attributes) when present,
 * otherwise the catalogue's {@code minAttributeValue}, or {@code min~max} when the catalogue value is a range — with
 * the unit's published name. An id the catalogue does not resolve produces no fact, never a guessed one.
 *
 * <p><b>Cached, per category.</b> The contract calls these low-churn metadata to cache; a catalogue of 69 listings
 * over a handful of leaf categories costs two reads per category and one for units per {@link #TTL}, not two per
 * product. {@link #reads()} counts what was actually requested so a bootstrap can report it.
 */
public class NaverProductAttributeClient {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(NaverProductAttributeClient.class);

    static final String ATTRIBUTES_PATH = "/external/v1/product-attributes/attributes";
    static final String VALUES_PATH = "/external/v1/product-attributes/attribute-values";
    static final String UNITS_PATH = "/external/v1/product-attributes/attribute-value-units";

    static final Duration TTL = Duration.ofHours(24);

    private final NaverHttpClient http;
    private final String baseUrl;
    private final Clock clock;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, Cached<Category>> categories = new ConcurrentHashMap<>();
    private volatile Cached<Map<String, String>> units;
    private final AtomicInteger reads = new AtomicInteger();

    public NaverProductAttributeClient(NaverHttpClient http, String baseUrl, Clock clock) {
        this.http = http;
        this.baseUrl = baseUrl;
        this.clock = clock;
    }

    /** Requests made so far by this client — every one a read of catalogue metadata, never of seller data. */
    public int reads() {
        return reads.get();
    }

    /**
     * {@code 용량 → 9oz}, one entry per attribute the listing carries and the catalogue names, in listing order; a
     * multi-select attribute's values joined. Empty when there is nothing to name or any read failed — a missing
     * name is a missing fact, and the listing's other statements are unaffected.
     */
    public Map<String, String> name(String accessToken, String categoryId, List<NaverProductDetail.AttributeRef> refs) {
        Map<String, String> out = new LinkedHashMap<>();
        if (refs == null || refs.isEmpty() || categoryId == null || categoryId.isBlank()) {
            return out;
        }
        Category category;
        Map<String, String> unitNames;
        try {
            category = category(accessToken, categoryId.strip());
            unitNames = units(accessToken);
        } catch (RuntimeException e) {
            // Remembered as empty for the TTL: a category the channel refused once is not asked again for every
            // listing in it — the read budget of a catalogue pass is per category, failure included.
            categories.putIfAbsent(categoryId.strip(), new Cached<>(new Category(Map.of(), Map.of()),
                    clock.instant().plus(TTL)));
            if (units == null) {
                units = new Cached<>(Map.of(), clock.instant().plus(TTL));
            }
            return out;
        }
        for (NaverProductDetail.AttributeRef ref : refs) {
            String name = category.names().get(ref.attributeSeq());
            if (name == null) {
                continue;
            }
            String value = render(ref, category, unitNames);
            if (value == null) {
                continue;
            }
            out.merge(name, value, (a, b) -> a.equals(b) ? a : a + ", " + b);
        }
        return out;
    }

    static String render(NaverProductDetail.AttributeRef ref, Category category, Map<String, String> units) {
        if (ref.realValue() != null && !ref.realValue().isBlank()) {
            return withUnit(ref.realValue().strip(), ref.realValueUnitCode(), units);
        }
        Value v = ref.attributeValueSeq() == null ? null : category.values().get(ref.attributeValueSeq());
        if (v == null || v.min() == null) {
            return null;
        }
        String min = withUnit(v.min(), v.minUnit(), units);
        if (v.max() == null || v.max().equals(v.min())) {
            return min;
        }
        return min + "~" + withUnit(v.max(), v.maxUnit(), units);
    }

    private static String withUnit(String value, String unitCode, Map<String, String> units) {
        if (unitCode == null || unitCode.isBlank()) {
            return value;
        }
        String unit = units.get(unitCode.strip());
        // An unnamed unit code is left off rather than printed: 「9 U0012」 is not a statement a customer can read.
        return unit == null ? value : value + unit;
    }

    private Category category(String token, String categoryId) {
        Instant now = clock.instant();
        Cached<Category> hit = categories.get(categoryId);
        if (hit != null && hit.until().isAfter(now)) {
            return hit.value();
        }
        String q = "?categoryId=" + URLEncoder.encode(categoryId, StandardCharsets.UTF_8);
        Map<Long, String> names = new HashMap<>();
        for (JsonNode a : getArray(token, ATTRIBUTES_PATH + q)) {
            if (a.path("attributeSeq").isNumber() && a.path("attributeName").isTextual()
                    && !a.path("attributeName").asText().isBlank()) {
                names.put(a.path("attributeSeq").longValue(), a.path("attributeName").asText().strip());
            }
        }
        Map<Long, Value> values = new HashMap<>();
        for (JsonNode v : getArray(token, VALUES_PATH + q)) {
            if (v.path("attributeValueSeq").isNumber()) {
                values.put(v.path("attributeValueSeq").longValue(), new Value(
                        NaverChannelProductClient.text(v, "minAttributeValue"),
                        NaverChannelProductClient.text(v, "minAttributeValueUnitCode"),
                        NaverChannelProductClient.text(v, "maxAttributeValue"),
                        NaverChannelProductClient.text(v, "maxAttributeValueUnitCode")));
            }
        }
        Category category = new Category(names, values);
        categories.put(categoryId, new Cached<>(category, now.plus(TTL)));
        return category;
    }

    private Map<String, String> units(String token) {
        Instant now = clock.instant();
        Cached<Map<String, String>> hit = units;
        if (hit != null && hit.until().isAfter(now)) {
            return hit.value();
        }
        Map<String, String> out = new HashMap<>();
        for (JsonNode u : getArray(token, UNITS_PATH)) {
            String id = NaverChannelProductClient.text(u, "id");
            String name = NaverChannelProductClient.text(u, "unitCodeName");
            if (id != null && name != null) {
                out.put(id, name);
            }
        }
        units = new Cached<>(out, now.plus(TTL));
        return out;
    }

    private Iterable<JsonNode> getArray(String token, String pathAndQuery) {
        reads.incrementAndGet();
        NaverHttpClient.Response response = http.get(URI.create(baseUrl + pathAndQuery), token);
        // Path only (the category id is catalogue metadata, not seller data) — so a bounded run can count its reads.
        log.info("naver attribute catalogue read path={} status={}", pathAndQuery.split("\\?")[0],
                response.statusCode());
        if (response.statusCode() == 429) {
            throw NaverRateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException("네이버 상품 속성 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        try {
            JsonNode root = mapper.readTree(response.body());
            return root.isArray() ? root : List.of();
        } catch (java.io.IOException e) {
            throw new IllegalStateException("네이버 상품 속성 응답을 해석할 수 없습니다.");
        }
    }

    record Category(Map<Long, String> names, Map<Long, Value> values) {
    }

    record Value(String min, String minUnit, String max, String maxUnit) {
    }

    private record Cached<T>(T value, Instant until) {
    }
}
