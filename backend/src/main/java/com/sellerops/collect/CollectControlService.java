package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ConnectionStatusView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.collect.dto.SchedulePutRequest;
import com.sellerops.collect.dto.ScheduleView;
import com.sellerops.collect.dto.SyncRunView;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.PullConnector;
import com.sellerops.credential.CredentialMetadata;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The operator-facing control surface for scheduled collection (Slice 6):
 * schedule settings, "지금 수집하기", retry, connection status, run history,
 * capability badges, and write-only credential intake. Controllers stay thin —
 * every org-scoping, validation, and state decision lives here.
 *
 * <p>Manual sync and retry execute synchronously through {@link SyncRunExecutor}
 * (acceptable at mock-connector latency; a queue is a later upgrade). Alert
 * acknowledgement and any notification delivery remain out of scope.
 */
@Service
public class CollectControlService {

    /** Floor for operator-set cadence — protects channels from accidental hammering. */
    static final int MIN_INTERVAL_MINUTES = 15;
    /** Page size of the run-history response. */
    static final int RUN_HISTORY_PAGE = 20;
    private static final List<String> RETRYABLE_STATUSES = List.of("FAILED", "PARTIAL");
    private static final Comparator<SyncJob> BY_STARTED_AT_DESC =
            Comparator.comparing(SyncJob::getStartedAt, Comparator.nullsLast(Comparator.reverseOrder()));

    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final SyncScheduleRepository schedules;
    private final SyncJobRepository syncJobs;
    private final ChannelConnectionStatusRepository connectionStatus;
    private final ConnectorCapabilityRepository capabilities;
    private final ConnectorRegistry registry;
    private final SyncRunExecutor executor;
    private final CredentialVault vault;

    public CollectControlService(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                 SyncScheduleRepository schedules, SyncJobRepository syncJobs,
                                 ChannelConnectionStatusRepository connectionStatus,
                                 ConnectorCapabilityRepository capabilities, ConnectorRegistry registry,
                                 SyncRunExecutor executor, CredentialVault vault) {
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.schedules = schedules;
        this.syncJobs = syncJobs;
        this.connectionStatus = connectionStatus;
        this.capabilities = capabilities;
        this.registry = registry;
        this.executor = executor;
        this.vault = vault;
    }

    public List<ScheduleView> listSchedules(UUID orgId, UUID sellerAccountId) {
        requireAccount(orgId, sellerAccountId);
        return schedules.findByOrgIdAndSellerAccountId(orgId, sellerAccountId).stream()
                .map(ScheduleView::from)
                .toList();
    }

    /** Upsert the schedule for one data type; enabling makes it due immediately. */
    public ScheduleView putSchedule(UUID orgId, UUID sellerAccountId, SchedulePutRequest request) {
        SellerAccount account = requireAccount(orgId, sellerAccountId);
        DataType dataType = parseDataType(request.dataType());
        requireAutoCollectable(account, dataType);
        if (request.intervalMinutes() < MIN_INTERVAL_MINUTES) {
            throw ApiException.badRequest("수집 주기는 최소 " + MIN_INTERVAL_MINUTES + "분 이상이어야 합니다.");
        }

        SyncSchedule schedule = schedules
                .findByOrgIdAndSellerAccountIdAndDataType(orgId, sellerAccountId, dataType.name())
                .orElseGet(() -> {
                    SyncSchedule fresh = new SyncSchedule();
                    fresh.setOrgId(orgId);
                    fresh.setSellerAccountId(sellerAccountId);
                    fresh.setDataType(dataType.name());
                    return fresh;
                });
        schedule.setCadenceKind(SyncScheduleClaimer.CADENCE_INTERVAL);
        schedule.setIntervalMinutes(request.intervalMinutes());
        schedule.setEnabled(request.enabled());
        schedule.setPausedReason(null);
        // Enabling makes the schedule due now (first collection on the next tick);
        // disabling clears the slot so it can never be claimed by mistake.
        schedule.setNextRunAt(request.enabled() ? Instant.now() : null);
        return ScheduleView.from(schedules.save(schedule));
    }

    /** "지금 수집하기" — synchronous manual run for one data type. */
    public SyncRunView manualSync(UUID orgId, UUID sellerAccountId, String dataTypeRaw) {
        requireAccount(orgId, sellerAccountId);
        DataType dataType = parseDataType(dataTypeRaw);
        return SyncRunView.from(executor.execute(orgId, sellerAccountId, dataType, "MANUAL"));
    }

    /** Operator re-run of a FAILED/PARTIAL pull run, with the attempt counter advanced. */
    public SyncRunView retry(UUID orgId, UUID jobId) {
        SyncJob original = syncJobs.findByIdAndOrgId(jobId, orgId)
                .orElseThrow(() -> ApiException.notFound("수집 이력을 찾을 수 없습니다."));
        if (!RETRYABLE_STATUSES.contains(original.getStatus())) {
            throw ApiException.badRequest("실패 또는 부분 성공한 수집만 다시 시도할 수 있습니다.");
        }
        if (original.getSellerAccountId() == null || original.getDataType() == null) {
            throw ApiException.badRequest("파일 업로드 이력은 다시 시도할 수 없습니다. 파일을 다시 업로드해 주세요.");
        }
        SyncJob rerun = executor.execute(orgId, original.getSellerAccountId(),
                parseDataType(original.getDataType()), "RETRY");
        rerun.setAttempt(original.getAttempt() + 1);
        return SyncRunView.from(syncJobs.save(rerun));
    }

    public ConnectionStatusView connectionStatus(UUID orgId, UUID sellerAccountId) {
        SellerAccount account = requireAccount(orgId, sellerAccountId);
        ChannelConnectionStatus health = connectionStatus.findBySellerAccountId(sellerAccountId).orElse(null);
        Instant nextScheduledAt = schedules.findByOrgIdAndSellerAccountId(orgId, sellerAccountId).stream()
                .filter(SyncSchedule::isEnabled)
                .map(SyncSchedule::getNextRunAt)
                .filter(t -> t != null)
                .min(Comparator.naturalOrder())
                .orElse(null);
        return new ConnectionStatusView(
                sellerAccountId,
                health != null ? health.getState() : "NOT_COLLECTED",
                health != null ? health.getLastSuccessAt() : null,
                health != null ? health.getConsecutiveFailures() : 0,
                health != null ? health.getLastError() : null,
                account.getLastSyncedAt(),
                nextScheduledAt);
    }

    /**
     * Unified run history (scheduled + manual + retry + upload), ordered by
     * startedAt desc (nulls last, deterministically across H2/Postgres), with
     * optional exact-match filters. Filters are applied in-service over the
     * {@code FILTER_WINDOW} most recent runs — bounded and org-scoped at the
     * query; real pagination is a later upgrade.
     */
    public List<SyncRunView> listRuns(UUID orgId, UUID sellerAccountId, UUID channelId,
                                      String dataType, String trigger, String status) {
        return syncJobs.findTop200ByOrgIdOrderByCreatedAtDesc(orgId).stream()
                .filter(j -> sellerAccountId == null || sellerAccountId.equals(j.getSellerAccountId()))
                .filter(j -> channelId == null || channelId.equals(j.getChannelId()))
                .filter(j -> dataType == null || dataType.equals(j.getDataType()))
                .filter(j -> trigger == null || trigger.equals(j.getTrigger()))
                .filter(j -> status == null || status.equals(j.getStatus()))
                .sorted(BY_STARTED_AT_DESC)
                .limit(RUN_HISTORY_PAGE)
                .map(SyncRunView::from)
                .toList();
    }

    public List<CapabilityView> channelCapabilities(String channelCode) {
        return capabilities.findByChannelCode(channelCode).stream()
                .map(CapabilityView::from)
                .toList();
    }

    /** Write-only intake: store via the vault, answer with masked metadata only. */
    public CredentialMetadata storeCredential(UUID orgId, UUID sellerAccountId,
                                              CredentialIntakeRequest request, UUID createdBy) {
        requireAccount(orgId, sellerAccountId);
        return vault.store(orgId, sellerAccountId, request.connectorClass(), request.authType(),
                request.secrets(), request.refreshToken(), request.tokenExpiresAt(), createdBy);
    }

    /**
     * Masked credential metadata — never plaintext, ciphertext, IV, or refresh
     * token. Needs no master key (metadata reads don't decrypt); the vault's
     * decrypting {@code open} is run-time-only and is deliberately not exposed.
     */
    public CredentialMetadata readCredential(UUID orgId, UUID sellerAccountId) {
        requireAccount(orgId, sellerAccountId);
        return vault.readMasked(orgId, sellerAccountId);
    }

    private SellerAccount requireAccount(UUID orgId, UUID sellerAccountId) {
        // Org scoping at the query boundary — a cross-org id reads as absent.
        return sellerAccounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }

    private void requireAutoCollectable(SellerAccount account, DataType dataType) {
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        PullConnector connector = registry.resolvePullConnector(channel.getCode())
                .orElseThrow(() -> ApiException.badRequest(
                        "이 채널은 자동 수집을 지원하지 않습니다. 파일 업로드를 이용해 주세요."));
        if (!connector.capabilities(channel.getCode()).supports(dataType)) {
            throw ApiException.badRequest("이 채널에서는 " + dataType.name() + " 자동 수집이 지원되지 않습니다.");
        }
    }

    private static DataType parseDataType(String raw) {
        try {
            return DataType.valueOf(raw);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw ApiException.badRequest("지원되지 않는 데이터 유형입니다: " + raw);
        }
    }
}
