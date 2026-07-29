package com.sellerops.connector.cafe24;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The real Cafe24 Admin API connector. It collects {@code ORDER_SUMMARY}: a
 * refresh-token grant yields an access token, the Admin orders list is paged
 * over a trailing window, and the orders are folded into per-day
 * {@link CanonicalOrderSummary} ({@code payment_amount} summed by
 * {@code order_date}, in KST). The bean exists only behind
 * {@code sellerops.connector.cafe24.enabled=true}
 * ({@link Cafe24ConnectorConfiguration}); with the flag off, CAFE24 keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → refresh-token grant (proving
 * the credential chain) → <b>immediate rotation write-back</b> → orders pull +
 * per-day aggregation. The write-back ordering is an invariant, not a
 * convenience: Cafe24 refresh tokens are single-use, so the moment the provider
 * answers, the stored token is dead — persisting the replacement before
 * anything else (the orders call) can fail is what keeps the credential usable.
 * A failed refresh never writes back (the exception fires first), so the stored
 * credential is untouched on failure.
 *
 * <p>The whole window is aggregated in-memory and returned as a <b>single</b>
 * {@link FetchPage} (each date exactly once, {@code hasMore=false}), because
 * {@code ingestOrderSummaries} upserts last-wins per day — emitting partial
 * per-day rows across pages would undercount. A mid-window 429 discards the
 * partial aggregate and leaves the cursor unchanged, so the next run re-collects
 * the window cleanly.
 *
 * <p>The initial refresh token enters through the credential intake API after
 * the operator completes Cafe24's interactive authorization-code consent —
 * that flow is manual setup, not connector code.
 *
 * <p><b>Storage invariant:</b> the {@code secrets} map is the single
 * authoritative location for the Cafe24 refresh token (key
 * {@code refresh_token}); the vault row's separate refresh-token slot is NOT
 * read by this connector and is never written by rotation. A credential whose
 * token lives only in that slot fails the shape check closed, with a message
 * naming the missing key — reading both locations was deliberately rejected,
 * because after a rotation the slot would hold a dead token while the secrets
 * map holds the live one, and a dual-path reader could resurrect the dead one.
 */
public class Cafe24ApiConnector implements PullConnector {

    public static final String KIND = "CAFE24_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "CAFE24";

    private static final Logger log = LoggerFactory.getLogger(Cafe24ApiConnector.class);

    /**
     * 429 hint when the official X-Cafe24-Call-Remain header is absent. One
     * second is the smallest honest hint (the bucket drains 2/sec); the
     * scheduled runner clamps rate-limit waits to ≥1 minute anyway.
     */
    static final int FALLBACK_RETRY_AFTER_SECONDS = 1;

    /**
     * Cafe24 is a Korean platform: order dates and the {@code date_type} window
     * are KST. This is the explicit per-platform timezone policy — "today" and
     * the per-day bucketing are both computed in this zone, never an implicit
     * assumption elsewhere.
     */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** v1 collects a fixed trailing window; re-collection upserts (idempotent). */
    static final int LOOKBACK_DAYS = 14;
    /**
     * Cafe24 Admin list endpoints cap {@code limit} at the documented 100; the
     * connector pages internally (offset) to cover the window. A full page (==
     * this limit) means "there may be more, fetch the next"; a short page ends
     * the window. Requesting 100 makes that end-of-data signal exact — a value
     * above the server cap would silently return ≤100 and be mis-read as the last
     * page (silent truncation). Do not raise without a documented higher per-endpoint cap.
     */
    static final int ORDER_PAGE_LIMIT = 100;
    /** Safety bound on internal pages (100 × 200 = 20k orders) — caps a runaway loop. */
    static final int MAX_ORDER_PAGES = 200;

    /**
     * The shared credential-authorization seam (vault open → refresh → single-use
     * rotation write-back). Extracted so this connector and the diagnostic
     * live-proof use one path; see {@link Cafe24Authorizer}.
     */
    private final Cafe24Authorizer authorizer;
    private final Cafe24OrdersClient ordersClient;
    private final Cafe24BoardArticlesClient articlesClient;
    private final Clock clock;

    public Cafe24ApiConnector(Cafe24Authorizer authorizer,
                              Cafe24OrdersClient ordersClient, Cafe24BoardArticlesClient articlesClient,
                              Clock clock) {
        this.authorizer = authorizer;
        this.ordersClient = ordersClient;
        this.articlesClient = articlesClient;
        this.clock = clock;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public Set<String> dedicatedChannels() {
        return Set.of(CHANNEL_CODE);
    }

    @Override
    public ConnectorCapabilities capabilities(String channelCode) {
        return new ConnectorCapabilities(
                CONNECTOR_CLASS,
                Set.of(DataType.ORDER_SUMMARY, DataType.REVIEW, DataType.INQUIRY),
                Map.of(DataType.ORDER_SUMMARY, "CONFIRMED",
                        DataType.REVIEW, "CONFIRMED",
                        DataType.INQUIRY, "CONFIRMED"),
                "Cafe24 Admin orders → daily ORDER_SUMMARY (payment_amount summed by order_date, KST),"
                        + " CONFIRMED by a gated live run. REVIEW (board 4 구매후기) collects community"
                        + " board articles into CanonicalCommunityArticle (community/VOC store). INQUIRY"
                        + " (board 6 문의사항, the mall's native inquiry board) maps to CanonicalInquiry so"
                        + " the shared ingestion path opens one OPEN InquiryWorkItem bound to the seller"
                        + " connection (the seller-confirmed reply lifecycle). Read-only, via date-window"
                        + " backfill through the production runtime (sync_job/sync_cursor, board-4/6-only"
                        + " routing, dedupe). CONFIRMED by live runtime backfill runs. Board 9 1:1 맞춤상담"
                        + " stays excluded (PII + endpoint uncertainty). reply_status: the confirmed"
                        + " unanswered N maps to UNANSWERED; the answered token is unobserved, so any"
                        + " not-yet-seen token also stays UNANSWERED (conservative, never guessed as"
                        + " answered). Product/sales remain deferred.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode())) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }
        return switch (request.dataType()) {
            case ORDER_SUMMARY -> fetchOrderSummary(request);
            // REVIEW (board 4) stays a community article; INQUIRY (board 6) becomes a
            // canonical inquiry so it opens an OPEN work item on the shared reply path.
            case REVIEW -> fetchReviewArticles(request);
            case INQUIRY -> fetchInquiries(request);
            case PRODUCT, SALES -> throw new UnsupportedDataTypeException(
                    request.channelCode(), request.dataType());
        };
    }

    /**
     * ORDER_SUMMARY: page the KST trailing window and fold it into one upsert page
     * (each date once, {@code hasMore=false}). A throttle during refresh or
     * mid-window discards the partial aggregate and leaves the cursor unchanged.
     */
    private FetchPage fetchOrderSummary(FetchRequest request) {
        try {
            Cafe24Authorizer.Authorized auth = authorize(request);

            // Fixed trailing window in the explicit Cafe24 zone. Re-collecting the
            // same window each run and upserting (last-wins per day) is idempotent
            // and self-healing for late orders / cancellations.
            LocalDate endDate = LocalDate.now(clock.withZone(KST));
            LocalDate startDate = endDate.minusDays(LOOKBACK_DAYS);

            List<Cafe24OrderRow> orders = new ArrayList<>();
            int offset = 0;
            boolean reachedEnd = false;
            for (int page = 0; page < MAX_ORDER_PAGES; page++) {
                List<Cafe24OrderRow> batch = ordersClient.fetchPage(
                        auth.accessToken(), auth.mallId(), startDate, endDate, ORDER_PAGE_LIMIT, offset);
                orders.addAll(batch);
                if (batch.size() < ORDER_PAGE_LIMIT) {
                    reachedEnd = true;
                    break;
                }
                offset += ORDER_PAGE_LIMIT;
            }
            if (!reachedEnd) {
                // The page budget ran out while the last page was still full — more
                // orders exist. Fail closed (loud) rather than silently drop the
                // overflow; the fixed-window run is retried next cycle.
                throw new IllegalStateException(
                        "카페24 주문 수집이 최대 페이지 수(MAX_ORDER_PAGES)를 초과했습니다.");
            }
            List<CanonicalOrderSummary> summaries = Cafe24OrderAggregator.aggregate(orders, KST);
            return FetchPage.of(DataType.ORDER_SUMMARY, summaries, endDate.toString(), false, KIND);
        } catch (Cafe24RateLimitedException e) {
            return rateLimited(request, e);
        }
    }

    /**
     * REVIEW: one page of board-4 (구매후기) articles mapped to
     * {@link CanonicalCommunityArticle} — the richer, upsertable community/VOC asset.
     * Private (비밀글) posts are excluded fail-closed ({@code excludeSecret=true}): only
     * posts that positively read public are stored, so a private review's title/content
     * never reach the mapper, storage, or any log.
     */
    private FetchPage fetchReviewArticles(FetchRequest request) {
        return fetchArticlePage(request, Cafe24BoardArticleMapper::toCanonical, true);
    }

    /**
     * INQUIRY: one page of board-6 (문의사항) articles mapped to
     * {@link CanonicalInquiry}, so the shared ingestion path opens exactly one OPEN
     * {@code InquiryWorkItem} bound to the seller connection (the reply lifecycle).
     * Board 6 is the mall's <b>native</b> inquiry board — no external-marketplace
     * origin is read or assumed; board 9 (1:1 맞춤상담) is never collected. The
     * board-6 handling is unchanged ({@code excludeSecret=false}): the private-post
     * gate is scoped to the review path only.
     */
    private FetchPage fetchInquiries(FetchRequest request) {
        return fetchArticlePage(request, Cafe24InquiryArticleMapper::toCanonicalInquiry, false);
    }

    /**
     * Shared board-article page fetch: the board is fixed by data type
     * ({@link #primaryBoard}); the opaque {@link Cafe24ArticleCursor} carries the
     * offset across runs and the executor pages while {@code hasMore}. A row missing
     * {@code article_no} cannot be keyed and is dropped. The {@code mapper} decides
     * the canonical record type (community article for REVIEW, inquiry for INQUIRY);
     * paging, the windowed backfill cursor, and rate-limit handling are identical.
     *
     * <p>When {@code excludeSecret} is set (the review path), a row that does not
     * {@link Cafe24BoardArticleRow#isPublicPost() positively read public} is excluded
     * <b>before</b> mapping — its fields never reach the mapper, storage, or a log. The
     * cursor still advances by the number of rows <b>fetched</b> (not stored), so paging
     * stays correct on a mixed public/private page; {@code records} carries the public
     * count. Only a sanitized exclusion count is logged.
     */
    private FetchPage fetchArticlePage(FetchRequest request, ArticleRecordMapper mapper,
                                       boolean excludeSecret) {
        int boardNo = primaryBoard(request.dataType());
        Cafe24ArticleCursor cursor = Cafe24ArticleCursor.decode(request.cursorValue(), boardNo);
        try {
            Cafe24Authorizer.Authorized auth = authorize(request);
            // A windowed cursor (backfill seed) bounds the sweep to [start, end]; an
            // unseeded cursor sweeps by offset only. advance() preserves the window.
            List<Cafe24BoardArticleRow> rows = articlesClient.fetchPage(
                    auth.accessToken(), auth.mallId(), boardNo,
                    cursor.windowStart(), cursor.windowEnd(), request.limit(), cursor.offset());

            List<Object> records = new ArrayList<>();
            int position = 0;
            int excludedSecret = 0;
            for (Cafe24BoardArticleRow row : rows) {
                position++;
                if (excludeSecret && !row.isPublicPost()) {
                    // 비밀글(또는 판정 불가): 본문·제목·식별자를 mapper·저장·로그로 넘기지 않고 제외.
                    excludedSecret++;
                    continue;
                }
                if (row.articleNo() == null) {
                    continue; // cannot dedupe/store without the natural-key article number
                }
                records.add(mapper.map(boardNo, row, position));
            }
            if (excludedSecret > 0) {
                // Sanitized metric only — a count, never an article id/title/content/writer.
                log.info("카페24 REVIEW 비밀글 제외: board={} 제외건수={}", boardNo, excludedSecret);
            }
            boolean hasMore = rows.size() == request.limit();
            String nextCursor = cursor.advance(rows.size()).encode();
            return FetchPage.of(request.dataType(), records, nextCursor, hasMore, KIND);
        } catch (Cafe24RateLimitedException e) {
            // Cursor unchanged → the next run re-requests the same offset.
            return rateLimited(request, e);
        }
    }

    /** Maps one board-article row to its canonical record (community article or inquiry). */
    @FunctionalInterface
    private interface ArticleRecordMapper {
        Object map(int boardNo, Cafe24BoardArticleRow row, int sourceRow);
    }

    /**
     * Seed a bounded date-window backfill cursor for the community-article boards.
     * REVIEW/INQUIRY map to their primary board ({@link #primaryBoard}) with the
     * operator window encoded; the executor seeds this as the run's first cursor and
     * {@link Cafe24ArticleCursor#advance} preserves the window across pages. The dates
     * are Cafe24 KST calendar dates (the platform's explicit zone), passed straight to
     * the articles {@code start_date}/{@code end_date} filter. ORDER_SUMMARY self-windows
     * (fixed KST trailing range) and product/sales are not collected here, so all three
     * return empty — a windowed backfill is not theirs to serve.
     */
    @Override
    public Optional<String> backfillCursor(DataType dataType, LocalDate startDate, LocalDate endDate) {
        return switch (dataType) {
            case REVIEW, INQUIRY ->
                    Optional.of(Cafe24ArticleCursor.window(primaryBoard(dataType), startDate, endDate).encode());
            case ORDER_SUMMARY, PRODUCT, SALES -> Optional.empty();
        };
    }

    /**
     * The boundaries the confirmed Cafe24 capability deliberately excludes. Board 9
     * (1:1 맞춤상담) is never read (PII + endpoint uncertainty); article comments are
     * not collected; community write and automatic reply posting are never performed
     * (AI replies, when they exist, stay internal drafts). Surfaced read-only so the
     * operator UI is transparent about scope; not tied to any {@link DataType}.
     */
    @Override
    public List<com.sellerops.connector.UnsupportedScope> unsupportedScopes(String channelCode) {
        if (!CHANNEL_CODE.equals(channelCode)) {
            return List.of();
        }
        return List.of(
                new com.sellerops.connector.UnsupportedScope("BOARD_9", "1:1 맞춤상담(게시판 9) 미수집"),
                new com.sellerops.connector.UnsupportedScope("COMMENTS", "게시글 댓글 미수집"),
                new com.sellerops.connector.UnsupportedScope("COMMUNITY_WRITE", "게시판 글쓰기 미지원"),
                new com.sellerops.connector.UnsupportedScope("AUTO_REPLY", "자동 답변 등록 미지원"));
    }

    /** REVIEW → board 4 구매후기; INQUIRY → board 6 문의사항 (board 9 1:1 is a follow-up). */
    private static int primaryBoard(DataType dataType) {
        return dataType == DataType.REVIEW
                ? Cafe24BoardArticleMapper.REVIEW_BOARD_NO
                : Cafe24BoardArticleMapper.PRODUCT_INQUIRY_BOARD_NO;
    }

    /**
     * Delegate to the shared {@link Cafe24Authorizer} seam (vault open →
     * secret-shape check → refresh-token grant → immediate single-use rotation
     * write-back). A {@link Cafe24RateLimitedException} on refresh propagates
     * before any write-back; a failed refresh leaves the stored credential
     * untouched.
     */
    private Cafe24Authorizer.Authorized authorize(FetchRequest request) {
        return authorizer.authorize(request.orgId(), request.sellerAccountId());
    }

    private FetchPage rateLimited(FetchRequest request, Cafe24RateLimitedException e) {
        int retryAfter = e.retryAfterSeconds() != null ? e.retryAfterSeconds() : FALLBACK_RETRY_AFTER_SECONDS;
        // Cursor unchanged — a throttled attempt must re-request the same position.
        return FetchPage.rateLimited(request.dataType(), request.cursorValue(), retryAfter, KIND);
    }

}
