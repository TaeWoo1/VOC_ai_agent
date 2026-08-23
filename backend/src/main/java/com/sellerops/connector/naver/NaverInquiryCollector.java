package com.sellerops.connector.naver;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The NAVER INQUIRY lane driver: two official resources, one cursor slot, one data type.
 *
 * <p>NAVER publishes 상품 문의 and 고객 문의 as separate resources with separate contracts
 * ({@code docs/naver_inquiry_api_audit_v1.md}). The runtime gives a connector one cursor per
 * (account × data type), so a run sweeps one source to its documented end, then the other, and the
 * cursor remembers each lane's own position. A source whose client is not wired is skipped entirely —
 * which is also how a live proof measures ONE source: enable only that source's flag.
 *
 * <p><b>This class makes no product decision and holds no credential.</b> It maps pages to canonical
 * rows and moves a position; attribution happens once, in ingest, by channel identifier.
 */
public class NaverInquiryCollector {

    private static final Logger log = LoggerFactory.getLogger(NaverInquiryCollector.class);

    private final NaverProductQnaClient qnaClient;
    private final NaverCustomerInquiriesClient customerClient;
    private final Clock clock;
    private final ObjectMapper mapper = new ObjectMapper();

    /** Either client may be null — an unwired source is one this connector does not read. */
    public NaverInquiryCollector(NaverProductQnaClient qnaClient,
                                 NaverCustomerInquiriesClient customerClient, Clock clock) {
        this.qnaClient = qnaClient;
        this.customerClient = customerClient;
        this.clock = clock;
    }

    /** True when at least one inquiry source is actually reachable. */
    public boolean hasAnySource() {
        return qnaClient != null || customerClient != null;
    }

    /** One page of whichever source is currently outstanding. */
    public FetchPage fetchInquiryPage(String accessToken, String cursorValue) {
        boolean qnaEnabled = qnaClient != null;
        boolean customerEnabled = customerClient != null;
        Instant now = clock.instant();

        NaverInquiryCursor stored = decode(cursorValue);
        Duration lag = NaverInquiryCursor.routineLag(stored, now);
        if (lag != null) {
            // Named, never silently swept: the skipped span is an operator's bounded backfill.
            log.warn("네이버 문의 routine 커서가 {}일 뒤처져 최근 {}일 구간에서 재시작합니다."
                            + " 그 이전 구간은 자동 복구하지 않으며 별도 backfill 대상입니다.",
                    lag.toDays(), NaverOrdersClient.ROUTINE_MAX_LAG.toDays());
        }
        NaverInquiryCursor cursor = NaverInquiryCursor.routine(stored, now, qnaEnabled, customerEnabled);

        String source = cursor.activeSource(qnaEnabled, customerEnabled);
        if (source == null) {
            // Both enabled lanes are finished. Hand the cursor back so the NEXT cycle recomputes its
            // windows rather than parking one page past the end (the PRODUCT cursor defect).
            return FetchPage.of(DataType.INQUIRY, List.of(), encode(cursor), false, NaverApiConnector.KIND);
        }

        boolean isQna = NaverInquiryCursor.SOURCE_PRODUCT_QNA.equals(source);
        NaverInquiryCursor.Lane lane = isQna ? cursor.qna() : cursor.customer();
        NaverInquiryPage page = isQna
                ? qnaClient.fetchPage(accessToken, lane)
                : customerClient.fetchPage(accessToken, lane);

        NaverInquiryCursor.Lane advanced = page.last() ? lane.finished() : lane.nextPage();
        NaverInquiryCursor next = isQna ? cursor.withQna(advanced) : cursor.withCustomer(advanced);
        boolean hasMore = !next.bothDone(qnaEnabled, customerEnabled);

        log.info("네이버 문의 페이지: source={} rows={} window={}~{} page={} hasMore={}",
                source, page.rows().size(), lane.from(), lane.to(), lane.page(), hasMore);
        return FetchPage.of(DataType.INQUIRY, page.rows(), encode(next), hasMore, NaverApiConnector.KIND);
    }

    /**
     * Seed an operator's bounded window over both sources.
     *
     * <p>Bounded, so it is never recomputed and never walks past its end; the routine lane's position
     * is a different field of a different cursor row and is not touched by it.
     */
    public String boundedWindowSeed(LocalDate startDate, LocalDate endDate) {
        return encode(NaverInquiryCursor.bounded(startDate, endDate, qnaClient != null));
    }

    /** A null/blank/garbage cursor is not resumed — it becomes a fresh routine window. */
    private NaverInquiryCursor decode(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(cursorValue, NaverInquiryCursor.class);
        } catch (Exception e) {
            log.warn("네이버 문의 커서를 해석할 수 없어 최근 구간에서 새로 시작합니다.");
            return null;
        }
    }

    private String encode(NaverInquiryCursor cursor) {
        try {
            return mapper.writeValueAsString(cursor);
        } catch (Exception e) {
            throw new IllegalStateException("네이버 문의 커서를 직렬화할 수 없습니다.");
        }
    }
}
