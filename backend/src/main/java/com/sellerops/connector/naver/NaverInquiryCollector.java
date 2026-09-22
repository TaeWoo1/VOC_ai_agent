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

    /**
     * What this connector may honestly say about {@code INQUIRY} as a whole.
     *
     * <p>The runtime has one verification word per DATA TYPE and NAVER has two inquiry RESOURCES, so
     * the two have to be folded — and the fold has to be the conservative one. {@code CONFIRMED} only
     * when every wired source has been proven live; one proven source beside one unproven source is a
     * type that has not been proven, because a run of that type would call both.
     *
     * <p>That is also why a proof is run with a single source armed: it makes the sentence
     * "this endpoint works" a fact about an endpoint rather than about a mixture.
     */
    public String verificationStatus() {
        return fold(qnaClient == null ? null : NaverProductQnaClient.VERIFICATION_STATUS,
                customerClient == null ? null : NaverCustomerInquiriesClient.VERIFICATION_STATUS);
    }

    /**
     * The fold, separated from the wiring so it stays testable once every real source is proven.
     *
     * <p>A {@code null} is a source this connector does not read, and an unread source is not waited
     * on. Anything else must be {@code CONFIRMED} for the type to be.
     */
    static String fold(String qnaStatus, String customerStatus) {
        boolean allProven = (qnaStatus == null || "CONFIRMED".equals(qnaStatus))
                && (customerStatus == null || "CONFIRMED".equals(customerStatus));
        return allProven ? "CONFIRMED" : "NEEDS_VERIFICATION";
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
     * <b>Each wired source's first page, asked once</b> — the two official NAVER inquiry lanes verified
     * independently (live preflight). {@link #fetchInquiryPage} reads whichever lane is outstanding and advances; this
     * builds the same bounded window {@link #boundedWindowSeed} would, takes each lane's page-1 {@code Lane} and asks
     * its client exactly once. No lane is advanced — there is no cursor to return — so a second page cannot follow.
     * One lane failing does not stop the other.
     */
    public List<com.sellerops.connector.BoundedReadProbe.SourcePage> probeFirstPages(String accessToken,
                                                                                    LocalDate startDate,
                                                                                    LocalDate endDate) {
        NaverInquiryCursor window = NaverInquiryCursor.bounded(startDate, endDate, qnaClient != null);
        List<com.sellerops.connector.BoundedReadProbe.SourcePage> pages = new java.util.ArrayList<>();
        pages.add(qnaClient == null
                ? com.sellerops.connector.BoundedReadProbe.SourcePage.notWired(NaverInquiryCursor.SOURCE_PRODUCT_QNA)
                : firstPage(NaverInquiryCursor.SOURCE_PRODUCT_QNA, () -> qnaClient.fetchPage(accessToken, window.qna())));
        pages.add(customerClient == null
                ? com.sellerops.connector.BoundedReadProbe.SourcePage.notWired(NaverInquiryCursor.SOURCE_CUSTOMER)
                : firstPage(NaverInquiryCursor.SOURCE_CUSTOMER,
                        () -> customerClient.fetchPage(accessToken, window.customer())));
        return pages;
    }

    private com.sellerops.connector.BoundedReadProbe.SourcePage firstPage(
            String source, java.util.function.Supplier<NaverInquiryPage> oneRequest) {
        long started = clock.millis();
        try {
            NaverInquiryPage page = oneRequest.get();
            return new com.sellerops.connector.BoundedReadProbe.SourcePage(source,
                    com.sellerops.connector.BoundedReadProbe.SourcePage.SUCCESS, page.rows().size(), !page.last(),
                    null, clock.millis() - started);
        } catch (NaverRateLimitedException e) {
            return new com.sellerops.connector.BoundedReadProbe.SourcePage(source,
                    com.sellerops.connector.BoundedReadProbe.SourcePage.RATE_LIMITED, null, null, e,
                    clock.millis() - started);
        } catch (RuntimeException e) {
            return new com.sellerops.connector.BoundedReadProbe.SourcePage(source,
                    com.sellerops.connector.BoundedReadProbe.SourcePage.FAILED, null, null, e,
                    clock.millis() - started);
        }
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
