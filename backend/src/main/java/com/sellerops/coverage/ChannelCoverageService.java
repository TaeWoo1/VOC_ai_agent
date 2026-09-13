package com.sellerops.coverage;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.ConnectorCapability;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewimport.ReviewImportSegmentAttemptRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Per (channel × data type): can this channel still tell us what is happening, and what do we hold?
 *
 * <p><b>This service composes; it does not collect.</b> Every input is a row this backend already has
 * — the declared capability registry, the org's seller accounts, its routine schedules, its sync run
 * history, and the stored rows themselves. No channel is contacted, and nothing here can start a run.
 *
 * <p><b>Support comes from the DECLARED registry, not from local wiring.</b> That distinction is the
 * whole reason this class exists. A connector's live {@code capabilities()} answers "is this
 * deployment wired for it right now", and on 2026-08-24 that answer flipped NAVER 문의 to
 * {@code supported=false} the moment two feature flags were lowered — which a screen reads as
 * "네이버는 문의를 지원하지 않습니다", a sentence disproven by 18 REAL rows collected that morning.
 * Local wiring is a reachability fact and belongs in {@link ChannelDataState#BLOCKED} /
 * {@link ChannelDataState#OBSERVED_FRESHNESS_UNPROVEN}; it is not what the word "지원" means.
 */
@Service
public class ChannelCoverageService implements OrderStoreFreshness {

    /** The operator-facing types, in the order the screens use. PRODUCT/SALES are background knowledge. */
    static final List<String> DATA_TYPES = List.of("INQUIRY", "REVIEW", "ORDER_SUMMARY");

    /**
     * How recently a routine run must have succeeded for its data to be called fresh.
     *
     * <p><b>Derived, not invented.</b> A schedule declares its own cadence; "fresh" is simply "the last
     * success is inside a few of this schedule's own periods". The multiplier is what absorbs one
     * missed tick and a slow run without calling a two-day silence current. A schedule with no
     * interval (cron, or none) falls back to {@link #DEFAULT_FRESH_PERIODS} × one hour, the floor the
     * self-pilot reconciler itself uses.
     */
    static final int FRESH_PERIODS = 3;
    static final int DEFAULT_INTERVAL_MINUTES = 60;
    static final int DEFAULT_FRESH_PERIODS = FRESH_PERIODS;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final ChannelRepository channels;
    private final ConnectorCapabilityRepository capabilities;
    private final SellerAccountRepository accounts;
    private final SyncScheduleRepository schedules;
    private final SyncJobRepository syncJobs;
    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final OrderDailySummaryRepository orders;
    private final ReviewImportSegmentAttemptRepository acquisitions;

    public ChannelCoverageService(ChannelRepository channels, ConnectorCapabilityRepository capabilities,
                                  SellerAccountRepository accounts, SyncScheduleRepository schedules,
                                  SyncJobRepository syncJobs, InquiryRepository inquiries,
                                  ReviewRepository reviews, OrderDailySummaryRepository orders,
                                  ReviewImportSegmentAttemptRepository acquisitions) {
        this.channels = channels;
        this.capabilities = capabilities;
        this.accounts = accounts;
        this.schedules = schedules;
        this.syncJobs = syncJobs;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.orders = orders;
        this.acquisitions = acquisitions;
    }

    /**
     * One row per (channel this org could sell on × operator data type).
     *
     * <p><b>Channels with no account are present, not absent.</b> "쿠팡에 문의가 몇 건?" must be
     * answerable with "쿠팡은 연결되어 있지 않습니다", and an omitted row would instead be read as a
     * zero by anything that counts what it was given.
     */
    @Transactional(readOnly = true)
    public List<ChannelCoverageRow> coverage(UUID orgId, List<String> visibleChannelCodes) {
        Map<UUID, Channel> byId = new LinkedHashMap<>();
        for (Channel channel : channels.findAll()) {
            if (visibleChannelCodes.contains(channel.getCode())) {
                byId.put(channel.getId(), channel);
            }
        }

        Map<UUID, SellerAccount> accountByChannel = new HashMap<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            // An org may hold more than one account on a channel; the CONNECTED one is the one that
            // answers for freshness. Without this the multi-account case would pick arbitrarily.
            accountByChannel.merge(account.getChannelId(), account,
                    (a, b) -> b.getConnectionStatus() == ChannelStatus.CONNECTED ? b : a);
        }

        Map<String, Map<UUID, long[]>> counts = new HashMap<>();
        Map<String, Map<UUID, Instant>> newest = new HashMap<>();
        // [stored, unanswered] per channel. The two halves answer different questions and are read
        // from different queries on purpose (Agent Command Center v1 §1-A): "how many rows do we
        // hold" decides the freshness verdict and must see everything this org holds, while
        // "how many are waiting" is an operational obligation and is REAL only. Overwriting the
        // second half here rather than narrowing countActiveByChannel keeps a channel whose only
        // rows are seeded from flipping its collection state.
        Map<UUID, long[]> inquiryCounts = pairs(inquiries.countActiveByChannel(orgId));
        Map<UUID, Long> waiting = new HashMap<>();
        for (Object[] row : inquiries.countUnansweredOperationalByChannel(orgId)) {
            waiting.put((UUID) row[0], ((Number) row[1]).longValue());
        }
        for (Map.Entry<UUID, long[]> entry : inquiryCounts.entrySet()) {
            entry.getValue()[1] = waiting.getOrDefault(entry.getKey(), 0L);
        }
        counts.put("INQUIRY", inquiryCounts);
        newest.put("INQUIRY", instants(inquiries.newestReceivedAtByChannel(orgId)));
        counts.put("REVIEW", pairs(reviews.countByChannel(orgId)));
        newest.put("REVIEW", instants(reviews.newestReceivedAtByChannel(orgId)));
        Map<UUID, long[]> orderCounts = new HashMap<>();
        Map<UUID, Instant> orderNewest = new HashMap<>();
        for (Object[] row : orders.countByChannel(orgId)) {
            UUID channelId = (UUID) row[0];
            orderCounts.put(channelId, new long[] {((Number) row[1]).longValue(), -1L});
            if (row[2] != null) {
                orderNewest.put(channelId, ((LocalDate) row[2]).atStartOfDay(KST).toInstant());
            }
        }
        counts.put("ORDER_SUMMARY", orderCounts);
        newest.put("ORDER_SUMMARY", orderNewest);

        List<ChannelCoverageRow> out = new ArrayList<>();
        Instant now = Instant.now();
        for (Channel channel : byId.values()) {
            SellerAccount account = accountByChannel.get(channel.getId());
            for (String dataType : DATA_TYPES) {
                out.add(row(orgId, channel, account, dataType, counts, newest, now));
            }
        }
        return out;
    }

    /**
     * The freshness verdict for one channel's PER-ORDER store, for one seller connection.
     *
     * <p><b>Why this is not the {@code ORDER_SUMMARY} row.</b> They answer different questions and
     * currently disagree. Cafe24's {@code ORDER_SUMMARY} routine succeeds on schedule and writes a
     * daily count and a daily amount — an aggregate with no order identity in it — while
     * {@code channel_orders} holds zero Cafe24 rows. A reader that took the summary row's
     * {@code OBSERVED_FRESH} as permission to speak about one Cafe24 order would be citing freshness
     * earned by a number that cannot name a single order.
     *
     * <p>So the same derivation runs — support, then connection, then freshness, in that order and
     * for the same reasons — over the row count of the per-order store instead.
     */
    @Override
    @Transactional(readOnly = true)
    public ChannelDataState perOrderState(UUID orgId, String channelCode, UUID sellerAccountId,
                                          long rowsHeld) {
        ConnectorCapability declared = capabilities.findByChannelCode(channelCode).stream()
                .filter(c -> "ORDER_SUMMARY".equals(c.getDataType()))
                .findFirst()
                .orElse(null);
        Support support = declared == null ? Support.UNDECLARED
                : (declared.isSupported() ? Support.SUPPORTED : Support.UNSUPPORTED);
        SellerAccount account = sellerAccountId == null ? null
                : accounts.findById(sellerAccountId).filter(a -> orgId.equals(a.getOrgId())).orElse(null);
        boolean connected = account != null && account.getConnectionStatus() == ChannelStatus.CONNECTED;
        SyncSchedule schedule = account == null ? null
                : schedules.findByOrgIdAndSellerAccountIdAndDataType(orgId, account.getId(), "ORDER_SUMMARY")
                        .orElse(null);
        boolean routineEnabled = schedule != null && schedule.isEnabled();
        Instant lastSuccess = account == null ? null
                : lastSuccessfulSync(orgId, account.getChannelId(), "ORDER_SUMMARY");
        return stateOf(support, connected, account, routineEnabled, lastSuccess, schedule, rowsHeld,
                Instant.now());
    }

    private ChannelCoverageRow row(UUID orgId, Channel channel, SellerAccount account, String dataType,
                                   Map<String, Map<UUID, long[]>> counts,
                                   Map<String, Map<UUID, Instant>> newest, Instant now) {
        ConnectorCapability declared = capabilities.findByChannelCode(channel.getCode()).stream()
                .filter(c -> dataType.equals(c.getDataType()))
                .findFirst()
                .orElse(null);
        Support support = declared == null ? Support.UNDECLARED
                : (declared.isSupported() ? Support.SUPPORTED : Support.UNSUPPORTED);
        String verification = declared == null ? null : declared.getVerificationStatus();

        boolean connected = account != null && account.getConnectionStatus() == ChannelStatus.CONNECTED;
        String connectionStatus = account == null ? null : account.getConnectionStatus().name();

        SyncSchedule schedule = account == null ? null
                : schedules.findByOrgIdAndSellerAccountIdAndDataType(orgId, account.getId(), dataType)
                        .orElse(null);
        boolean routineEnabled = schedule != null && schedule.isEnabled();
        String pausedBy = schedule == null || schedule.isEnabled() ? null
                // The one bit that says who stopped it. A reason means the runtime paused it and a
                // reconnect will resume it; no reason means a person did, and nothing will.
                : (schedule.getPausedReason() == null ? "OPERATOR" : "SYSTEM");

        Instant lastSuccess = lastSuccessfulSync(orgId, channel.getId(), dataType);
        long[] count = counts.get(dataType).getOrDefault(channel.getId(), new long[] {0L, 0L});
        Long open = count[1] < 0 ? null : count[1];
        Instant newestObserved = newest.get(dataType).get(channel.getId());

        ChannelDataState state = stateOf(support, connected, account, routineEnabled,
                lastSuccess, schedule, count[0], now);
        return new ChannelCoverageRow(channel.getCode(), channel.getNameKo(), dataType, state,
                support != Support.UNSUPPORTED, verification, connected, connectionStatus,
                routineEnabled, pausedBy, lastSuccess, count[0], open, newestObserved);
    }

    /**
     * What the declared registry says about a channel × type — and the third value that matters.
     *
     * <p><b>{@link #UNDECLARED} is not {@link #UNSUPPORTED}.</b> A missing row means nobody wrote the
     * capability down; it is not a statement that the channel cannot do it. Collapsing the two is not
     * hypothetical: Cafe24 had no rows in this table at all, and the first live read answered
     * {@code CAFE24 INQUIRY NOT_SUPPORTED} over 113 stored inquiries with 69 of them unanswered.
     */
    enum Support { SUPPORTED, UNSUPPORTED, UNDECLARED }

    /**
     * The derivation, in one place and in one order.
     *
     * <p>The order is the point. Support is a fact about the CHANNEL and is asked first, so a
     * disconnected account can never make a supported channel read as unsupported. Connection is
     * asked next, so a channel nobody connected never reports a zero. Only a channel that is both
     * supported and connected is even eligible for a freshness verdict, and only a fresh one may
     * report {@link ChannelDataState#ZERO} — which is the single value that lets an answer say
     * "없습니다".
     *
     * <p><b>Three refusals are built in, and two of them are the same refusal.</b> An UNDECLARED capability never produces
     * {@code NOT_SUPPORTED} — it falls through and is answered by connection and freshness like any
     * other. And an UNSUPPORTED capability we nonetheless hold rows for is NOT reported as
     * "제공하지 않습니다" either: NAVER has no review API and this org holds 4,340 NAVER reviews,
     * acquired through an approved export path, and a sentence that erases them to state a true fact
     * about the API is a worse answer than the one it replaced. The third is the connection branch
     * saying the same thing about the same rows: an org that uploaded its reviews holds them whether
     * or not it ever connected anything.
     */
    static ChannelDataState stateOf(Support support, boolean connected, SellerAccount account,
                                    boolean routineEnabled, Instant lastSuccess, SyncSchedule schedule,
                                    long rows, Instant now) {
        if (support == Support.UNSUPPORTED) {
            return rows > 0 ? ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN
                    : ChannelDataState.NOT_SUPPORTED;
        }
        if (account == null) {
            // The SAME refusal as the branch above, one step later, and it was missing. Rows can reach
            // this org without a connection at all — `POST /api/uploads` is addressed by channel and
            // takes no account, so every manual CSV and every seller-center export lands here. Measured
            // 2026-09-13: an org holding two uploaded Cafe24 reviews reported `REVIEW NOT_CONNECTED`,
            // and the Home read that as «this seller has nothing» and showed them the first-use screen.
            // A sentence that erases rows we hold to state a true fact about connection is the worse
            // answer, which is exactly what the paragraph above already says about capability.
            return rows > 0 ? ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN
                    : ChannelDataState.NOT_CONNECTED;
        }
        if (!connected) {
            return ChannelDataState.BLOCKED;
        }
        boolean fresh = routineEnabled && isRecent(lastSuccess, schedule, now);
        if (!fresh) {
            // Rows we hold are still real; what we cannot say is that they are today's picture. With no
            // rows at all this is NOT a zero — it is a channel we have never successfully read.
            return ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN;
        }
        return rows > 0 ? ChannelDataState.OBSERVED_FRESH : ChannelDataState.ZERO;
    }

    private static boolean isRecent(Instant lastSuccess, SyncSchedule schedule, Instant now) {
        if (lastSuccess == null) {
            return false;
        }
        int minutes = schedule == null || schedule.getIntervalMinutes() == null
                ? DEFAULT_INTERVAL_MINUTES : schedule.getIntervalMinutes();
        return lastSuccess.isAfter(now.minusSeconds((long) minutes * 60 * FRESH_PERIODS));
    }

    /**
     * When this channel × type was last observed successfully — from EITHER record that can prove it.
     *
     * <p><b>Two paths reach the store and only one of them was being read.</b> A connector pull writes a
     * sync run stamped with the account and the data type; a guided acquisition writes an upload-shaped run
     * plus the {@code ReviewImportSegmentAttempt} that is its actual provenance. Reading only the first made
     * a channel that had been verifiably exported this morning report 「아직 확인한 적이 없어요」, because a
     * column that happens to be null decided the answer. The two records are the same claim in two shapes,
     * so the later of them is the fact — and neither row is edited to make the past look different.
     */
    private Instant lastSuccessfulSync(UUID orgId, UUID channelId, String dataType) {
        Optional<SyncJob> latest =
                syncJobs.findFirstByOrgIdAndChannelIdAndDataTypeOrderByCreatedAtDesc(orgId, channelId, dataType);
        // Only a run that actually landed rows counts. A FAILED run is evidence the channel is NOT
        // answering, and letting it stand in for a success is how a broken credential reads as fresh.
        Instant collected = latest.filter(j -> "SUCCESS".equals(j.getStatus()) || "PARTIAL".equals(j.getStatus()))
                .map(SyncJob::getFinishedAt)
                .orElse(null);
        if (!"REVIEW".equals(dataType)) {
            return collected;
        }
        Instant acquired = acquisitions.lastSucceededAt(orgId, channelId);
        if (collected == null) {
            return acquired;
        }
        return acquired == null || acquired.isBefore(collected) ? collected : acquired;
    }

    private static Map<UUID, long[]> pairs(List<Object[]> rows) {
        Map<UUID, long[]> out = new HashMap<>();
        for (Object[] row : rows) {
            out.put((UUID) row[0], new long[] {
                    ((Number) row[1]).longValue(),
                    row[2] == null ? 0L : ((Number) row[2]).longValue()});
        }
        return out;
    }

    private static Map<UUID, Instant> instants(List<Object[]> rows) {
        Map<UUID, Instant> out = new HashMap<>();
        for (Object[] row : rows) {
            if (row[1] != null) {
                out.put((UUID) row[0], (Instant) row[1]);
            }
        }
        return out;
    }
}
