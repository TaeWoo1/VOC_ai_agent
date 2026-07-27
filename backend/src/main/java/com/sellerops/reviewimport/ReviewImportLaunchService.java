package com.sellerops.reviewimport;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.selleraccount.SessionProbeReason;
import com.sellerops.selleraccount.SessionReadinessState;
import java.io.InputStream;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues, resolves, and spends the single-use tickets that authorize one guided Action Window import run.
 *
 * <p><b>Why tickets at all.</b> The Action Window contract transports no identity — a run carries only
 * opaque 16-hex refs, never a plan id, segment id, account id, or date. So the local-agent runtime cannot
 * be told "import segment X over Y..Z"; it is handed a ref, and this service is the only thing that can
 * turn that ref back into scope. That keeps the wire clean AND means the server, not the runtime, decides
 * what a run is allowed to touch.
 *
 * <p><b>A plan exists before any run does</b> (2026-07-26). The seller decides how far back to import in
 * SellerOps — start month, end date today, period and segment count confirmed — and {@link #recordSelectedRange}
 * creates the plan from that choice. Only then can SEGMENT tickets exist. The DISCOVERY ticket kind survives
 * as the single-use authorization for that one plan creation (and as the row that records its provenance), but
 * nothing hosts a discovery RUN any more: there was no marketplace limit to discover, so asking the seller to
 * find one was asking about a constraint that does not exist. {@link #recordDiscoveredRange} remains for the
 * rows that were created that way.
 *
 * <p><b>Single use.</b> A ticket is the whole authorization for one run, so spending it is terminal.
 * Minting is nonetheless idempotent — a seller re-clicking hands back the ticket they already have rather
 * than a second one that would let the same segment be ingested by two concurrent runs (also enforced by a
 * partial unique index in V28).
 */
@Service
public class ReviewImportLaunchService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final ReviewImportLaunchRepository launches;
    private final ReviewImportPlanRepository plans;
    private final ReviewImportSegmentRepository segments;
    private final ReviewImportPlanService planService;
    private final ReviewImportRunService runService;
    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final AccountSessionSlotService accountSlots;
    private final Clock clock;

    /**
     * The seller's "today". KST rather than UTC because the end of the period is the date the seller sees on
     * their own calendar, and for a Korean seller a UTC "today" is yesterday for nine hours every night.
     */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /**
     * The earliest month a seller may choose to import from.
     *
     * A floor, not a marketplace limit — nothing here claims NAVER can reach it. It exists so a typo cannot
     * plan two thousand monthly segments, and it is far enough back to cover any real seller's history.
     */
    static final YearMonth EARLIEST_SELECTABLE_MONTH = YearMonth.of(2010, 1);

    @Autowired
    public ReviewImportLaunchService(ReviewImportLaunchRepository launches,
                                    ReviewImportPlanRepository plans,
                                    ReviewImportSegmentRepository segments,
                                    ReviewImportPlanService planService,
                                    ReviewImportRunService runService,
                                    SellerAccountRepository sellerAccounts,
                                    ChannelRepository channels,
                                    AccountSessionSlotService accountSlots) {
        this(launches, plans, segments, planService, runService, sellerAccounts, channels, accountSlots,
                Clock.system(KST));
    }

    /** Test seam: an explicit {@link Clock} pins the "today" a selected period ends on. */
    ReviewImportLaunchService(ReviewImportLaunchRepository launches,
                             ReviewImportPlanRepository plans,
                             ReviewImportSegmentRepository segments,
                             ReviewImportPlanService planService,
                             ReviewImportRunService runService,
                             SellerAccountRepository sellerAccounts,
                             ChannelRepository channels,
                             AccountSessionSlotService accountSlots,
                             Clock clock) {
        this.launches = launches;
        this.plans = plans;
        this.segments = segments;
        this.planService = planService;
        this.runService = runService;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.accountSlots = accountSlots;
        this.clock = clock;
    }

    /* ─────────────────────────── Issue ─────────────────────────── */

    /**
     * Authorize a range-discovery run for one connected account. Idempotent: an already-open discovery
     * ticket is returned unchanged, so the seller pressing the button twice does not start two runs.
     */
    @Transactional
    public ReviewImportLaunch mintDiscovery(UUID orgId, UUID sellerAccountId) {
        SellerAccount account = sellerAccounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("연동할 채널 계정을 찾을 수 없습니다."));

        Optional<ReviewImportLaunch> open = launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(
                orgId, sellerAccountId, ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED);
        if (open.isPresent()) {
            return open.get();
        }
        return launches.save(newTicket(orgId, sellerAccountId, account.getChannelId(),
                ReviewImportLaunchKind.DISCOVERY, null, null));
    }

    /**
     * Authorize a run for the next segment that still needs one — the "continue" action. Fails closed when
     * nothing remains rather than inventing work.
     */
    @Transactional
    public ReviewImportLaunch mintNextSegment(UUID orgId, UUID planId) {
        ReviewImportSegment next = nextRemainingSegment(orgId, planId)
                .orElseThrow(() -> ApiException.conflict("남은 구간이 없습니다."));
        return mintSegment(orgId, next.getId());
    }

    /**
     * Authorize a run for one specific segment (also the retry path for a FAILED one). Idempotent for the
     * same reason as {@link #mintDiscovery}.
     */
    @Transactional
    public ReviewImportLaunch mintSegment(UUID orgId, UUID segmentId) {
        ReviewImportSegment segment = segments.findByIdAndOrgId(segmentId, orgId)
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
        if (segment.isSuperseded()) {
            throw ApiException.conflict("분할되어 대체된 구간입니다.");
        }
        if (segment.getCoverageState() == SegmentCoverageState.COVERED) {
            throw ApiException.conflict("이미 가져온 구간입니다.");
        }
        if (segment.getExecutionState() == SegmentExecutionState.ACTIVE) {
            throw ApiException.conflict("이미 진행 중인 구간입니다.");
        }
        ReviewImportPlan plan = plans.findByIdAndOrgId(segment.getPlanId(), orgId)
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));

        Optional<ReviewImportLaunch> open =
                launches.findBySegmentIdAndStatus(segmentId, ReviewImportLaunchStatus.ISSUED);
        if (open.isPresent()) {
            return open.get();
        }
        return launches.save(newTicket(plan.getOrgId(), plan.getSellerAccountId(), plan.getChannelId(),
                ReviewImportLaunchKind.SEGMENT, plan.getId(), segmentId));
    }

    /* ─────────────────────────── Resolve ─────────────────────────── */

    /**
     * What the runtime is allowed to know: the kind of run, the channel to open, the opaque per-account
     * slot to bind its persistent profile to, and — for a segment — the exact dates to guide the seller to.
     * Deliberately carries no plan/segment/account id: the runtime picks a per-account profile from the
     * opaque {@code accountSlot}, which the server owns and which is NOT reversible to the seller-account
     * id, so the wire stays identity-free even though the profile is now account-specific.
     *
     * <p>Not {@code readOnly}: the first resolve for an account mints its stable slot (find-or-create), so
     * the runtime always receives one. Minting is idempotent, so this stays a no-op on every later resolve.
     */
    @Transactional
    public LaunchScope resolveScope(UUID orgId, String launchRef) {
        ReviewImportLaunch ticket = requireOpen(orgId, launchRef);
        Channel channel = channels.findById(ticket.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        // The Action Window contract's channelCode is a lowercase semantic code (`naver`), while the
        // channel table stores the display-side code (`NAVER`).
        String channelCode = channel.getCode().toLowerCase(java.util.Locale.ROOT);
        // The opaque, stable per-account key the runtime binds its persistent browser profile to. Resolved
        // from the ticket's account (never sent to the wire) and minted here on first use.
        String accountSlot = accountSlots.resolveSlot(
                ticket.getOrgId(), ticket.getSellerAccountId(), ticket.getChannelId());

        if (ticket.getKind() == ReviewImportLaunchKind.DISCOVERY) {
            return new LaunchScope(ReviewImportLaunchKind.DISCOVERY, channelCode, accountSlot, null, null);
        }
        ReviewImportSegment segment = segments.findById(ticket.getSegmentId())
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
        return new LaunchScope(ReviewImportLaunchKind.SEGMENT, channelCode, accountSlot,
                segment.getSegmentStart(), segment.getSegmentEnd());
    }

    /**
     * Persist what a session-readiness probe observed for the account this ref belongs to.
     *
     * <p>The runtime posts only its opaque launch ref plus sanitized enums (state + probe moment); the
     * server resolves the ref back to the account and records readiness on the account's slot, so the
     * durable state survives an agent restart without the wire ever carrying an account id. Uses
     * {@code requireTicket} (any status) rather than {@code requireOpen}: a readiness report is diagnostic
     * and must still land after the ticket that started the run has been consumed.
     */
    @Transactional
    public void recordSessionReadiness(UUID orgId, String launchRef,
                                       SessionReadinessState state, SessionProbeReason reason) {
        ReviewImportLaunch ticket = requireTicket(orgId, launchRef);
        accountSlots.recordReadiness(
                ticket.getOrgId(), ticket.getSellerAccountId(), ticket.getChannelId(), state, reason);
    }

    /** Read a ticket for the frontend (which, unlike the runtime, already owns the plan/segment identity). */
    @Transactional(readOnly = true)
    public ReviewImportLaunch get(UUID orgId, String launchRef) {
        return requireTicket(orgId, launchRef);
    }

    /**
     * The dates a segment ticket will guide the seller to, or null for a discovery ticket (which has no
     * range yet — finding one is its whole job).
     */
    @Transactional(readOnly = true)
    public ReviewImportSegmentPlanner.DateRange requiredDatesOf(ReviewImportLaunch ticket) {
        if (ticket.getKind() != ReviewImportLaunchKind.SEGMENT || ticket.getSegmentId() == null) {
            return null;
        }
        return segments.findById(ticket.getSegmentId())
                .map(s -> new ReviewImportSegmentPlanner.DateRange(s.getSegmentStart(), s.getSegmentEnd()))
                .orElse(null);
    }

    /* ────────────────── The seller's own range selection ────────────────── */

    /**
     * What choosing {@code startMonth} would actually create — WITHOUT creating it.
     *
     * <p>Exists because the consequence of the choice is not obvious from the choice: three years of history is
     * 37 monthly segments, and each one is an export the seller performs by hand. The product owner's rule is
     * that they see the period and the segment count and confirm before a plan exists, so this is the read that
     * confirmation screen is built from.
     *
     * <p>The end date and the count are computed HERE rather than in the browser: "today" from a client clock is
     * a plan whose last segment can be wrong, and the count has to be the one the planner will really produce.
     */
    @Transactional(readOnly = true)
    public RangeSelection previewSelection(UUID orgId, UUID sellerAccountId, String startMonth) {
        sellerAccounts.findByIdAndOrgId(sellerAccountId, orgId)
                .orElseThrow(() -> ApiException.notFound("연동할 채널 계정을 찾을 수 없습니다."));
        return selectionFor(startMonth);
    }

    /**
     * Create the plan the seller chose: their start month through today, one segment per calendar month.
     *
     * <p>Spends a DISCOVERY ticket even though no run happens, and that is deliberate rather than vestigial. The
     * ticket is what makes plan creation single-use per account (V28's partial unique index) and what records
     * the provenance of the range: {@link RangeDiscoveryEvidence#OPERATOR_SELECTED}, the period, and the plan it
     * produced. A second plan for an account that is already working through one is refused — resuming is the
     * action for that, and two live plans over overlapping months would double every remaining export.
     */
    @Transactional
    public ReviewImportPlan recordSelectedRange(UUID orgId, UUID sellerAccountId, String startMonth) {
        RangeSelection selection = previewSelection(orgId, sellerAccountId, startMonth);
        for (ReviewImportPlan existing : plans.findByOrgIdAndSellerAccountIdOrderByCreatedAtDesc(orgId, sellerAccountId)) {
            if (existing.getStatus() == ReviewImportPlanStatus.DRAFT || existing.getStatus() == ReviewImportPlanStatus.ACTIVE) {
                throw ApiException.conflict("이미 진행 중인 가져오기가 있습니다. 이어서 진행해 주세요.");
            }
        }
        ReviewImportLaunch ticket = mintDiscovery(orgId, sellerAccountId);
        ReviewImportPlan plan = planService.createPlan(orgId, ticket.getSellerAccountId(), ticket.getChannelId(),
                selection.start(), selection.end());

        ticket.setDiscoveredStart(selection.start());
        ticket.setDiscoveredEnd(selection.end());
        // Never MACHINE_DISCOVERED: nothing was measured. The seller decided.
        ticket.setRangeEvidence(RangeDiscoveryEvidence.OPERATOR_SELECTED);
        ticket.setPlanId(plan.getId());
        consume(ticket);
        return plan;
    }

    /** Resolve `YYYY-MM` against today, failing closed on anything unusable. */
    private RangeSelection selectionFor(String startMonth) {
        YearMonth month = parseMonth(startMonth);
        LocalDate today = LocalDate.now(clock);
        YearMonth current = YearMonth.from(today);
        if (month.isAfter(current)) {
            throw ApiException.badRequest("아직 오지 않은 달부터 가져올 수는 없어요.");
        }
        if (month.isBefore(EARLIEST_SELECTABLE_MONTH)) {
            throw ApiException.badRequest("가져오기 시작 월이 너무 이릅니다. 더 최근 달을 선택해 주세요.");
        }
        LocalDate start = month.atDay(1);
        int segmentCount = ReviewImportSegmentPlanner.monthlySegments(start, today).size();
        return new RangeSelection(start, today, segmentCount);
    }

    private static YearMonth parseMonth(String startMonth) {
        try {
            return YearMonth.parse(startMonth == null ? "" : startMonth.trim());
        } catch (DateTimeException e) {
            throw ApiException.badRequest("가져오기를 시작할 달을 YYYY-MM 형식으로 선택해 주세요.");
        }
    }

    /**
     * A period the seller chose, and what it costs them.
     *
     * {@code segmentCount} is part of the answer rather than something the caller derives: it is the number of
     * separate exports the seller will perform, which is the fact that makes the choice a decision.
     */
    public record RangeSelection(LocalDate start, LocalDate end, int segmentCount) {
    }

    /* ─────────────────────────── Spend ─────────────────────────── */

    /**
     * Record what the discovery run found and build the plan from it: monthly segments over the range the
     * marketplace actually allows, rather than a period guessed up front. Spends the discovery ticket and
     * returns the created plan.
     *
     * <p>{@code evidence} must state how the range was established — a machine read of the live controls
     * or an operator confirmation — because the two are not interchangeable and an operator's confirmation
     * must never later be presented as something SellerOps verified.
     */
    @Transactional
    public ReviewImportPlan recordDiscoveredRange(UUID orgId, String launchRef, LocalDate start, LocalDate end,
                                                  RangeDiscoveryEvidence evidence) {
        ReviewImportLaunch ticket = requireOpen(orgId, launchRef);
        if (ticket.getKind() != ReviewImportLaunchKind.DISCOVERY) {
            throw ApiException.badRequest("범위 탐색용 요청이 아닙니다.");
        }
        if (start == null || end == null || evidence == null) {
            throw ApiException.badRequest("탐색한 기간과 근거가 필요합니다.");
        }
        if (end.isBefore(start)) {
            throw ApiException.badRequest("종료일이 시작일보다 앞설 수 없습니다.");
        }
        ReviewImportPlan plan = planService.createPlan(orgId, ticket.getSellerAccountId(), ticket.getChannelId(),
                start, end);

        ticket.setDiscoveredStart(start);
        ticket.setDiscoveredEnd(end);
        ticket.setRangeEvidence(evidence);
        ticket.setPlanId(plan.getId()); // keep the provenance of the plan this discovery produced
        consume(ticket);
        return plan;
    }

    /**
     * Ingest the file a guided segment run downloaded, into the segment its ticket is bound to, and spend
     * the ticket. The ingest itself is the existing per-segment path — dedup, reply-state/timestamp
     * preservation, attempt + sync-job linkage, and the execution/coverage rules are unchanged; this only
     * resolves WHICH segment and records HOW the scope was established.
     *
     * <p>The ticket is spent even when the ingest attempt FAILS: the authorization was for one run, and
     * that run happened. Retrying is a new authorization for a fresh run, never a replay of this one.
     */
    @Transactional
    public ReviewImportSegmentAttempt ingestForLaunch(UUID orgId, String launchRef, ScopeEvidence scopeEvidence,
                                                     String filename, InputStream data) {
        ReviewImportLaunch ticket = requireOpen(orgId, launchRef);
        if (ticket.getKind() != ReviewImportLaunchKind.SEGMENT) {
            throw ApiException.badRequest("구간 가져오기용 요청이 아닙니다.");
        }
        if (scopeEvidence == null) {
            throw ApiException.badRequest("내보내기 범위 확인 근거가 필요합니다.");
        }
        ticket.setScopeEvidence(scopeEvidence);
        consume(ticket);
        return runService.importSegment(orgId, ticket.getSegmentId(), true, scopeEvidence, filename, data);
    }

    /**
     * Give up an outstanding ticket without spending it (the seller closed the window, or is starting over).
     * Kept as EXPIRED rather than deleted so the history still shows an import was attempted, and so a
     * fresh ticket can be issued without colliding with V28's partial unique index.
     */
    @Transactional
    public ReviewImportLaunch expire(UUID orgId, String launchRef) {
        ReviewImportLaunch ticket = requireTicket(orgId, launchRef);
        if (ticket.getStatus() == ReviewImportLaunchStatus.CONSUMED) {
            throw ApiException.conflict("이미 완료된 요청입니다.");
        }
        ticket.setStatus(ReviewImportLaunchStatus.EXPIRED);
        return launches.save(ticket);
    }

    /* ─────────────────────────── Internals ─────────────────────────── */

    /**
     * The MOST RECENT live segment still needing a run: PENDING or retryable FAILED, and not concluded MISSING.
     *
     * <p>Newest first (product-owner decision, 2026-07-26), reversing the original oldest-first order. Two
     * reasons, both about a seller who may stop part-way through 37 manual exports: the recent months are the
     * ones whose reviews still need answering, so the value arrives in the first segment rather than the last;
     * and the current month is the segment that keeps growing, so importing it while it is fresh is worth more
     * than importing it after the older ones. A seller who abandons a plan half-done is left holding the half
     * that matters.
     */
    @Transactional(readOnly = true)
    public Optional<ReviewImportSegment> nextRemainingSegment(UUID orgId, UUID planId) {
        planService.getPlan(orgId, planId); // authorize
        return selectNextRemaining(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId));
    }

    /**
     * The ONE rule for which live segment gets the next ticket: the NEWEST still-remaining, non-MISSING one.
     *
     * Pure and shared on purpose. Both the mint (this service) and the read side (the plan detail's
     * {@code nextSegmentId}, via {@code ReviewImportQueryService}) select through here, so the segment the card
     * shows as "next" is always the exact segment the ticket authorizes — the card can never name one month
     * while the ticket names another.
     *
     * @param liveAsc the plan's non-superseded segments in ascending start order
     */
    public static Optional<ReviewImportSegment> selectNextRemaining(List<ReviewImportSegment> liveAsc) {
        return liveAsc.stream()
                .filter(s -> s.getExecutionState().isRemaining())
                .filter(s -> s.getCoverageState() != SegmentCoverageState.MISSING)
                .reduce((earlier, later) -> later);
    }

    private ReviewImportLaunch requireTicket(UUID orgId, String launchRef) {
        ReviewImportLaunch ticket = launches.findByLaunchRef(launchRef)
                .orElseThrow(() -> ApiException.notFound("가져오기 요청을 찾을 수 없습니다."));
        if (!ticket.getOrgId().equals(orgId)) {
            // Same message as a miss: a caller must not be able to tell "wrong org" from "no such ref".
            throw ApiException.notFound("가져오기 요청을 찾을 수 없습니다.");
        }
        return ticket;
    }

    private ReviewImportLaunch requireOpen(UUID orgId, String launchRef) {
        ReviewImportLaunch ticket = requireTicket(orgId, launchRef);
        if (!ticket.isOpen()) {
            throw ApiException.conflict("이미 사용된 가져오기 요청입니다. 다시 시작해 주세요.");
        }
        return ticket;
    }

    private void consume(ReviewImportLaunch ticket) {
        ticket.setStatus(ReviewImportLaunchStatus.CONSUMED);
        ticket.setConsumedAt(Instant.now());
        launches.save(ticket);
    }

    private static ReviewImportLaunch newTicket(UUID orgId, UUID sellerAccountId, UUID channelId,
                                                ReviewImportLaunchKind kind, UUID planId, UUID segmentId) {
        ReviewImportLaunch t = new ReviewImportLaunch();
        t.setOrgId(orgId);
        t.setSellerAccountId(sellerAccountId);
        t.setChannelId(channelId);
        t.setLaunchRef(newLaunchRef());
        t.setKind(kind);
        t.setPlanId(planId);
        t.setSegmentId(segmentId);
        t.setStatus(ReviewImportLaunchStatus.ISSUED);
        t.setIssuedAt(Instant.now());
        return t;
    }

    /**
     * A fresh opaque 16-hex ref. 8 random bytes from a CSPRNG: it is presented as the authorization for a
     * run, so it must be unguessable, and 16 hex is exactly the shape the Action Window contract accepts.
     */
    static String newLaunchRef() {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    /**
     * Sanitized scope for the runtime: no plan/segment/account identity. {@code accountSlot} is the opaque,
     * stable per-account key the runtime binds its persistent profile to — a surrogate the server owns, not
     * an identity.
     */
    public record LaunchScope(ReviewImportLaunchKind kind, String channelCode, String accountSlot,
                              LocalDate requiredStart, LocalDate requiredEnd) {
    }
}
