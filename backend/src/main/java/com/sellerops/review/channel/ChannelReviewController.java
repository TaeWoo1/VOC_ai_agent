package com.sellerops.review.channel;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.review.channel.dto.ChannelReviewDetailView;
import com.sellerops.review.channel.dto.ChannelReviewLocateRunResponse;
import com.sellerops.review.channel.dto.ChannelReviewPageView;
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import java.util.UUID;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The channel review record for one connected account — list, detail, and the one thing a seller can ask
 * SellerOps to DO with a 상품평: show it to them on Coupang's own screen.
 *
 * <p>There is still no reply endpoint here, and its absence is the design: Coupang gives sellers no way to
 * answer a 상품평, so a draft or submit route would be an affordance for a capability the channel does not
 * have. The reply surfaces that exist elsewhere are bound to channels that can actually post.
 *
 * <p>The locate route mints a binding; it opens nothing and reads nothing. What acts on it is the seller's
 * own Local Agent, which resolves the ref over its own session and then only reads and rings.
 *
 * <p>{@code orgId} always comes from the authenticated principal, never the client, like every sibling read.
 */
@RestController
@RequestMapping("/api/seller-accounts/{accountId}/channel-reviews")
public class ChannelReviewController {

    private final ChannelReviewService service;
    private final ChannelReviewLocateService locates;
    private final ChannelReviewFeedbackService feedback;
    private final AiTriagePilotService pilot;

    public ChannelReviewController(ChannelReviewService service, ChannelReviewLocateService locates,
                                   ChannelReviewFeedbackService feedback, AiTriagePilotService pilot) {
        this.service = service;
        this.locates = locates;
        this.feedback = feedback;
        this.pilot = pilot;
    }

    /**
     * One page of this account's reviews.
     *
     * <p>{@code sort} is {@code attention} (default — 확인 필요 우선), {@code newest} or {@code lowest}.
     * {@code tier} optionally narrows to one triage tier; absent means the whole record, which is the
     * default because this surface is a record and hiding part of it by default would make the seller's
     * own VOC depend on a filter they never set.
     */
    @GetMapping
    public ChannelReviewPageView list(@AuthenticationPrincipal AuthPrincipal principal,
                                      @PathVariable UUID accountId,
                                      @RequestParam(required = false) String sort,
                                      @RequestParam(required = false) String tier,
                                      @RequestParam(defaultValue = "0") int page,
                                      @RequestParam(defaultValue = "20") int size) {
        return service.list(principal.orgId(), accountId, sort, tier, page, size);
    }

    /** One review in full, with the locate target `[쿠팡에서 보기]` re-finds it on the seller's screen by. */
    @GetMapping("/{reviewId}")
    public ChannelReviewDetailView detail(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable UUID accountId,
                                          @PathVariable UUID reviewId) {
        return service.detail(principal.orgId(), accountId, reviewId);
    }

    /**
     * The seller pressed {@code [쿠팡에서 보기]}: mint the single-use {@code locateRef} their browser passes
     * into the Action Window {@code START_RUN}.
     *
     * <p>A POST because it mints state, not because anything is submitted anywhere — the marketplace is not
     * touched by this call, or by the run it starts.
     */
    @PostMapping("/{reviewId}/locate-runs")
    public ChannelReviewLocateRunResponse startLocateRun(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable UUID accountId,
                                                         @PathVariable UUID reviewId) {
        return locates.mint(principal.orgId(), accountId, reviewId, principal.userId());
    }

    // ── RUBRIC v2 §13.7 — the conservative pilot's feedback spine ──────────────────────────────
    //
    // Three write routes of decreasing evidential weight, and one operator-triggered run. None of
    // them touches a marketplace, changes a tier, hides a row or marks anything done. They record.

    /** The seller's answer: 확인 필요, or 필요 없음. Strong evidence; supersedes their previous answer. */
    @PostMapping("/{reviewId}/triage-feedback/correction")
    public TriageFeedbackRequests.CorrectionView correct(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable UUID accountId,
                                                         @PathVariable UUID reviewId,
                                                         @RequestBody TriageFeedbackRequests.Correction request) {
        return feedback.correct(principal.orgId(), accountId, reviewId, request);
    }

    /** The seller acted: started, completed, or declared not needed. Strong evidence; append-only. */
    @PostMapping("/{reviewId}/triage-feedback/actions")
    public void act(@AuthenticationPrincipal AuthPrincipal principal,
                    @PathVariable UUID accountId,
                    @PathVariable UUID reviewId,
                    @RequestBody TriageFeedbackRequests.Action request) {
        feedback.act(principal.orgId(), accountId, reviewId, request == null ? null : request.kind(),
                principal.userId());
    }

    /**
     * What the seller did on the way — exposed, opened, viewed the original. Silver, batched, never
     * a label. There is deliberately no route to report "ignored".
     */
    @PostMapping("/triage-feedback/behavior")
    public TriageFeedbackRequests.BehaviorResult observe(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @PathVariable UUID accountId,
                                                         @RequestBody TriageFeedbackRequests.Behavior request) {
        return feedback.observe(principal.orgId(), accountId, request);
    }

    /**
     * Run the frozen candidate over this account's not-yet-classified reviews, bounded. A POST that
     * sends review bodies to the configured vendor under §8.3 — for a NAVER account of an opted-in
     * org, and refused as UNCLASSIFIED for anything else. Reads stored reviews, writes SellerOps' own
     * tables, touches no marketplace.
     */
    @PostMapping("/ai-triage/runs")
    public AiTriagePilotService.RunResult runAiTriage(@AuthenticationPrincipal AuthPrincipal principal,
                                                      @PathVariable UUID accountId,
                                                      @RequestParam(required = false) Integer limit) {
        return pilot.run(principal.orgId(), accountId, limit);
    }

    /**
     * The pilot's funnel for this account — counts of DISTINCT reviews at each step, from
     * {@code AI_ATTENTION_SHOWN} down to {@code ACTION_COMPLETED}. Read-only. What is NOT here is any
     * "ignored" number: a review shown and not opened is a review nobody has said anything about,
     * and it is reported as the difference between two rows, never as a verdict.
     */
    @GetMapping("/ai-triage/funnel")
    public AiTriagePilotService.Funnel aiTriageFunnel(@AuthenticationPrincipal AuthPrincipal principal,
                                                      @PathVariable UUID accountId) {
        return pilot.funnel(principal.orgId(), accountId);
    }
}
