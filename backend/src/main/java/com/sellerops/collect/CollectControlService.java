package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.CapabilityView;
import com.sellerops.collect.dto.ChannelCapabilityOverview;
import com.sellerops.collect.dto.ConnectionStatusView;
import com.sellerops.collect.dto.ConnectionTestResultView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.collect.dto.CredentialReplaceResultView;
import com.sellerops.collect.dto.SchedulePutRequest;
import com.sellerops.collect.dto.ScheduleView;
import com.sellerops.collect.dto.SyncRunView;
import com.sellerops.common.ApiException;
import com.sellerops.connector.ChannelApiGapRegistry;
import com.sellerops.connector.ChannelConnectionStatus;
import com.sellerops.connector.ChannelConnectionStatusRepository;
import com.sellerops.connector.ConnectionVerifier;
import com.sellerops.connector.ConnectorAlertService;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.VerifyContext;
import com.sellerops.connector.VerifyOutcome;
import com.sellerops.connector.coupang.CoupangCredentialExpiryStatus;
import com.sellerops.connector.coupang.onboarding.CoupangConnectionLifecycle;
import com.sellerops.connector.naver.onboarding.NaverConnectionLifecycle;
import com.sellerops.credential.CredentialIntakeValidator;
import com.sellerops.credential.CredentialIntakeValidator.ValidatedCredential;
import com.sellerops.credential.CredentialMetadata;
import com.sellerops.credential.CredentialTemplates;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.selleraccount.AccountSessionSlot;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.selleraccount.SessionReadinessState;
import com.sellerops.selfpilot.SellerAccountReauthService;
import org.springframework.beans.factory.annotation.Autowired;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import com.sellerops.sync.SyncSchedule;
import com.sellerops.sync.SyncScheduleRepository;
import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.springframework.stereotype.Service;

/**
 * The operator-facing control surface for scheduled collection (Slice 6):
 * schedule settings, "지금 수집하기", retry, connection status, run history,
 * both capability reads (the seeded {@code connector_capabilities} rows that gate scheduling, and
 * the computed overview the badges render — see {@link ChannelCapabilityController}), and
 * write-only credential intake. Controllers stay thin —
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
    private final AccountSessionSlotService accountSlots;
    private final NaverConnectionLifecycle naverLifecycle;
    private final CoupangConnectionLifecycle coupangLifecycle;
    /** Optional (Self-Pilot v1): resumes auth-paused schedules once a credential verifies again. */
    private final SellerAccountReauthService reauth;
    private final ConnectorAlertService alertService;

    /** Pre-Self-Pilot signature (no reauth service) — kept for the tests that construct it directly. */
    public CollectControlService(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                 SyncScheduleRepository schedules, SyncJobRepository syncJobs,
                                 ChannelConnectionStatusRepository connectionStatus,
                                 ConnectorCapabilityRepository capabilities, ConnectorRegistry registry,
                                 SyncRunExecutor executor, CredentialVault vault,
                                 AccountSessionSlotService accountSlots,
                                 NaverConnectionLifecycle naverLifecycle,
                                 CoupangConnectionLifecycle coupangLifecycle,
                                 ConnectorAlertService alertService) {
        this(sellerAccounts, channels, schedules, syncJobs, connectionStatus, capabilities, registry, executor,
                vault, accountSlots, naverLifecycle, coupangLifecycle, alertService, null);
    }

    @Autowired
    public CollectControlService(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                 SyncScheduleRepository schedules, SyncJobRepository syncJobs,
                                 ChannelConnectionStatusRepository connectionStatus,
                                 ConnectorCapabilityRepository capabilities, ConnectorRegistry registry,
                                 SyncRunExecutor executor, CredentialVault vault,
                                 AccountSessionSlotService accountSlots,
                                 NaverConnectionLifecycle naverLifecycle,
                                 CoupangConnectionLifecycle coupangLifecycle,
                                 ConnectorAlertService alertService,
                                 SellerAccountReauthService reauth) {
        this.reauth = reauth;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.schedules = schedules;
        this.syncJobs = syncJobs;
        this.connectionStatus = connectionStatus;
        this.capabilities = capabilities;
        this.registry = registry;
        this.executor = executor;
        this.vault = vault;
        this.accountSlots = accountSlots;
        this.naverLifecycle = naverLifecycle;
        this.coupangLifecycle = coupangLifecycle;
        this.alertService = alertService;
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

    /**
     * Operator-initiated bounded date-window backfill for one data type — a
     * synchronous MANUAL run scoped to [{@code startDate}, {@code endDate}]. The
     * window is validated here ({@link BackfillWindow#of}) and seeded into the run
     * by {@link SyncRunExecutor}; the scheduler is never involved. A channel whose
     * connector cannot serve a windowed backfill fails closed inside the executor.
     */
    public SyncRunView manualBackfill(UUID orgId, UUID sellerAccountId, String dataTypeRaw,
                                      java.time.LocalDate startDate, java.time.LocalDate endDate) {
        requireAccount(orgId, sellerAccountId);
        DataType dataType = parseDataType(dataTypeRaw);
        BackfillWindow window = BackfillWindow.of(startDate, endDate);
        SyncJob run = executor.execute(orgId, sellerAccountId, dataType, "MANUAL", window);
        // Single-flight can coalesce this backfill onto an already in-flight run (it returns that
        // RUNNING run). A backfill carries a specific window the in-flight run did NOT collect, so we
        // must not report it as done — fail closed and let the operator retry once the run finishes,
        // rather than silently dropping the window or racing the shared cursor.
        if ("RUNNING".equals(run.getStatus())) {
            throw ApiException.conflict(
                    "이미 수집이 진행 중입니다. 진행 중인 수집이 끝난 뒤 기간 지정 백필을 다시 시도해 주세요.");
        }
        return SyncRunView.from(run);
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
        // Single-flight can coalesce this retry onto an already in-flight run (returned as RUNNING).
        // That job belongs to the executor thread currently running it — do NOT bump its attempt or
        // save the (detached, stale) snapshot, which would race and clobber the live run's status and
        // cursor. Return it as-is: the operator sees the run already in progress.
        if ("RUNNING".equals(rerun.getStatus())) {
            return SyncRunView.from(rerun);
        }
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
        // Reconcile the session-readiness axis onto the same panel. No slot yet (the account has never been
        // guided through a live run) reads as UNOBSERVED_EXTERNAL — the fail-closed default, not READY.
        AccountSessionSlot slot = accountSlots.findBySellerAccount(sellerAccountId).orElse(null);
        String sessionReadiness =
                (slot != null ? slot.getReadinessState() : SessionReadinessState.UNOBSERVED_EXTERNAL).name();
        Instant sessionObservedAt = slot != null ? slot.getLastObservedAt() : null;

        // Credential-expiry axis — computed (never stored) from the stored expiry date vs now plus the
        // auth-failing health signal. No credential on file ⇒ no date ⇒ UNKNOWN. Never reads a secret:
        // the vault's masked metadata carries the expiry date only.
        Instant expiresAt = vault.hasCredential(orgId, sellerAccountId)
                ? vault.readMasked(orgId, sellerAccountId).tokenExpiresAt()
                : null;
        boolean authFailing = health != null && health.getConsecutiveFailures() > 0;
        CoupangCredentialExpiryStatus credentialExpiry =
                CoupangCredentialExpiryStatus.compute(expiresAt, Instant.now(), authFailing);

        // Reading the connection status is where the expiry alert is (idempotently) refreshed — no
        // scheduler. Scoped to Coupang accounts so the COUPANG_* alert types never attach elsewhere.
        if (isCoupangAccount(account)) {
            alertService.evaluateCoupangExpiryAlert(orgId, sellerAccountId, credentialExpiry);
        }

        return new ConnectionStatusView(
                sellerAccountId,
                health != null ? health.getState() : "NOT_COLLECTED",
                health != null ? health.getLastSuccessAt() : null,
                health != null ? health.getConsecutiveFailures() : 0,
                health != null ? health.getLastError() : null,
                account.getLastSyncedAt(),
                nextScheduledAt,
                sessionReadiness,
                sessionObservedAt,
                credentialExpiry);
    }

    private boolean isCoupangAccount(SellerAccount account) {
        if (account.isFileUpload()) {
            return false;
        }
        return channels.findById(account.getChannelId())
                .map(Channel::getCode)
                .filter(com.sellerops.connector.coupang.CoupangApiConnector.CHANNEL_CODE::equals)
                .isPresent();
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

    /** The canonical operator-facing data types, in display order, with Korean labels. */
    private static final List<DataType> OVERVIEW_DATA_TYPES =
            List.of(DataType.ORDER_SUMMARY, DataType.REVIEW, DataType.INQUIRY);

    private static String dataTypeLabel(DataType dataType) {
        return switch (dataType) {
            case ORDER_SUMMARY -> "주문·매출";
            case REVIEW -> "리뷰";
            case INQUIRY -> "문의";
            case PRODUCT -> "상품";
            case SALES -> "판매 통계";
        };
    }

    /**
     * Channel-generic capability overview that prefers the in-code connector
     * capabilities (the source of truth for API connectors, several of which are
     * not seeded into {@code connector_capabilities}) over the reference table.
     * It reflects the connector actually resolved for the channel, plus that
     * connector's honest unsupported-scope boundaries. A channel with no pull
     * connector (file-upload / not integrated) reports auto-collect unsupported.
     */
    public ChannelCapabilityOverview channelCapabilityOverview(String channelCode) {
        String channelNameKo = channels.findByCode(channelCode)
                .map(Channel::getNameKo)
                .orElse(null);
        PullConnector connector = registry.resolvePullConnector(channelCode).orElse(null);
        if (connector == null) {
            return new ChannelCapabilityOverview(
                    channelCode, channelNameKo, null, false, List.of(), List.of());
        }

        ConnectorCapabilities caps = connector.capabilities(channelCode);
        List<ChannelCapabilityOverview.DataTypeCapability> dataTypes = OVERVIEW_DATA_TYPES.stream()
                .map(dt -> new ChannelCapabilityOverview.DataTypeCapability(
                        dt.name(),
                        dataTypeLabel(dt),
                        caps.supports(dt),
                        caps.supports(dt)
                                ? caps.verificationStatus().getOrDefault(dt, "NEEDS_VERIFICATION")
                                : "UNSUPPORTED",
                        // Read beside the connector's answer, never folded into it: a type the
                        // connector cannot serve may still be one SellerOps collects another way.
                        AcquisitionPathRegistry.pathsFor(channelCode, dt)))
                .toList();
        List<ChannelCapabilityOverview.ScopeNote> scopes = unsupportedScopes(connector, channelCode);
        return new ChannelCapabilityOverview(
                channelCode, channelNameKo, caps.connectorClass(), true, dataTypes, scopes);
    }

    /**
     * The boundaries this channel's operator screen must state: what the connector declines to do,
     * plus what the marketplace never offered.
     *
     * <p>Two sources because the facts have two lifetimes. A connector's scopes belong to that
     * connector and vanish when it does — the real Coupang connector sits behind a flag that is off
     * by default, so on a default environment the honest 리뷰 API 없음 note disappeared and the
     * acquisition badge stood there with nothing to answer it. {@link ChannelApiGapRegistry} holds
     * the half that is about the marketplace and therefore has to survive whichever connector
     * resolved.
     *
     * <p>Merged by {@code code}, connector first and winning, so a connector may still say a channel
     * gap in its own words and the operator never reads one fact twice.
     */
    private List<ChannelCapabilityOverview.ScopeNote> unsupportedScopes(PullConnector connector,
                                                                        String channelCode) {
        LinkedHashMap<String, ChannelCapabilityOverview.ScopeNote> byCode = new LinkedHashMap<>();
        Stream.concat(connector.unsupportedScopes(channelCode).stream(),
                        ChannelApiGapRegistry.gapsFor(channelCode).stream())
                .forEach(s -> byCode.putIfAbsent(
                        s.code(), new ChannelCapabilityOverview.ScopeNote(s.code(), s.label())));
        return List.copyOf(byCode.values());
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
     * Operator-confirmation of the credential's exact expiry date when it was unknown (WING's `유효기간` could
     * not be read). Updates ONLY the stored expiry — touches no secret material — and never accepts an estimate
     * (the caller supplies the exact date, or null to clear it). The expiry status/alerts recompute on the next
     * connection-status read. Org-scoped + fails closed on a missing credential.
     */
    public CredentialMetadata confirmCredentialExpiry(UUID orgId, UUID sellerAccountId, Instant tokenExpiresAt) {
        requireAccount(orgId, sellerAccountId);
        return vault.setTokenExpiresAt(orgId, sellerAccountId, tokenExpiresAt);
    }

    // Safe reason codes for the atomic credential-replacement result (never a provider body).
    static final String REPLACE_STATUS_SUCCESS = "SUCCESS";
    static final String REPLACE_STATUS_FAILED = "FAILED";
    static final String REPLACE_REASON_NO_EXISTING = "NO_EXISTING_CREDENTIAL";
    static final String REPLACE_REASON_VERIFY_UNSUPPORTED = "VERIFY_UNSUPPORTED";
    static final String REPLACE_REASON_ERROR = "REPLACE_ERROR";

    /**
     * Atomic guided-renewal credential replacement with rollback. Replaces the stored secrets +
     * expiry date in place, verifies the new credential (connection test + order-access probe), and:
     * <ul>
     *   <li><b>SUCCESS</b> — keeps the new credential; the account row, collected orders, and sync
     *       cursors are left <b>untouched</b> (only the credential row changed); any paused per-account
     *       schedule is resumed.</li>
     *   <li><b>FAILURE</b> — <b>restores the captured OLD credential</b> (secrets + its expiry) so the
     *       existing, working credential is never destroyed by a bad renewal, and returns a safe failure.</li>
     * </ul>
     * The captured old secrets live in memory only for the duration of the swap — never logged,
     * persisted elsewhere, or returned. Never auto re-issues / deletes / resets a key; never reads or
     * returns the Secret Key. The new expiry date is the WING-read / operator-confirmed exact date from
     * the request; if absent it is stored as {@code null} (unknown) — never an estimate.
     */
    public CredentialReplaceResultView replaceCredential(UUID orgId, UUID sellerAccountId,
                                                         CredentialIntakeRequest request, UUID actorUserId) {
        // 1. Org scoping first — a cross-org id reads as 404 before any vault/connector touch.
        SellerAccount account = requireAccount(orgId, sellerAccountId);
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        CredentialTemplate template = CredentialTemplates.find(channel.getCode())
                .orElseThrow(() -> ApiException.badRequest(
                        "이 채널은 API 연결 정보 저장을 지원하지 않습니다. 파일 업로드를 이용해 주세요."));

        // 2. Replacement requires an existing credential to roll back to; a first-time store is /credentials.
        if (!vault.hasCredential(orgId, sellerAccountId)) {
            return new CredentialReplaceResultView(sellerAccountId, REPLACE_STATUS_FAILED,
                    REPLACE_REASON_NO_EXISTING, "교체할 기존 연결 정보가 없습니다. 먼저 연결 정보를 저장해 주세요.", null);
        }

        // 3. Validate the new payload against the channel contract (server-derived class/authType).
        ValidatedCredential valid = CredentialIntakeValidator.validate(template, request);

        // 4. Capture the OLD credential IN MEMORY only — never logged, persisted elsewhere, or returned.
        DecryptedCredential old = vault.open(orgId, sellerAccountId);

        // 5. Store the NEW secrets + expiry (atomic in-place upsert; stamps last_rotated_at).
        vault.store(orgId, sellerAccountId, valid.connectorClass(), valid.authType(),
                valid.secrets(), request.refreshToken(), request.tokenExpiresAt(), actorUserId);

        // 6. Verify the new credential (connection test + order-access probe) WITHOUT driving the
        //    connection lifecycle — the account row must stay untouched on the replace path. An UNEXPECTED
        //    throw here must not leave the unverified new credential in place: restore the old, fail closed
        //    (the "existing credential is never destroyed" guarantee stays airtight even on an error).
        VerifyOutcome outcome;
        try {
            outcome = verifyStored(orgId, sellerAccountId, channel.getCode());
        } catch (RuntimeException e) {
            restoreCredential(orgId, sellerAccountId, old, actorUserId);
            return new CredentialReplaceResultView(sellerAccountId, REPLACE_STATUS_FAILED, REPLACE_REASON_ERROR,
                    "연결 정보 교체 중 오류가 발생했습니다. 기존 연결 정보를 유지합니다.", old.tokenExpiresAt());
        }

        if (outcome != null && outcome.status() == VerifyOutcome.Status.SUCCESS) {
            // 7a. Keep the VERIFIED new credential. Account / channel_orders / sync_cursors are all left
            //     untouched; resuming a paused schedule is best-effort — a scheduling hiccup must NEVER roll
            //     back a credential that already verified.
            try {
                resumePausedSchedules(orgId, sellerAccountId);
                if (reauth != null) {
                    // Self-Pilot v1: also closes an AUTH_EXPIRED alert and clears NEEDS_REAUTH health.
                    reauth.onReconnected(orgId, sellerAccountId);
                }
                // The renewed credential's expiry is fresh — clear the stale expiring/expired nudges so a
                // future cycle can raise a new one. Best-effort; never rolls back a verified credential.
                alertService.clearCoupangExpiryAlerts(sellerAccountId);
            } catch (RuntimeException ignore) {
                /* best-effort: the credential is valid and stays; the schedule can be resumed later */
            }
            return new CredentialReplaceResultView(sellerAccountId, REPLACE_STATUS_SUCCESS, null,
                    "연결 정보가 갱신되었습니다.", request.tokenExpiresAt());
        }

        // 7b. Verification FAILED → RESTORE the captured OLD credential (secrets + its exact expiry). The
        //     existing credential is not destroyed; account / orders / cursors were never touched.
        restoreCredential(orgId, sellerAccountId, old, actorUserId);
        String reasonCode = outcome != null ? outcome.reasonCode() : REPLACE_REASON_VERIFY_UNSUPPORTED;
        String message = outcome != null
                ? failureMessage(outcome.reasonCode())
                : "이 채널의 연결 확인은 아직 제공되지 않습니다.";
        return new CredentialReplaceResultView(sellerAccountId, REPLACE_STATUS_FAILED, reasonCode,
                message, old.tokenExpiresAt());
    }

    /** Restore a previously-captured credential in place (rollback) — secrets + its exact expiry. */
    private void restoreCredential(UUID orgId, UUID sellerAccountId, DecryptedCredential old, UUID actorUserId) {
        vault.store(orgId, sellerAccountId, old.connectorClass(), old.authType(),
                old.secrets(), old.refreshToken(), old.tokenExpiresAt(), actorUserId);
    }

    /**
     * Resolve the channel's {@link ConnectionVerifier} and run its read-only auth + order-access
     * check. Returns {@code null} when the resolved connector cannot verify (e.g. the mock fallback
     * with the real connector flag off) so the caller fails closed. Unlike {@link #testConnection}
     * this drives NO connection lifecycle — the replace path must not move the account row.
     */
    private VerifyOutcome verifyStored(UUID orgId, UUID sellerAccountId, String channelCode) {
        ConnectionVerifier verifier = registry.resolvePullConnector(channelCode)
                .filter(ConnectionVerifier.class::isInstance)
                .map(ConnectionVerifier.class::cast)
                .orElse(null);
        if (verifier == null) {
            return null;
        }
        return verifier.verifyConnection(new VerifyContext(orgId, sellerAccountId, channelCode));
    }

    /** Resume any system-paused per-account schedule (재개) — an operator-disabled one is left off. */
    private void resumePausedSchedules(UUID orgId, UUID sellerAccountId) {
        schedules.findByOrgIdAndSellerAccountId(orgId, sellerAccountId).stream()
                .filter(s -> s.getPausedReason() != null)
                .forEach(s -> {
                    s.setEnabled(true);
                    s.setPausedReason(null);
                    s.setNextRunAt(Instant.now());
                    schedules.save(s);
                });
    }

    /**
     * Manual, explicit auth/connectivity check for a stored credential — never
     * collection. Ordered so nothing privileged happens before org scoping, and
     * structured so only a connector that opts into {@link ConnectionVerifier}
     * (NAVER does) can produce a real SUCCESS/FAILED; every other path resolves to
     * a safe UNSUPPORTED/NOT_CONFIGURED result. Runs no sync, creates no job, and
     * returns no secret/provider detail. A real SUCCESS / clearly-invalid outcome
     * is recorded through {@link NaverConnectionLifecycle} (a NAVER
     * {@code connection_status} transition only — never a secret); it issues no
     * provider HTTP of its own beyond the verifier's auth check.
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
        //    verified success — it falls here as UNSUPPORTED. NAVER opts in.
        ConnectionVerifier verifier = registry.resolvePullConnector(channel.getCode())
                .filter(ConnectionVerifier.class::isInstance)
                .map(ConnectionVerifier.class::cast)
                .orElse(null);
        if (verifier == null) {
            return testResult(sellerAccountId, TEST_STATUS_UNSUPPORTED, TEST_REASON_VERIFY_NOT_IMPLEMENTED,
                    "이 채널의 연결 확인은 아직 제공되지 않습니다.");
        }

        // 5. Real verification (NAVER implements this). The verifier opens the vault itself; secrets
        //    never pass through here. The outcome then drives the account's connection lifecycle: a
        //    verified test records the credential test success (NAVER only; a no-op for others), and a
        //    clearly-invalid credential recalls the account for reconnect. Transient failures never move
        //    the status.
        VerifyOutcome outcome = verifier.verifyConnection(
                new VerifyContext(orgId, sellerAccountId, channel.getCode()));
        if (outcome.status() == VerifyOutcome.Status.SUCCESS) {
            // Each lifecycle is guarded to its own channel and no-ops for the others, so calling both
            // is safe — the account's channel decides which one records the PREPARING transition.
            naverLifecycle.onCredentialTestVerified(orgId, sellerAccountId);
            coupangLifecycle.onCredentialTestVerified(orgId, sellerAccountId);
            // Self-Pilot v1: a verified credential lifts an auth pause — schedules resume, alert closes.
            if (reauth != null) {
                reauth.onReconnected(orgId, sellerAccountId);
            }
            return testResult(sellerAccountId, TEST_STATUS_SUCCESS, null, "연결 정보가 확인되었습니다.");
        }
        if (VerifyOutcome.REASON_INVALID_CREDENTIAL.equals(outcome.reasonCode())) {
            naverLifecycle.onCredentialRejected(orgId, sellerAccountId);
            coupangLifecycle.onCredentialRejected(orgId, sellerAccountId);
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
        if (VerifyOutcome.REASON_PERMISSION_INSUFFICIENT.equals(reasonCode)) {
            return "연결에 필요한 주문 API 권한이 부족할 수 있습니다. 애플리케이션의 주문 API 그룹 권한을 확인해 주세요.";
        }
        if (VerifyOutcome.REASON_CALL_ENVIRONMENT_MISMATCH.equals(reasonCode)) {
            return "허용된 호출 환경(호출 IP)과 일치하지 않을 수 있습니다. 애플리케이션의 API 호출 IP 등록을 확인해 주세요.";
        }
        if (VerifyOutcome.REASON_ORDER_ACCESS_DENIED.equals(reasonCode)) {
            return "주문 API 접근이 거부되었습니다. 애플리케이션의 주문 API 그룹 권한과 API 호출 IP 등록을 확인해 주세요.";
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
