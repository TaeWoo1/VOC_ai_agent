package com.sellerops.selfpilot;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.PullConnector;
import com.sellerops.review.triage.ReviewTriageChannelCapability;
import com.sellerops.review.triage.feedback.TriagePredictionRepository;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Self-Pilot Runtime v1 — the one periodic reconciler that keeps routine READ work going for the
 * listed orgs without anyone touching a CLI, an approval id, or a settings row in the normal state.
 *
 * <p>Two idempotent duties per tick, both restart-safe because every decision is re-derived from the
 * database (nothing is remembered in the process):
 * <ol>
 *   <li><b>Default schedules.</b> For every CONNECTED, non-file-upload seller account of a listed org
 *       whose channel resolves to a <em>dedicated</em> pull connector (never the mock fallback — a
 *       schedule against the mock would ingest fixture rows into a real org), and for every data type
 *       that connector supports among REVIEW / INQUIRY / ORDER_SUMMARY: create the schedule if — and
 *       only if — no schedule row exists yet. An existing row is never touched, so an operator who
 *       turned a type off stays off, and an auth-paused row stays paused until the reconnect resumes it.
 *       The created schedule is due immediately, so the first collection happens on the next collect
 *       tick.</li>
 *   <li><b>Bounded automatic AI triage.</b> When enabled, for every listed org the AI pilot is on for:
 *       spend at most {@code perTick} classifications per review-capable channel per tick and never past
 *       {@code perDay} predictions per KST day (metered from the immutable prediction rows, so a
 *       restart cannot reset the budget). The pilot's own run is already idempotent (only reviews unseen
 *       under the current classifier version) and single-flight per account (a concurrent operator press
 *       yields a 409, which is skipped here, not retried).</li>
 * </ol>
 *
 * <p>Nothing here writes to a marketplace, changes a review, or opens a browser. The Action-Window
 * data types (NAVER REVIEW, Coupang REVIEW) are not connector-supported and so never get a schedule —
 * they stay the seller's own seated walk, as the capability table says.
 */
@Service
public class SelfPilotReconciler {

    private static final Logger log = LoggerFactory.getLogger(SelfPilotReconciler.class);
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    /** The routine data types; PRODUCT / SALES have no operating surface and are never auto-scheduled. */
    static final List<DataType> ROUTINE_TYPES = List.of(DataType.REVIEW, DataType.INQUIRY, DataType.ORDER_SUMMARY);

    /** What one tick did — counts only, for the log line and the tests. */
    public record TickReport(int schedulesCreated, int triageClassified, int triageSkippedBudget) {
    }

    private final SelfPilotProperties props;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ConnectorRegistry registry;
    private final SyncScheduleRepository schedules;
    private final AiTriagePilotService pilot;
    private final TriagePredictionRepository predictions;

    public SelfPilotReconciler(SelfPilotProperties props, SellerAccountRepository accounts,
                               ChannelRepository channels, ConnectorRegistry registry,
                               SyncScheduleRepository schedules, AiTriagePilotService pilot,
                               TriagePredictionRepository predictions) {
        this.props = props;
        this.accounts = accounts;
        this.channels = channels;
        this.registry = registry;
        this.schedules = schedules;
        this.pilot = pilot;
        this.predictions = predictions;
    }

    /** One reconcile pass. Safe to call from a scheduler tick or a test with any {@code now}. */
    public TickReport tick(Instant now) {
        if (!props.enabled() || props.orgIds().isEmpty()) {
            return new TickReport(0, 0, 0);
        }
        int created = 0;
        int classified = 0;
        int skippedBudget = 0;
        for (UUID orgId : props.orgIds()) {
            try {
                created += ensureDefaultSchedules(orgId, now);
            } catch (RuntimeException e) {
                log.warn("Self-pilot schedule reconcile failed for org {}: {}", orgId, e.getClass().getSimpleName());
            }
            if (props.triageAutoEnabled()) {
                try {
                    int[] r = runBoundedTriage(orgId, now);
                    classified += r[0];
                    skippedBudget += r[1];
                } catch (RuntimeException e) {
                    log.warn("Self-pilot triage tick failed for org {}: {}", orgId, e.getClass().getSimpleName());
                }
            }
        }
        if (created > 0 || classified > 0 || skippedBudget > 0) {
            log.info("Self-pilot tick: schedulesCreated={} triageClassified={} triageSkippedBudget={}",
                    created, classified, skippedBudget);
        }
        return new TickReport(created, classified, skippedBudget);
    }

    /** Duty 1 — see class doc. Returns how many schedule rows were created. */
    int ensureDefaultSchedules(UUID orgId, Instant now) {
        int created = 0;
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            if (account.isFileUpload() || account.getConnectionStatus() != ChannelStatus.CONNECTED) {
                continue;
            }
            Channel channel = channels.findById(account.getChannelId()).orElse(null);
            if (channel == null) {
                continue;
            }
            String code = channel.getCode();
            PullConnector connector = registry.resolvePullConnector(code)
                    .filter(c -> c.dedicatedChannels().contains(code)) // real connector only, never the mock
                    .orElse(null);
            if (connector == null) {
                continue;
            }
            for (DataType type : ROUTINE_TYPES) {
                if (!connector.capabilities(code).supports(type)) {
                    continue;
                }
                if (schedules.findByOrgIdAndSellerAccountIdAndDataType(orgId, account.getId(), type.name()).isPresent()) {
                    continue; // an existing row — enabled, operator-disabled or auth-paused — is the operator's
                }
                SyncSchedule fresh = new SyncSchedule();
                fresh.setOrgId(orgId);
                fresh.setSellerAccountId(account.getId());
                fresh.setDataType(type.name());
                fresh.setCadenceKind("INTERVAL");
                fresh.setIntervalMinutes(props.defaultIntervalMinutes());
                fresh.setEnabled(true);
                fresh.setPausedReason(null);
                fresh.setNextRunAt(now);
                schedules.save(fresh);
                created++;
            }
        }
        return created;
    }

    /** Duty 2 — see class doc. Returns {classified, skippedForBudget}. */
    int[] runBoundedTriage(UUID orgId, Instant now) {
        if (pilot == null || !pilot.isEnabledFor(orgId)) {
            return new int[] {0, 0};
        }
        Instant dayStart = LocalDate.ofInstant(now, KST).atStartOfDay(KST).toInstant();
        long spentToday = predictions.countByOrgIdAndPredictedAtGreaterThanEqual(orgId, dayStart);
        long remainingToday = props.triagePerDay() - spentToday;
        int classified = 0;
        int skipped = 0;
        // Pending work is per (org, channel); one run per channel per tick is enough and avoids two
        // accounts on the same channel racing the same pending set.
        Set<UUID> channelsDone = new HashSet<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            if (account.isFileUpload() || !channelsDone.add(account.getChannelId())) {
                continue;
            }
            Channel channel = channels.findById(account.getChannelId()).orElse(null);
            if (channel == null || !ReviewTriageChannelCapability.of(channel.getCode()).inContract()) {
                continue;
            }
            if (remainingToday <= 0) {
                skipped++;
                continue;
            }
            int limit = (int) Math.min(props.triagePerTick(), remainingToday);
            try {
                AiTriagePilotService.RunResult result = pilot.run(orgId, account.getId(), limit);
                classified += result.considered();
                remainingToday -= result.considered();
            } catch (ApiException busy) {
                // 409 (a run already in flight) or 400/404 (pilot off / channel outside contract) — skip.
                skipped++;
            }
        }
        return new int[] {classified, skipped};
    }
}
