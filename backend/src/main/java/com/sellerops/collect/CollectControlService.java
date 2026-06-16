package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ConnectionStatusView;
import com.sellerops.collect.dto.ConnectionTestResultView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.collect.dto.SchedulePutRequest;
import com.sellerops.collect.dto.ScheduleView;
import com.sellerops.collect.dto.SyncRunView;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.credential.CredentialIntakeValidator;
import com.sellerops.credential.CredentialIntakeValidator.ValidatedCredential;
import com.sellerops.credential.CredentialMetadata;
import com.sellerops.credential.CredentialTemplates;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
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

    // Test-connection result statuses and safe reason codes (see ConnectionTestResultView).
    static final String TEST_STATUS_SUCCESS = "SUCCESS";
    static final String TEST_STATUS_FAILED = "FAILED";
    static final String TEST_STATUS_UNSUPPORTED = "UNSUPPORTED";
    static final String TEST_STATUS_NOT_CONFIGURED = "NOT_CONFIGURED";
    static final String TEST_REASON_UNSUPPORTED_CHANNEL = "UNSUPPORTED_CHANNEL";
    static final String TEST_REASON_VERIFY_NOT_IMPLEMENTED = "VERIFY_NOT_IMPLEMENTED";
    static final String TEST_REASON_NOT_CONFIGURED = "NOT_CONFIGURED";

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

    /**
     * Write-only intake: validate the payload against the channel's
     * {@link CredentialTemplates} contract, then store via the vault and answer with
     * masked metadata only. connectorClass/authType are server-derived from the
     * template, not trusted from the client.
     */
    public CredentialMetadata storeCredential(UUID orgId, UUID sellerAccountId,
                                              CredentialIntakeRequest request, UUID createdBy) {
        // Org scoping first — a cross-org id must read as 404, before any validation.
        SellerAccount account = requireAccount(orgId, sellerAccountId);
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        CredentialTemplate template = CredentialTemplates.find(channel.getCode())
                .orElseThrow(() -> ApiException.badRequest(
                        "이 채널은 API 연결 정보 저장을 지원하지 않습니다. 파일 업로드를 이용해 주세요."));
        ValidatedCredential valid = CredentialIntakeValidator.validate(template, request);
        return vault.store(orgId, sellerAccountId, valid.connectorClass(), valid.authType(),
                valid.secrets(), request.refreshToken(), request.tokenExpiresAt(), createdBy);
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

    /**
     * Manual, explicit auth/connectivity check for a stored credential — never
     * collection. Ordered so nothing privileged happens before org scoping, and
     * structured so only a connector that opts into {@link ConnectionVerifier}
     * (none yet) can produce a real SUCCESS/FAILED; every other path resolves to
     * a safe UNSUPPORTED/NOT_CONFIGURED result. Issues no provider HTTP, runs no
     * sync, creates no job, persists nothing, and returns no secret/provider
     * detail.
     */
    public ConnectionTestResultView testConnection(UUID orgId, UUID sellerAccountId) {
        // 1. Org scoping first — a cross-org id reads as 404, before any vault/connector touch.
        SellerAccount account = requireAccount(orgId, sellerAccountId);
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));

        // 2. File-upload/manual accounts have no provider connection to verify.
        if (account.isFileUpload() || registry.isFileChannel(channel.getCode())) {
            return testResult(sellerAccountId, TEST_STATUS_UNSUPPORTED, TEST_REASON_UNSUPPORTED_CHANNEL,
                    "이 채널은 연결 확인을 지원하지 않습니다.");
        }

        // 3. No credential on file — nothing to verify; no provider call, no vault open.
        if (!vault.hasCredential(orgId, sellerAccountId)) {
            return testResult(sellerAccountId, TEST_STATUS_NOT_CONFIGURED, TEST_REASON_NOT_CONFIGURED,
                    "저장된 연결 정보가 없습니다.");
        }

        // 4. Only a connector that opts into ConnectionVerifier can run a real auth check.
        //    The generic mock fallback does not implement it, so it can never report a
        //    verified success — it falls here as UNSUPPORTED.
        ConnectionVerifier verifier = registry.resolvePullConnector(channel.getCode())
                .filter(ConnectionVerifier.class::isInstance)
                .map(ConnectionVerifier.class::cast)
                .orElse(null);
        if (verifier == null) {
            return testResult(sellerAccountId, TEST_STATUS_UNSUPPORTED, TEST_REASON_VERIFY_NOT_IMPLEMENTED,
                    "이 채널의 연결 확인은 아직 제공되지 않습니다.");
        }

        // 5. Real verification (no connector implements this yet → unreachable this slice).
        //    The verifier opens the vault itself; secrets never pass through here.
        VerifyOutcome outcome = verifier.verifyConnection(
                new VerifyContext(orgId, sellerAccountId, channel.getCode()));
        if (outcome.status() == VerifyOutcome.Status.SUCCESS) {
            return testResult(sellerAccountId, TEST_STATUS_SUCCESS, null, "연결 정보가 확인되었습니다.");
        }
        return testResult(sellerAccountId, TEST_STATUS_FAILED, outcome.reasonCode(),
                failureMessage(outcome.reasonCode()));
    }

    private static ConnectionTestResultView testResult(UUID sellerAccountId, String status,
                                                       String reasonCode, String message) {
        return new ConnectionTestResultView(sellerAccountId, status, Instant.now(), message, reasonCode);
    }

    /**
     * Fixed operator-safe failure text, keyed by the verifier's safe reason code.
     * The verifier never supplies free-text, so no raw provider message can reach
     * the response; an unknown code falls back to the generic safe message.
     */
    private static String failureMessage(String reasonCode) {
        if (VerifyOutcome.REASON_INVALID_CREDENTIAL.equals(reasonCode)) {
            return "연결 정보가 유효하지 않습니다.";
        }
        if (VerifyOutcome.REASON_TEMPORARY_PROVIDER_ERROR.equals(reasonCode)) {
            return "일시적인 채널 응답 오류입니다.";
        }
        // PROVIDER_UNAVAILABLE and any unknown code → generic safe failure.
        return "채널 API 연결 확인에 실패했습니다.";
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
