package com.sellerops.reviewimport;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.io.InputStream;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
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
 * <p><b>The two kinds are a consequence, not a preference.</b> A seller's first click has no plan to point
 * at: the plan is built from whatever historical range the marketplace turns out to allow. So DISCOVERY
 * runs first with no plan, and {@link #recordDiscoveredRange} is what creates the plan and its monthly
 * segments. Only then can SEGMENT tickets exist.
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

    public ReviewImportLaunchService(ReviewImportLaunchRepository launches,
                                    ReviewImportPlanRepository plans,
                                    ReviewImportSegmentRepository segments,
                                    ReviewImportPlanService planService,
                                    ReviewImportRunService runService,
                                    SellerAccountRepository sellerAccounts,
                                    ChannelRepository channels) {
        this.launches = launches;
        this.plans = plans;
        this.segments = segments;
        this.planService = planService;
        this.runService = runService;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
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
     * What the runtime is allowed to know: the kind of run, the channel to open, and — for a segment — the
     * exact dates to guide the seller to. Deliberately carries no plan/segment/account id: the runtime has
     * no use for them, and everything it does flows back through the ref.
     */
    @Transactional(readOnly = true)
    public LaunchScope resolveScope(UUID orgId, String launchRef) {
        ReviewImportLaunch ticket = requireOpen(orgId, launchRef);
        Channel channel = channels.findById(ticket.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        // The Action Window contract's channelCode is a lowercase semantic code (`naver`), while the
        // channel table stores the display-side code (`NAVER`).
        String channelCode = channel.getCode().toLowerCase(java.util.Locale.ROOT);

        if (ticket.getKind() == ReviewImportLaunchKind.DISCOVERY) {
            return new LaunchScope(ReviewImportLaunchKind.DISCOVERY, channelCode, null, null);
        }
        ReviewImportSegment segment = segments.findById(ticket.getSegmentId())
                .orElseThrow(() -> ApiException.notFound("구간을 찾을 수 없습니다."));
        return new LaunchScope(ReviewImportLaunchKind.SEGMENT, channelCode,
                segment.getSegmentStart(), segment.getSegmentEnd());
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

    /** The earliest live segment still needing a run: PENDING or retryable FAILED, and not concluded MISSING. */
    @Transactional(readOnly = true)
    public Optional<ReviewImportSegment> nextRemainingSegment(UUID orgId, UUID planId) {
        planService.getPlan(orgId, planId); // authorize
        List<ReviewImportSegment> live =
                segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId);
        return live.stream()
                .filter(s -> s.getExecutionState().isRemaining())
                .filter(s -> s.getCoverageState() != SegmentCoverageState.MISSING)
                .findFirst();
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

    /** Sanitized scope for the runtime: no plan/segment/account identity, just what to guide. */
    public record LaunchScope(ReviewImportLaunchKind kind, String channelCode,
                              LocalDate requiredStart, LocalDate requiredEnd) {
    }
}
