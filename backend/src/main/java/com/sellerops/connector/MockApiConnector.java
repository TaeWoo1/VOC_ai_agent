package com.sellerops.connector;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * A deterministic, offline stand-in for a future real API connector (Coupang /
 * Naver). It synthesizes canonical records from the request alone — <b>zero
 * network calls, zero credentials, no DB access, no {@code Math.random}, no
 * {@code Instant.now()}</b> — so the same {@link FetchRequest} always yields the
 * same {@link FetchPage}. It exists to exercise the scheduled-collection backbone
 * end to end before any real integration.
 *
 * <p>Slice 2 scope: contract + pagination + a deterministic rate-limit signal
 * ONLY. It does not persist, advance cursors, or write sync jobs — those are
 * later slices.
 */
@Component
public class MockApiConnector implements PullConnector {

    public static final String KIND = "MOCK_API";
    /** The connector priority class this mock fills (slot for the real API connector). */
    public static final String CONNECTOR_CLASS = "API";

    private static final int DEFAULT_LIMIT = 20;
    private static final int RETRY_AFTER_SECONDS = 5;
    private static final Instant BASE_INSTANT = Instant.parse("2026-06-01T00:00:00Z");
    private static final LocalDate BASE_DATE = LocalDate.parse("2026-06-01");

    /** Marketplaces with no official review API (verified Phase 3B finding). */
    private static final Set<String> REVIEW_UNSUPPORTED_CHANNELS = Set.of("COUPANG", "NAVER");

    /**
     * Test/dev-only simulation hook: when set, {@link #fetch} returns a throttled
     * page exactly when the requested offset equals this value. Null (default)
     * means never rate-limited — production paths leave it null.
     */
    private Integer rateLimitAtOffset = null;

    /** Test/dev hook — enable a deterministic rate-limit at the given offset. */
    public void setRateLimitAtOffset(Integer offset) {
        this.rateLimitAtOffset = offset;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public ConnectorCapabilities capabilities(String channelCode) {
        // Channel-aware: derived from the same supports() predicate fetch() uses, so
        // the advertised set never disagrees with runtime behavior. REVIEW is
        // excluded for marketplaces with no review API; PRODUCT/SALES stay
        // supported-but-empty.
        Set<DataType> supported = EnumSet.allOf(DataType.class);
        supported.removeIf(dataType -> !supports(channelCode, dataType));
        return new ConnectorCapabilities(
                CONNECTOR_CLASS,
                supported,
                Map.of(),
                "Deterministic mock; zero network/credentials. PRODUCT/SALES return empty pages until canonical types exist.");
    }

    /** Whether this connector serves the given data type for the given channel. */
    public boolean supports(String channelCode, DataType dataType) {
        if (dataType == DataType.REVIEW && REVIEW_UNSUPPORTED_CHANNELS.contains(channelCode)) {
            return false;
        }
        return true;
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!supports(request.channelCode(), request.dataType())) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        int offset = parseOffset(request.cursorValue());

        // Deterministic, opt-in throttle signal (default off). No records, cursor
        // unchanged — a retry re-requests the same offset. Acting on this signal
        // (backoff) is a later slice.
        if (rateLimitAtOffset != null && offset == rateLimitAtOffset) {
            return FetchPage.rateLimited(request.dataType(), request.cursorValue(), RETRY_AFTER_SECONDS, KIND);
        }

        int limit = request.limit() > 0 ? request.limit() : DEFAULT_LIMIT;
        int total = syntheticTotal(request.dataType());
        int end = Math.min(offset + limit, total);
        int count = Math.max(0, end - offset);

        List<?> records = generate(request.channelCode(), request.dataType(), offset, count);
        int nextOffset = offset + count;
        boolean hasMore = nextOffset < total;
        return FetchPage.of(request.dataType(), records, String.valueOf(nextOffset), hasMore, KIND);
    }

    private int parseOffset(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return 0;
        }
        try {
            return Math.max(0, Integer.parseInt(cursorValue.trim()));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Mock cursor must be a non-negative integer offset: " + cursorValue);
        }
    }

    /** Deterministic per-data-type record count. PRODUCT/SALES intentionally empty for now. */
    private int syntheticTotal(DataType dataType) {
        return switch (dataType) {
            case REVIEW -> 60;
            case INQUIRY -> 45;
            case ORDER_SUMMARY -> 30;
            case PRODUCT, SALES -> 0;
        };
    }

    private List<?> generate(String channelCode, DataType dataType, int offset, int count) {
        return switch (dataType) {
            case INQUIRY -> inquiries(channelCode, offset, count);
            case ORDER_SUMMARY -> orderSummaries(offset, count);
            case REVIEW -> reviews(channelCode, offset, count);
            case PRODUCT, SALES -> List.of();
        };
    }

    private List<CanonicalInquiry> inquiries(String channelCode, int offset, int count) {
        List<CanonicalInquiry> out = new ArrayList<>(count);
        for (int i = offset; i < offset + count; i++) {
            out.add(new CanonicalInquiry(
                    "목업 상품 " + (i % 5 + 1),
                    "MOCK-SKU-" + (i % 5 + 1),
                    "고객" + i,
                    channelCode + " 문의 본문 " + i,
                    i % 2 == 0 ? "UNANSWERED" : "ANSWERED",
                    BASE_INSTANT.minusSeconds((long) i * 3600),
                    externalId(channelCode, dataTypeName(DataType.INQUIRY), i),
                    i + 1,
                    channelCode + " 문의 제목 " + i,
                    i % 2 == 0 ? "미처리" : "처리완료"));
        }
        return out;
    }

    private List<CanonicalOrderSummary> orderSummaries(int offset, int count) {
        List<CanonicalOrderSummary> out = new ArrayList<>(count);
        for (int i = offset; i < offset + count; i++) {
            out.add(new CanonicalOrderSummary(
                    BASE_DATE.minusDays(i),
                    10 + (i % 7),
                    100_000L + (long) i * 1234,
                    i + 1));
        }
        return out;
    }

    private List<CanonicalReview> reviews(String channelCode, int offset, int count) {
        List<CanonicalReview> out = new ArrayList<>(count);
        for (int i = offset; i < offset + count; i++) {
            out.add(new CanonicalReview(
                    "목업 상품 " + (i % 5 + 1),
                    "MOCK-SKU-" + (i % 5 + 1),
                    1 + (i % 5),
                    channelCode + " 리뷰 본문 " + i,
                    BASE_INSTANT.minusSeconds((long) i * 3600),
                    externalId(channelCode, dataTypeName(DataType.REVIEW), i),
                    i + 1));
        }
        return out;
    }

    private static String dataTypeName(DataType dataType) {
        return dataType.name();
    }

    /** Stable external id so the downstream dedup treats re-fetched rows as duplicates. */
    private static String externalId(String channelCode, String dataType, int index) {
        return channelCode + ":" + dataType + ":" + index;
    }
}
