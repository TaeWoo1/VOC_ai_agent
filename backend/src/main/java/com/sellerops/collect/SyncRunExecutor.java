package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ConnectorAuthException;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.cafe24.Cafe24OAuthException;
import com.sellerops.connector.naver.NaverApiConnector;
import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.coupang.CoupangLiveApprovalRequiredException;
import com.sellerops.selfpilot.SellerAccountReauthService;
import com.sellerops.connector.coupang.onboarding.CoupangConnectionLifecycle;
import com.sellerops.connector.naver.onboarding.NaverConnectionLifecycle;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.map.RowError;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrder;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.Cafe24ReviewIssueBridge;
import com.sellerops.ingest.Cafe24ReviewPromotionReconciler;
import com.sellerops.order.ChannelOrderIngestionService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursor;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import org.springframework.beans.factory.annotation.Autowired;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Runs one scheduled/manual collection pass for a (seller account x data type):
 * resolve the pull connector via the registry, page through {@code fetch(cursor)},
 * route each page to the shared {@link IngestionService}, advance the
 * {@link SyncCursor} after every persisted page, and record the run lifecycle on
 * {@link SyncJob} plus connection health.
 *
 * <p>Scope (Slice 3): execution + routing + cursor advancement + run/health
 * recording ONLY. It does NOT schedule itself, retry, back off, escalate to
 * DEGRADED, raise alerts, decrypt credentials, or expose any endpoint — those are
 * later slices. A rate-limit signal stops the run; acting on it is Slice 4.
 *
 * <p>Deliberately NOT {@code @Transactional}: like {@code FileUploadConnector}, it
 * relies on {@link IngestionService}'s per-row transactions (a duplicate/bad row
 * must not roll back rows that already succeeded), and persists the cursor per
 * page so a mid-stream failure keeps earlier progress.
 */
@Service
public class SyncRunExecutor {

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(SyncRunExecutor.class);

    /** Single cursor per (account, data type); the connector owns the value's meaning. */
    static final String CURSOR_KEY = "primary";
    private static final int PAGE_LIMIT = 50;
    private static final int MAX_PAGES = 10_000;

    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final ConnectorRegistry registry;
    private final IngestionService ingestionService;
    private final ChannelOrderIngestionService orderIngestionService;
    private final SyncJobRepository syncJobs;
    private final SyncCursorRepository cursors;
    private final ChannelConnectionStatusRepository connectionStatus;
    /**
     * Optional: promotes freshly-ingested Cafe24 public board-4 REVIEW community articles into the
     * canonical review store so they reach the existing Issue-Memory pipeline. Null in the tests that
     * do not exercise the bridge; Spring injects the bean in production.
     */
    private final Cafe24ReviewIssueBridge reviewIssueBridge;
    /** Optional: after a successful Cafe24 board-4 REVIEW backfill, promotes the full stored window's
     *  reviews into Issue-Memory (no Cafe24 API call). Null in the bridge-less test constructor. */
    private final Cafe24ReviewPromotionReconciler reviewIssueReconciler;
    /** Optional: advances a NAVER account PREPARING → CONNECTED after its first ORDER_SUMMARY sync
     *  collects. Null in the bridge-less test constructor (the transition is then simply not applied). */
    private final NaverConnectionLifecycle naverLifecycle;
    /** Optional: advances a Coupang account PREPARING → CONNECTED after its first ORDER_SUMMARY sync
     *  collects. Null in the bridge-less test constructor (the transition is then simply not applied). */
    private final CoupangConnectionLifecycle coupangLifecycle;
    /**
     * Optional single-flight + orphaned-run recovery gate. Non-null in production (Spring injects it);
     * null in the older test constructors, where the legacy "always create a new run" path is kept so
     * existing unit tests are unaffected. See {@link SyncRunGate}.
     */
    private final SyncRunGate runGate;
    /**
     * Optional (Self-Pilot Runtime v1): turns an unambiguous auth failure into RECONNECT_REQUIRED +
     * paused schedules + an AUTH_EXPIRED alert. Null in the older test constructors (the run then
     * simply ends FAILED as before).
     */
    private final SellerAccountReauthService reauth;

    /** Full production wiring (Spring). Every optional collaborator is present here. */
    @Autowired
    public SyncRunExecutor(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                           ConnectorRegistry registry, IngestionService ingestionService,
                           ChannelOrderIngestionService orderIngestionService,
                           SyncJobRepository syncJobs, SyncCursorRepository cursors,
                           ChannelConnectionStatusRepository connectionStatus,
                           Cafe24ReviewIssueBridge reviewIssueBridge,
                           Cafe24ReviewPromotionReconciler reviewIssueReconciler,
                           NaverConnectionLifecycle naverLifecycle,
                           CoupangConnectionLifecycle coupangLifecycle,
                           SyncRunGate runGate,
                           SellerAccountReauthService reauth) {
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.registry = registry;
        this.ingestionService = ingestionService;
        this.orderIngestionService = orderIngestionService;
        this.syncJobs = syncJobs;
        this.cursors = cursors;
        this.connectionStatus = connectionStatus;
        this.reviewIssueBridge = reviewIssueBridge;
        this.reviewIssueReconciler = reviewIssueReconciler;
        this.naverLifecycle = naverLifecycle;
        this.coupangLifecycle = coupangLifecycle;
        this.runGate = runGate;
        this.reauth = reauth;
    }

    /** Pre-Self-Pilot signature (no reauth service) — kept for the tests that construct it directly. */
    public SyncRunExecutor(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                           ConnectorRegistry registry, IngestionService ingestionService,
                           ChannelOrderIngestionService orderIngestionService,
                           SyncJobRepository syncJobs, SyncCursorRepository cursors,
                           ChannelConnectionStatusRepository connectionStatus,
                           Cafe24ReviewIssueBridge reviewIssueBridge,
                           Cafe24ReviewPromotionReconciler reviewIssueReconciler,
                           NaverConnectionLifecycle naverLifecycle,
                           CoupangConnectionLifecycle coupangLifecycle,
                           SyncRunGate runGate) {
        this(sellerAccounts, channels, registry, ingestionService, orderIngestionService, syncJobs, cursors,
                connectionStatus, reviewIssueBridge, reviewIssueReconciler, naverLifecycle, coupangLifecycle,
                runGate, null);
    }

    /**
     * Bridge-only convenience constructor (no run gate) — delegates with a null gate, keeping the
     * legacy single-run behavior for callers/tests that do not exercise single-flight.
     */
    public SyncRunExecutor(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                           ConnectorRegistry registry, IngestionService ingestionService,
                           ChannelOrderIngestionService orderIngestionService,
                           SyncJobRepository syncJobs, SyncCursorRepository cursors,
                           ChannelConnectionStatusRepository connectionStatus,
                           Cafe24ReviewIssueBridge reviewIssueBridge,
                           Cafe24ReviewPromotionReconciler reviewIssueReconciler,
                           NaverConnectionLifecycle naverLifecycle) {
        this(sellerAccounts, channels, registry, ingestionService, orderIngestionService,
                syncJobs, cursors, connectionStatus, reviewIssueBridge, reviewIssueReconciler,
                naverLifecycle, null, null);
    }

    /**
     * Bridge-less constructor for tests (and any caller) that do not exercise the Cafe24
     * review→issue-memory bridge/reconciler, the NAVER connection lifecycle, or the single-flight
     * gate. Delegates with nulls, which the ingest and post-run paths null-guard. Production uses the
     * {@code @Autowired} constructor above.
     */
    public SyncRunExecutor(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                           ConnectorRegistry registry, IngestionService ingestionService,
                           ChannelOrderIngestionService orderIngestionService,
                           SyncJobRepository syncJobs, SyncCursorRepository cursors,
                           ChannelConnectionStatusRepository connectionStatus) {
        this(sellerAccounts, channels, registry, ingestionService, orderIngestionService,
                syncJobs, cursors, connectionStatus, null, null, null, null, null);
    }

    /**
     * Execute one incremental collection run. {@code trigger} is SCHEDULED /
     * MANUAL / RETRY. Returns the finished {@link SyncJob} (SUCCESS / PARTIAL /
     * FAILED).
     */
    public SyncJob execute(UUID orgId, UUID sellerAccountId, DataType dataType, String trigger) {
        return execute(orgId, sellerAccountId, dataType, trigger, null);
    }

    /**
     * Execute one collection run. When {@code backfill} is non-null the run is a
     * bounded date-window backfill: the connector translates the window into the
     * starting cursor ({@link PullConnector#backfillCursor}); a connector that
     * cannot serve a windowed backfill fails closed as a config error, never an
     * unbounded sweep. Both {@code sync_jobs} and {@code sync_cursors} are written
     * only here — the seed and every advance share the one runtime path.
     */
    public SyncJob execute(UUID orgId, UUID sellerAccountId, DataType dataType, String trigger,
                           BackfillWindow backfill) {
        SellerAccount account = sellerAccounts.findById(sellerAccountId)
                .filter(a -> a.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        String channelCode = channel.getCode();

        Optional<PullConnector> resolved = registry.resolvePullConnector(channelCode);
        if (resolved.isEmpty()) {
            // Config issue, not a connectivity failure — record FAILED but don't touch health.
            return recordConfigFailure(orgId, account, dataType, trigger, null,
                    "채널에 자동 수집 커넥터가 없습니다.");
        }
        PullConnector connector = resolved.get();
        if (!connector.capabilities(channelCode).supports(dataType)) {
            return recordConfigFailure(orgId, account, dataType, trigger, connector.kind(),
                    label(dataType) + " 데이터 유형은 이 채널에서 지원되지 않습니다.");
        }

        String backfillSeed = null;
        if (backfill != null) {
            Optional<String> seed = connector.backfillCursor(dataType, backfill.startDate(), backfill.endDate());
            if (seed.isEmpty()) {
                // Fail closed: a connector with no windowed-backfill seed must not
                // fall through to an unbounded sweep of the whole board.
                return recordConfigFailure(orgId, account, dataType, trigger, connector.kind(),
                        label(dataType) + " 데이터 유형은 이 채널에서 기간 지정 백필을 지원하지 않습니다.");
            }
            backfillSeed = seed.get();
        }

        // Single-flight admission: one run per (account, data type) at a time. The gate reclaims an
        // orphaned RUNNING run and, if a fresh one is already in flight, returns it instead of starting
        // a duplicate (the long pagination below never runs twice for the same account+type). Older test
        // constructors pass a null gate and keep the legacy "always start a new run" behavior.
        SyncJob job;
        if (runGate != null) {
            SyncRunGate.RunStart start = runGate.beginRunOrCoalesce(account.getId(), dataType,
                    () -> startJob(orgId, account, dataType, trigger, connector.kind()));
            if (start.coalesced()) {
                // A run for this (account, data type) is already in flight — return it, do not re-run.
                return start.job();
            }
            job = start.job();
        } else {
            job = startJob(orgId, account, dataType, trigger, connector.kind());
        }
        SyncJob finished = runPages(job, connector, orgId, account, channel, dataType, backfillSeed);
        reconcileCafe24ReviewIssueMemory(finished, orgId, account, channel, dataType, backfill);
        return finished;
    }

    /**
     * After a <b>successful, windowed Cafe24 board-4 REVIEW backfill</b>, promote the full stored
     * window into Issue-Memory (bounded to this account + window, no Cafe24 API call) — independent of
     * how many rows ingestion inserted vs. skipped, so an already-stored review is never permanently
     * missing from the issue pipeline. Best-effort: a reconcile failure never fails the sync (the run
     * already succeeded). Skips non-Cafe24 / non-REVIEW / non-windowed / non-SUCCESS runs.
     */
    private void reconcileCafe24ReviewIssueMemory(SyncJob job, UUID orgId, SellerAccount account,
                                                  Channel channel, DataType dataType,
                                                  BackfillWindow backfill) {
        if (reviewIssueReconciler == null || backfill == null || dataType != DataType.REVIEW
                || !"CAFE24".equals(channel.getCode()) || !"SUCCESS".equals(job.getStatus())) {
            return;
        }
        try {
            reviewIssueReconciler.reconcile(
                    orgId, account.getId(), backfill.startDate(), backfill.endDate());
        } catch (RuntimeException reconcileFailure) {
            log.warn("Cafe24 REVIEW 이슈메모리 소급 reconcile 실패(무시하고 계속): {}",
                    reconcileFailure.getClass().getSimpleName());
        }
    }

    private SyncJob runPages(SyncJob job, PullConnector connector, UUID orgId,
                             SellerAccount account, Channel channel, DataType dataType,
                             String backfillSeed) {
        UUID channelId = channel.getId();
        SyncCursor cursor = loadOrCreateCursor(orgId, account.getId(), dataType);
        if (backfillSeed != null) {
            // A backfill re-seeds the window at offset 0; this seed write and every
            // subsequent advance below go through the one sync_cursors path.
            cursor.setCursorValue(backfillSeed);
            cursors.save(cursor);
        }
        String cursorValue = cursor.getCursorValue();

        int success = 0;
        int skipped = 0;
        int failed = 0;
        boolean rateLimited = false;
        Integer retryAfterSeconds = null;
        boolean errored = false;
        // Self-Pilot v1 classification of the failure that ended the loop (null / false = ordinary).
        String authFailure = null;
        boolean approvalMissing = false;
        String firstError = null;
        boolean hasMore = true;
        int guard = 0;

        try {
            while (hasMore && guard++ < MAX_PAGES) {
                FetchPage page = connector.fetch(new FetchRequest(
                        orgId, account.getId(), channel.getCode(), dataType, cursorValue, PAGE_LIMIT));

                if (page.rateLimited()) {
                    // Stop paging and keep the connector's retry-after hint; the
                    // scheduled runner (Slice 4) decides when to come back.
                    rateLimited = true;
                    retryAfterSeconds = page.retryAfterSeconds();
                    break;
                }

                IngestOutcome outcome = ingestPage(page, orgId, channelId, account.getId());
                success += outcome.success();
                skipped += outcome.skipped();
                failed += outcome.failed();
                if (firstError == null && !outcome.errors().isEmpty()) {
                    firstError = outcome.errors().get(0).message();
                }

                // Advance + persist the cursor only AFTER this page's records are persisted,
                // so a later-page failure keeps the progress already made.
                cursor.setCursorValue(page.nextCursorValue());
                cursors.save(cursor);
                cursorValue = cursor.getCursorValue();

                hasMore = page.hasMore();
            }
        } catch (Exception e) {
            // A mid-run failure must not erase earlier landed pages: keep the
            // accumulated counts so the run is PARTIAL (not a zero-row FAILED).
            errored = true;
            if (firstError == null) {
                firstError = "수집 실패: " + e.getMessage();
            }
            // Self-Pilot Runtime v1: two failures are NOT connectivity and must not read as one.
            //  - an unambiguous auth verdict → the account needs the seller (RECONNECT_REQUIRED task);
            //  - a missing live/read approval → a configuration state, not a channel that failed.
            authFailure = classifyAuthFailure(e);
            approvalMissing = e instanceof CoupangLiveApprovalRequiredException;
        }

        if (hasMore && !rateLimited && !errored) {
            // The page guard, not completion, ended the loop — a silently
            // truncated collection must not read as a clean run.
            errored = true;
            if (firstError == null) {
                firstError = "수집이 실행당 페이지 한도(" + MAX_PAGES + ")에 도달해 중단되었습니다.";
            }
        }

        String status = resolveStatus(success, skipped, failed, rateLimited, errored);
        String errorMessage = firstError;
        if (rateLimited && errorMessage == null) {
            errorMessage = "수집이 속도 제한으로 중단되었습니다.";
        }
        if (rateLimited && retryAfterSeconds != null) {
            // Record the hint as an earliest-retry timestamp for the scheduler.
            job.setNextRetryAt(Instant.now().plusSeconds(retryAfterSeconds));
        }
        finishJob(job, success, skipped, failed, status, errorMessage, rateLimited);
        if (authFailure != null) {
            // Health is owned by the reauth path: NEEDS_REAUTH + paused schedules + AUTH_EXPIRED alert,
            // never a consecutive-failure tick that would later masquerade as DEGRADED. Without the
            // service (older test wiring) the run still ends FAILED and health records the failure.
            if (reauth != null) {
                reauth.markReconnectRequired(orgId, account.getId(), authFailure);
            } else {
                updateHealth(account, status, errorMessage, rateLimited);
            }
        } else if (approvalMissing) {
            // Recorded on the run (errorMessage names the env), not on connection health: nothing about
            // the channel or the credential failed. Fast retries cannot fix configuration.
            log.warn("Collection refused for lack of a live/read approval (account {}, {})", account.getId(), dataType);
        } else {
            updateHealth(account, status, errorMessage, rateLimited);
        }
        // A collected first ORDER_SUMMARY sync is the second half of the NAVER connect gate: it advances
        // an already-verified (PREPARING) account to CONNECTED. Only a run that collected rows counts —
        // an ordinary FAILED sync leaves the status untouched — and only for NAVER (the lifecycle no-ops
        // for any other channel). finishJob committed this run's status above, so the transition reads a
        // consistent record.
        boolean collected = "SUCCESS".equals(status) || "PARTIAL".equals(status);
        if (naverLifecycle != null && dataType == DataType.ORDER_SUMMARY && collected
                && NaverApiConnector.CHANNEL_CODE.equals(channel.getCode())) {
            naverLifecycle.onOrderSyncCollected(orgId, account.getId());
        }
        // Symmetric Coupang two-signal completion: a first collected ORDER_SUMMARY sync advances an
        // already-verified (PREPARING) Coupang account to CONNECTED. Guarded to Coupang only.
        if (coupangLifecycle != null && dataType == DataType.ORDER_SUMMARY && collected
                && CoupangApiConnector.CHANNEL_CODE.equals(channel.getCode())) {
            coupangLifecycle.onOrderSyncCollected(orgId, account.getId());
        }
        return job;
    }

    /** Route a page to the right ingestion method by data type — no unsafe casts. */
    private IngestOutcome ingestPage(FetchPage page, UUID orgId, UUID channelId, UUID sellerAccountId) {
        // Cafe24 community articles (REVIEW/INQUIRY boards) are a richer, upsertable
        // asset stored in their own table — routed by the canonical record type the
        // connector emits, not by data type. Dormant until the Cafe24 community
        // article connector lands (a later PR); existing connectors never emit these.
        if (isCommunityArticlePage(page)) {
            List<CanonicalCommunityArticle> articles = typed(page, CanonicalCommunityArticle.class);
            IngestOutcome outcome = ingestionService.ingestCommunityArticles(
                    orgId, channelId, sellerAccountId, articles);
            if (reviewIssueBridge != null) {
                // Promote public board-4 REVIEW articles into the canonical review store so they reach
                // the existing Issue-Memory pipeline (community articles are otherwise not analyzed).
                // Idempotent; secret reviews never reach here (excluded pre-storage). Best-effort: the
                // articles are already stored, so a bridge failure must never wedge the sync or its
                // cursor. Sanitized log — never an article id/content.
                try {
                    reviewIssueBridge.bridgePublicReviews(orgId, channelId, sellerAccountId, articles);
                } catch (RuntimeException bridgeFailure) {
                    log.warn("Cafe24 REVIEW→이슈메모리 브리지 실패(무시하고 계속): {}",
                            bridgeFailure.getClass().getSimpleName());
                }
            }
            return outcome;
        }
        return switch (page.dataType()) {
            case REVIEW -> ingestionService.ingestReviews(orgId, channelId, typed(page, CanonicalReview.class));
            case INQUIRY -> ingestionService.ingestInquiries(orgId, channelId, sellerAccountId,
                    typed(page, CanonicalInquiry.class));
            case ORDER_SUMMARY -> ingestOrderPage(page, orgId, channelId, sellerAccountId);
            // No canonical type yet; the mock returns empty pages. Routing is deferred.
            case PRODUCT, SALES -> new IngestOutcome(0, 0, 0, List.of(), List.of());
        };
    }

    /**
     * The daily summary always lands (the aggregate table is unchanged). For a per-order channel
     * (the page also carries per-order records) the per-order rows are the counted unit — the daily
     * upsert is a derived mirror; for an aggregate-only channel (no per-order records) the daily rows
     * remain the counted unit, exactly as before. A 1-order run therefore still reports one row.
     */
    private IngestOutcome ingestOrderPage(FetchPage page, UUID orgId, UUID channelId, UUID sellerAccountId) {
        IngestOutcome daily = ingestionService.ingestOrderSummaries(
                orgId, channelId, typed(page, CanonicalOrderSummary.class));
        List<CanonicalOrder> perOrder = ordersTyped(page);
        if (perOrder.isEmpty()) {
            return daily;
        }
        IngestOutcome orders = orderIngestionService.ingest(orgId, channelId, sellerAccountId, perOrder);
        if (daily.failed() == 0) {
            return orders;
        }
        // Per-order rows are the counted unit, but a daily-summary failure must not vanish — fold its
        // failed rows and errors in so the run reflects them (PARTIAL/FAILED) rather than a false SUCCESS.
        List<RowError> errors = new ArrayList<>(orders.errors());
        errors.addAll(daily.errors());
        return new IngestOutcome(orders.success(), orders.skipped(), orders.failed() + daily.failed(),
                errors, orders.insertedIds());
    }

    private static List<CanonicalOrder> ordersTyped(FetchPage page) {
        return page.orders().stream().map(CanonicalOrder.class::cast).toList();
    }

    private static boolean isCommunityArticlePage(FetchPage page) {
        return !page.records().isEmpty() && page.records().get(0) instanceof CanonicalCommunityArticle;
    }

    private static <T> List<T> typed(FetchPage page, Class<T> type) {
        return page.records().stream().map(type::cast).toList();
    }

    /**
     * The sanitized reason when {@code e} is an unambiguous authentication verdict, else null.
     * Recognised: {@link ConnectorAuthException} (Coupang 401 / NAVER token refusal) and a Cafe24
     * {@code invalid_grant} on refresh (the stored refresh token was revoked; the authorizer has already
     * retried once against a possibly-rotated token before letting it out).
     */
    static String classifyAuthFailure(Exception e) {
        if (e instanceof ConnectorAuthException auth) {
            return auth.getMessage();
        }
        if (e instanceof Cafe24OAuthException oauth
                && oauth.kind() == Cafe24OAuthException.Kind.INVALID_GRANT) {
            return "카페24 인증이 더 이상 유효하지 않습니다 (REFRESH_TOKEN_REVOKED). 채널을 다시 연결해 주세요.";
        }
        return null;
    }

    private String resolveStatus(int success, int skipped, int failed, boolean rateLimited, boolean errored) {
        // Any abnormal condition (mid-run error, rate limit, or row failures) is
        // PARTIAL when some data already landed, otherwise a clean FAILED.
        if (errored || rateLimited || failed > 0) {
            return (success + skipped > 0) ? "PARTIAL" : "FAILED";
        }
        // No abnormality: successes and/or idempotent dedup skips (incl. an empty run) are SUCCESS.
        return "SUCCESS";
    }

    private SyncCursor loadOrCreateCursor(UUID orgId, UUID sellerAccountId, DataType dataType) {
        return cursors
                .findByOrgIdAndSellerAccountIdAndDataTypeAndCursorKey(orgId, sellerAccountId, dataType.name(), CURSOR_KEY)
                .orElseGet(() -> {
                    SyncCursor c = new SyncCursor();
                    c.setOrgId(orgId);
                    c.setSellerAccountId(sellerAccountId);
                    c.setDataType(dataType.name());
                    c.setCursorKey(CURSOR_KEY);
                    return c;
                });
    }

    private SyncJob startJob(UUID orgId, SellerAccount account, DataType dataType, String trigger, String kind) {
        SyncJob job = new SyncJob();
        job.setOrgId(orgId);
        job.setChannelId(account.getChannelId());
        job.setSellerAccountId(account.getId());
        job.setDataType(dataType.name());
        job.setJobType(kind != null ? kind : "UNKNOWN");
        job.setTrigger(trigger);
        job.setAttempt(1);
        job.setStatus("RUNNING");
        job.setStartedAt(Instant.now());
        return syncJobs.save(job);
    }

    private void finishJob(SyncJob job, int success, int skipped, int failed, String status,
                           String errorMessage, boolean rateLimited) {
        job.setSuccessRows(success);
        job.setSkippedRows(skipped);
        job.setFailedRows(failed);
        job.setTotalRows(success + skipped + failed);
        job.setStatus(status);
        job.setErrorMessage(errorMessage);
        job.setRateLimited(rateLimited);
        job.setFinishedAt(Instant.now());
        syncJobs.save(job);
    }

    private SyncJob recordConfigFailure(UUID orgId, SellerAccount account, DataType dataType,
                                        String trigger, String kind, String message) {
        SyncJob job = startJob(orgId, account, dataType, trigger, kind);
        finishJob(job, 0, 0, 0, "FAILED", message, false);
        return job;
    }

    /** Update connection health + last-synced. Success/partial → CONNECTED + reset failures. */
    private void updateHealth(SellerAccount account, String status, String errorMessage, boolean rateLimited) {
        boolean collected = "SUCCESS".equals(status) || "PARTIAL".equals(status);
        Instant now = Instant.now();

        ChannelConnectionStatus health = connectionStatus.findBySellerAccountId(account.getId())
                .orElseGet(() -> {
                    ChannelConnectionStatus c = new ChannelConnectionStatus();
                    c.setOrgId(account.getOrgId());
                    c.setSellerAccountId(account.getId());
                    c.setState("CONNECTED");
                    return c;
                });

        if (collected) {
            health.setState("CONNECTED");
            health.setLastSuccessAt(now);
            health.setConsecutiveFailures(0);
            health.setLastError(null);
            account.setLastSyncedAt(now);
            sellerAccounts.save(account);
        } else if (rateLimited) {
            // Throttling on a healthy connection, not a connectivity failure — it
            // must never count toward DEGRADED escalation. Record the reason only.
            health.setLastError(errorMessage);
        } else {
            health.setConsecutiveFailures(health.getConsecutiveFailures() + 1);
            health.setLastError(errorMessage);
            // DEGRADED escalation + failure alerts are the scheduler's call (Slice 4).
        }
        connectionStatus.save(health);
    }

    private static String label(DataType dataType) {
        return dataType.name();
    }
}
