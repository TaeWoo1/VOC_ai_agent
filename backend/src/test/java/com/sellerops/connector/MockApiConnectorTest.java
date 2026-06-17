package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Slice 2: MockApiConnector pagination, rate-limit signal, and unsupported-type behavior. */
class MockApiConnectorTest {

    private MockApiConnector connector;
    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        connector = new MockApiConnector();
    }

    private FetchRequest req(String channel, DataType type, String cursor, int limit) {
        return new FetchRequest(org, account, channel, type, cursor, limit);
    }

    @Test
    void capabilitiesAreChannelAwareAndConsistentWithFetch() {
        assertThat(connector.kind()).isEqualTo("MOCK_API");
        // Non-marketplace channel: reviews available.
        ConnectorCapabilities open = connector.capabilities("GMARKET");
        assertThat(open.connectorClass()).isEqualTo("API");
        assertThat(open.supports(DataType.REVIEW)).isTrue();
        assertThat(open.supportedDataTypes()).contains(DataType.INQUIRY, DataType.ORDER_SUMMARY, DataType.REVIEW);
        // Coupang: REVIEW excluded from capabilities, matching fetch() throwing.
        ConnectorCapabilities coupang = connector.capabilities("COUPANG");
        assertThat(coupang.supports(DataType.REVIEW)).isFalse();
        assertThat(coupang.supportedDataTypes())
                .contains(DataType.INQUIRY, DataType.ORDER_SUMMARY)
                .doesNotContain(DataType.REVIEW);
    }

    @Test
    void fetchIsDeterministicForTheSameRequest() {
        FetchPage a = connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20));
        FetchPage b = connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20));
        assertThat(a.records()).isEqualTo(b.records());
        assertThat(a.nextCursorValue()).isEqualTo(b.nextCursorValue());
        assertThat(a.hasMore()).isEqualTo(b.hasMore());
        assertThat(a.rateLimited()).isFalse();
    }

    @Test
    void paginationWalksAllRecordsAndTerminatesDeterministically() {
        List<Object> firstRun = drain("GMARKET", DataType.INQUIRY, 20);
        List<Object> secondRun = drain("GMARKET", DataType.INQUIRY, 20);
        // INQUIRY synthetic total is 45 — paging by 20 yields 20 + 20 + 5.
        assertThat(firstRun).hasSize(45);
        assertThat(firstRun).isEqualTo(secondRun);
    }

    @Test
    void firstPageCursorAdvancesAndSignalsMore() {
        FetchPage page = connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20));
        assertThat(page.records()).hasSize(20);
        assertThat(page.nextCursorValue()).isEqualTo("20");
        assertThat(page.hasMore()).isTrue();
        assertThat(page.source()).isEqualTo("MOCK_API");
    }

    @Test
    void rateLimitSignalIsDeterministicAndOptIn() {
        // Off by default — never throttled.
        assertThat(connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20)).rateLimited()).isFalse();

        connector.setRateLimitAtOffset(0);
        FetchPage first = connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20));
        FetchPage again = connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20));
        assertThat(first.rateLimited()).isTrue();
        assertThat(first.records()).isEmpty();
        assertThat(first.retryAfterSeconds()).isEqualTo(5);
        assertThat(first.nextCursorValue()).isNull(); // cursor unchanged (was null)
        // Deterministic: a repeat trips identically.
        assertThat(again.rateLimited()).isTrue();
        assertThat(again.retryAfterSeconds()).isEqualTo(first.retryAfterSeconds());
    }

    @Test
    void rateLimitTripsOnlyAtConfiguredOffset() {
        connector.setRateLimitAtOffset(20);
        assertThat(connector.fetch(req("GMARKET", DataType.INQUIRY, null, 20)).rateLimited()).isFalse();
        assertThat(connector.fetch(req("GMARKET", DataType.INQUIRY, "20", 20)).rateLimited()).isTrue();
    }

    @Test
    void reviewIsUnsupportedForCoupangAndNaverButSupportedElsewhere() {
        assertThat(connector.supports("COUPANG", DataType.REVIEW)).isFalse();
        assertThat(connector.supports("NAVER", DataType.REVIEW)).isFalse();
        assertThat(connector.supports("GMARKET", DataType.REVIEW)).isTrue();

        assertThatThrownBy(() -> connector.fetch(req("COUPANG", DataType.REVIEW, null, 20)))
                .isInstanceOf(UnsupportedDataTypeException.class);
        assertThatThrownBy(() -> connector.fetch(req("NAVER", DataType.REVIEW, null, 20)))
                .isInstanceOf(UnsupportedDataTypeException.class);

        FetchPage ok = connector.fetch(req("GMARKET", DataType.REVIEW, null, 20));
        assertThat(ok.records()).hasSize(20);
    }

    @Test
    void productAndSalesAreSupportedButEmptyForNow() {
        FetchPage product = connector.fetch(req("COUPANG", DataType.PRODUCT, null, 20));
        FetchPage sales = connector.fetch(req("COUPANG", DataType.SALES, null, 20));
        assertThat(product.records()).isEmpty();
        assertThat(product.hasMore()).isFalse();
        assertThat(sales.records()).isEmpty();
        assertThat(sales.hasMore()).isFalse();
    }

    @Test
    void malformedCursorIsRejectedExplicitly() {
        assertThatThrownBy(() -> connector.fetch(req("GMARKET", DataType.INQUIRY, "not-a-number", 20)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /** Page through a data type to exhaustion and collect all records. */
    private List<Object> drain(String channel, DataType type, int limit) {
        List<Object> all = new ArrayList<>();
        String cursor = null;
        boolean more = true;
        int guard = 0;
        while (more && guard++ < 1000) {
            FetchPage page = connector.fetch(req(channel, type, cursor, limit));
            all.addAll(page.records());
            cursor = page.nextCursorValue();
            more = page.hasMore();
        }
        return all;
    }
}
