package com.sellerops.connector.cafe24;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalProduct;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumMap;
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
     * The ROUTINE board lane's trailing window, in KST days.
     *
     * <p>Same span as the order lookback and for the same reason: re-reading a fixed recent window
     * every run and upserting is idempotent, self-healing for a late edit, and — the part the board
     * lanes were missing — bounded by DATE rather than by position.
     *
     * <p>Before this, an empty routine cursor meant "offset 0, no window", so the ongoing lane walked
     * the board from its OLDEST article forward. On the demo org that produced 111 inquiries dated
     * 2014-10-28 to 2025-02-19 from a lane whose entire job is to notice what is new, while the newest
     * stored inquiry stayed at 2026-05-06. Historical completeness is the backfill lane's work, and it
     * must never be paid for with the freshness of the routine one.
     */
    static final int ROUTINE_WINDOW_DAYS = 14;
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
    private final Cafe24ProductsClient productsClient;
    private final Clock clock;

    public Cafe24ApiConnector(Cafe24Authorizer authorizer,
                              Cafe24OrdersClient ordersClient, Cafe24BoardArticlesClient articlesClient,
                              Cafe24ProductsClient productsClient, Clock clock) {
        this.authorizer = authorizer;
        this.ordersClient = ordersClient;
        this.articlesClient = articlesClient;
        this.productsClient = productsClient;
        this.clock = clock;
    }

    /**
     * Order + board wiring — a deployment (or a test) with no product client.
     *
     * <p>PRODUCT is then absent from the capability table rather than advertised and failing at call
     * time. It is also the shape a mall that has not granted {@code mall.read_product} effectively has.
     */
    public Cafe24ApiConnector(Cafe24Authorizer authorizer, Cafe24OrdersClient ordersClient,
                              Cafe24BoardArticlesClient articlesClient, Clock clock) {
        this(authorizer, ordersClient, articlesClient, null, clock);
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
                productsClient == null
                        ? Set.of(DataType.ORDER_SUMMARY, DataType.REVIEW, DataType.INQUIRY)
                        : Set.of(DataType.ORDER_SUMMARY, DataType.REVIEW, DataType.INQUIRY, DataType.PRODUCT),
                productsClient == null
                        ? Map.of(DataType.ORDER_SUMMARY, "CONFIRMED", DataType.REVIEW, "CONFIRMED",
                                DataType.INQUIRY, "CONFIRMED")
                        // The catalogue read is implemented and offline-verified; its wire shape has NOT
                        // been observed on a live mall from this repository, and the scope it needs
                        // (mall.read_product) is not in any existing grant. Claiming CONFIRMED here would
                        // be the exact over-statement the capability vocabulary exists to prevent.
                        : Map.of(DataType.ORDER_SUMMARY, "CONFIRMED", DataType.REVIEW, "CONFIRMED",
                                DataType.INQUIRY, "CONFIRMED", DataType.PRODUCT, "NEEDS_VERIFICATION"),
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
                        + " answered). PRODUCT reads the Admin product catalogue into CanonicalProduct"
                        + " (identity, listing name, price, selling status, brand/manufacturer, summary"
                        + " description) for the Product Knowledge layer — read-only, offset-paged, and"
                        + " requiring the mall.read_product scope that connections made before Operator"
                        + " Graph v2 do not carry (seller re-consent, never worked around). Wire shape is"
                        + " NEEDS_VERIFICATION. SALES remains deferred.");
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
            case PRODUCT -> {
                if (productsClient == null) {
                    throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
                }
                yield fetchProducts(request);
            }
            case SALES -> throw new UnsupportedDataTypeException(
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
     * PRODUCT: one page of the mall's catalogue, offset-paged.
     *
     * <p>The cursor is the plain next offset — the catalogue has no window and no natural key order to
     * resume from, so an integer is the honest cursor rather than an opaque wrapper implying more state
     * than exists. A short page ends the sweep.
     *
     * <p>An {@code insufficient_scope} failure is NOT swallowed: the mall has not granted product access
     * and the seller has to re-consent, which is a decision to surface rather than a condition to retry.
     */
    private FetchPage fetchProducts(FetchRequest request) {
        int offset = parseOffset(request.cursorValue());
        try {
            Cafe24Authorizer.Authorized auth = authorize(request);
            List<Cafe24ProductRow> rows = productsClient.fetchPage(
                    auth.accessToken(), auth.mallId(), Cafe24ProductsClient.PAGE_LIMIT, offset);
            java.time.Instant now = clock.instant();
            List<CanonicalProduct> records = new ArrayList<>();
            int sourceRow = 1;
            for (Cafe24ProductRow row : rows) {
                CanonicalProduct canonical = Cafe24ProductMapper.toCanonical(row, sourceRow++, now);
                if (canonical != null) {
                    records.add(canonical);
                }
            }
            boolean hasMore = rows.size() >= Cafe24ProductsClient.PAGE_LIMIT;
            int next = offset + rows.size();
            log.info("카페24 상품 수집: fetched={} mapped={} offset={} hasMore={}",
                    rows.size(), records.size(), offset, hasMore);
            return FetchPage.of(DataType.PRODUCT, records, Integer.toString(next), hasMore, KIND);
        } catch (Cafe24RateLimitedException e) {
            return rateLimited(request, e);
        }
    }

    /** A cursor that is not an offset is a cursor from another data type — start over, never guess. */
    private static int parseOffset(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return 0;
        }
        try {
            return Math.max(Integer.parseInt(cursorValue.strip()), 0);
        } catch (NumberFormatException e) {
            return 0;
        }
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
        LocalDate today = LocalDate.now(clock.withZone(KST));
        Cafe24ArticleCursor cursor = routineOrBackfill(
                Cafe24ArticleCursor.decode(request.cursorValue(), boardNo), boardNo, today);
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
            int outOfWindow = 0;
            int missingArticleNo = 0;
            // Sanitized closed-vocabulary tally of the reply state actually observed on the
            // STORED rows — a count per canonical value, never a raw token / id / title /
            // content. Unrecognized/blank stays UNKNOWN (never inferred). Lets a live-proof
            // record the observed reply_status distribution without any per-row content.
            EnumMap<CommunityReplyStatus, Integer> replyStatusStored =
                    new EnumMap<>(CommunityReplyStatus.class);
            for (CommunityReplyStatus s : CommunityReplyStatus.values()) {
                replyStatusStored.put(s, 0);
            }
            for (Cafe24BoardArticleRow row : rows) {
                position++;
                if (excludeSecret && !row.isPublicPost()) {
                    // 비밀글(또는 판정 불가): 본문·제목·식별자를 mapper·저장·로그로 넘기지 않고 제외.
                    excludedSecret++;
                    continue;
                }
                if (row.articleNo() == null) {
                    missingArticleNo++;
                    continue; // cannot dedupe/store without the natural-key article number
                }
                // Exact-window guard. The platform's start_date/end_date article filter is
                // doc-asserted, not contract-guaranteed — a live run returned an article whose
                // created_date was AFTER end_date — so the connector re-checks inclusion by the
                // article's own created_date (as a Cafe24/KST calendar date) and drops
                // out-of-window rows BEFORE mapping, ingestion, or work-item creation. Enforced
                // only on a windowed backfill cursor; a null/unparseable created_date fails
                // closed (treated as out-of-window), never assumed in-window.
                if (cursor.hasWindow()
                        && !withinWindow(row.createdDate(), cursor.windowStart(), cursor.windowEnd(),
                                cursor.routine())) {
                    outOfWindow++;
                    continue;
                }
                replyStatusStored.merge(
                        CommunityReplyStatus.normalize(row.replyStatus()), 1, Integer::sum);
                records.add(mapper.map(boardNo, row, position));
            }
            if (excludedSecret > 0) {
                // Sanitized metric only — a count, never an article id/title/content/writer.
                log.info("카페24 REVIEW 비밀글 제외: board={} 제외건수={}", boardNo, excludedSecret);
            }
            if (outOfWindow > 0) {
                // Sanitized metric only — a count, never an article id/date/title/content/writer.
                log.info("카페24 창 밖 게시글 제외: board={} 제외건수={}", boardNo, outOfWindow);
            }
            if (!rows.isEmpty()) {
                // Full sanitized per-page accounting — counts only, never an article id / title /
                // content / writer / raw token. raw_received reconciles as
                // stored + secret + out-of-window + missing_article_no. Here "저장"(stored) is the
                // count mapped/emitted to ingestion on THIS page, not net DB inserts — an idempotent
                // skip still increments it; net persisted rows are the SyncRun success count. The
                // reply_status distribution is over the mapped/emitted rows, in the closed canonical
                // vocabulary.
                log.info("카페24 게시판 수집 회계: board={} 수신={} 저장={} 비밀글제외={} 창밖제외={} "
                                + "식별번호없음제외={} reply_status[PENDING={} IN_PROGRESS={} ANSWERED={} UNKNOWN={}]",
                        boardNo, rows.size(), records.size(), excludedSecret, outOfWindow,
                        missingArticleNo,
                        replyStatusStored.get(CommunityReplyStatus.PENDING),
                        replyStatusStored.get(CommunityReplyStatus.IN_PROGRESS),
                        replyStatusStored.get(CommunityReplyStatus.ANSWERED),
                        replyStatusStored.get(CommunityReplyStatus.UNKNOWN));
            }
            boolean hasMore = rows.size() == request.limit();
            // A finished ROUTINE sweep rewinds to the start of a freshly-computed window rather than
            // carrying its offset forward. Carrying it forward is what turns "what is new" into "where
            // I stopped": the next run would skip as many rows as this one read, and a newly posted
            // article that lands anywhere but the very end of the page order would never be reached.
            // Overlap is the intended cost — the upsert is idempotent, and re-reading is also what
            // re-observes last_seen_at and picks up a source-side status change.
            Cafe24ArticleCursor next = cursor.routine() && !hasMore
                    ? routineWindowFor(boardNo, today)
                    : cursor.advance(rows.size());
            return FetchPage.of(request.dataType(), records, next.encode(), hasMore, KIND);
        } catch (Cafe24RateLimitedException e) {
            // Cursor unchanged → the next run re-requests the same offset.
            return rateLimited(request, e);
        }
    }

    /**
     * Decide which lane this cursor belongs to, and keep the routine one pointed at NOW.
     *
     * <p>The runtime chooses the lane and hands the connector an opaque value, so the cursor itself has
     * to carry the distinction. Three cases:
     * <ul>
     *   <li><b>An operator backfill window</b> (windowed, not routine) is returned untouched. Its dates
     *       are the operator's and moving them would silently change what was approved.</li>
     *   <li><b>A routine window that no longer reaches today</b> — yesterday's, or one left by a run
     *       days ago — is replaced by a fresh one at offset 0.</li>
     *   <li><b>No window at all</b> is the routine lane's first run (or a reset), and gets a fresh
     *       window rather than the whole-board offset sweep it used to get.</li>
     * </ul>
     */
    private Cafe24ArticleCursor routineOrBackfill(Cafe24ArticleCursor decoded, int boardNo,
                                                  LocalDate today) {
        if (decoded.hasWindow() && !decoded.routine()) {
            return decoded;
        }
        if (decoded.routineWindowCovers(today)) {
            return decoded;
        }
        return routineWindowFor(boardNo, today);
    }

    /** The trailing recent window the routine lane sweeps, in the explicit Cafe24 (KST) calendar. */
    private static Cafe24ArticleCursor routineWindowFor(int boardNo, LocalDate today) {
        return Cafe24ArticleCursor.routineWindow(boardNo, today.minusDays(ROUTINE_WINDOW_DAYS), today);
    }

    /**
     * Whether an article's {@code created_date} falls inside {@code [windowStart, windowEnd]} (both
     * ends inclusive), evaluated as a Cafe24 (KST) calendar date.
     *
     * <p>This client-side check is not redundant with the {@code start_date}/{@code end_date} request
     * params: a live run observed the endpoint returning rows past {@code end_date}, which is why the
     * window is re-checked here rather than trusted.
     *
     * <p><b>A row whose date cannot be read is treated differently by lane, and deliberately.</b>
     * <ul>
     *   <li><b>Backfill</b> — excluded, unchanged. Its window is an operator's approved scope, and a
     *       row that cannot be proven inside it must not be admitted.</li>
     *   <li><b>Routine</b> — kept. The defensive check exists to catch rows the server returned with a
     *       date OUTSIDE the range; an absent date is not evidence of that. Excluding it here would not
     *       defer the row to a later run, it would drop it from the recent lane forever — and the
     *       routine lane's whole purpose is not missing something new. An extra idempotent upsert is
     *       the cheaper mistake.</li>
     * </ul>
     */
    private static boolean withinWindow(String createdDate, LocalDate windowStart, LocalDate windowEnd,
                                        boolean routine) {
        LocalDate created = Cafe24BoardArticleMapper.parseKstDate(createdDate);
        if (created == null) {
            return routine;
        }
        return !created.isBefore(windowStart) && !created.isAfter(windowEnd);
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
