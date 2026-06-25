package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncCursor;
import com.sellerops.sync.SyncCursorRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import java.time.Instant;
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

    /** Single cursor per (account, data type); the connector owns the value's meaning. */
    static final String CURSOR_KEY = "primary";
    private static final int PAGE_LIMIT = 50;
    private static final int MAX_PAGES = 10_000;

    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final ConnectorRegistry registry;
    private final IngestionService ingestionService;
    private final SyncJobRepository syncJobs;
    private final SyncCursorRepository cursors;
    private final ChannelConnectionStatusRepository connectionStatus;

    public SyncRunExecutor(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                           ConnectorRegistry registry, IngestionService ingestionService,
                           SyncJobRepository syncJobs, SyncCursorRepository cursors,
                           ChannelConnectionStatusRepository connectionStatus) {
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.registry = registry;
        this.ingestionService = ingestionService;
        this.syncJobs = syncJobs;
        this.cursors = cursors;
        this.connectionStatus = connectionStatus;
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

        SyncJob job = startJob(orgId, account, dataType, trigger, connector.kind());
        return runPages(job, connector, orgId, account, channel, dataType, backfillSeed);
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
        updateHealth(account, status, errorMessage, rateLimited);
        return job;
    }

    /** Route a page to the right ingestion method by data type — no unsafe casts. */
    private IngestOutcome ingestPage(FetchPage page, UUID orgId, UUID channelId, UUID sellerAccountId) {
        // Cafe24 community articles (REVIEW/INQUIRY boards) are a richer, upsertable
        // asset stored in their own table — routed by the canonical record type the
        // connector emits, not by data type. Dormant until the Cafe24 community
        // article connector lands (a later PR); existing connectors never emit these.
        if (isCommunityArticlePage(page)) {
            return ingestionService.ingestCommunityArticles(orgId, channelId, sellerAccountId,
                    typed(page, CanonicalCommunityArticle.class));
        }
        return switch (page.dataType()) {
            case REVIEW -> ingestionService.ingestReviews(orgId, channelId, typed(page, CanonicalReview.class));
            case INQUIRY -> ingestionService.ingestInquiries(orgId, channelId, typed(page, CanonicalInquiry.class));
            case ORDER_SUMMARY -> ingestionService.ingestOrderSummaries(orgId, channelId, typed(page, CanonicalOrderSummary.class));
            // No canonical type yet; the mock returns empty pages. Routing is deferred.
            case PRODUCT, SALES -> new IngestOutcome(0, 0, 0, List.of(), List.of());
        };
    }

    private static boolean isCommunityArticlePage(FetchPage page) {
        return !page.records().isEmpty() && page.records().get(0) instanceof CanonicalCommunityArticle;
    }

    private static <T> List<T> typed(FetchPage page, Class<T> type) {
        return page.records().stream().map(type::cast).toList();
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
