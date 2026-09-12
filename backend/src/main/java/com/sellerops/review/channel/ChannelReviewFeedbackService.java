package com.sellerops.review.channel;

import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.review.channel.dto.TriageFeedbackRequests;
import com.sellerops.review.triage.ReviewTriageChannelCapability;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.feedback.TriageAction;
import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageActionRepository;
import com.sellerops.review.triage.feedback.TriageBehaviorEventRepository;
import com.sellerops.review.triage.feedback.TriageCorrection;
import com.sellerops.review.triage.feedback.TriageCorrectionRepository;
import com.sellerops.review.triage.feedback.TriageEventKind;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.pilot.AiTriagePilotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The channel review record's feedback write path: resolves the review the seller is looking at,
 * org- and channel-scoped exactly as {@link ChannelReviewService#detail} does, and hands the rating
 * and body — the same two things the classifier saw — to {@link TriageFeedbackService}.
 *
 * <p><b>The body passes through this class in memory and lands nowhere.</b> The feedback service
 * needs it to compute the rule's own tier for the row (what was SHOWN); it is not stored, not
 * logged, and not returned.
 *
 * <p><b>Nothing here touches a marketplace</b>, and nothing here changes a tier: an action recorded
 * as {@code COMPLETED} does not move the review, hide it, or mark it done on any surface. Feedback
 * is written to be measured — the human-in-the-loop boundary is exactly where it was.
 */
@Service
public class ChannelReviewFeedbackService {

    /** A behaviour batch larger than this is a client writing a table, not reporting a screen. */
    static final int MAX_BEHAVIOR_BATCH = 200;

    private final ReviewRepository reviews;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final TriageFeedbackService feedback;
    private final AiTriagePilotService pilot;
    private final TriageCorrectionRepository corrections;
    private final TriageActionRepository actions;
    private final TriageBehaviorEventRepository behavior;

    public ChannelReviewFeedbackService(ReviewRepository reviews, SellerAccountRepository accounts,
                                        ChannelRepository channels, TriageFeedbackService feedback,
                                        AiTriagePilotService pilot, TriageCorrectionRepository corrections,
                                        TriageActionRepository actions, TriageBehaviorEventRepository behavior) {
        this.reviews = reviews;
        this.accounts = accounts;
        this.channels = channels;
        this.feedback = feedback;
        this.pilot = pilot;
        this.corrections = corrections;
        this.actions = actions;
        this.behavior = behavior;
    }

    /**
     * The contract-§1 door, once, for every route here: an account on a channel outside the three
     * gets a 404 — the same answer as a review that is not there — and the channel's capability row
     * for everything inside, so each route can refuse the kinds this channel cannot produce.
     */
    private ReviewTriageChannelCapability requireCapability(SellerAccount account) {
        String code = channels.findById(account.getChannelId()).map(Channel::getCode).orElse(null);
        ReviewTriageChannelCapability capability = ReviewTriageChannelCapability.of(code);
        if (!capability.inContract()) {
            // Not "the pilot does not cover this channel" any more: these routes now carry the
            // seller's own corrections, which have nothing to do with the pilot. Same 404, same
            // reason (§1), a sentence that is true of what is actually being refused.
            throw ApiException.notFound("이 채널은 상품평 분류 기록을 지원하지 않습니다.");
        }
        return capability;
    }

    /**
     * The seller states their own judgment for one review.
     *
     * <p><b>Not gated on the AI pilot.</b> {@code pilot.isEnabledFor} is passed to the feedback
     * service for one purpose only — resolving what was on SCREEN, so the row can say whether the
     * seller was disagreeing with the rule or with the pilot's mark. It is not permission. A
     * rule-tiered review on an org with no pilot has always been correctable here; what was missing
     * was a control on the screen, and that is where the coupling actually was.
     */
    public TriageFeedbackRequests.CorrectionView correct(UUID orgId, UUID accountId, UUID reviewId,
                                                         TriageFeedbackRequests.Correction request, UUID actorId) {
        if (request == null || request.tier() == null || request.tier().isBlank()) {
            // A strong-evidence row from an absent field would be evidence of nothing.
            throw ApiException.badRequest("판매자 판단을 선택해 주세요.");
        }
        SellerAccount account = requireAccount(orgId, accountId);
        requireCapability(account);
        Review review = requireReview(orgId, account, reviewId);
        TriageCorrection row = feedback.correctReview(orgId, reviewId, review.getRating(), review.getBody(),
                ReviewTriageTier.parse(request.tier()), request.reasonCode(), pilot.isEnabledFor(orgId), actorId);
        return viewOf(row, feedback.correctionHistory(reviewId).size());
    }

    /**
     * The seller takes their correction back — 되돌리기.
     *
     * <p>Returns null, which is the whole answer: there is no standing seller judgment for this
     * review any more and the screen reads as the system's alone. The row and its trail survive; see
     * {@code TriageFeedbackService.withdrawCorrection} for why a withdrawal is not a delete.
     */
    public TriageFeedbackRequests.CorrectionView withdraw(UUID orgId, UUID accountId, UUID reviewId, UUID actorId) {
        SellerAccount account = requireAccount(orgId, accountId);
        requireCapability(account);
        Review review = requireReview(orgId, account, reviewId);
        feedback.withdrawCorrection(orgId, review.getId(), actorId);
        return null;
    }

    /** One review's correction trail, oldest first. */
    public List<TriageFeedbackRequests.CorrectionHistoryView> correctionHistory(UUID orgId, UUID accountId,
                                                                                UUID reviewId) {
        SellerAccount account = requireAccount(orgId, accountId);
        requireCapability(account);
        Review review = requireReview(orgId, account, reviewId);
        return feedback.correctionHistory(review.getId()).stream()
                .map(a -> new TriageFeedbackRequests.CorrectionHistoryView(a.getKind().name(),
                        name(a.getTierFrom()), name(a.getTierTo()), name(a.getShownTier()),
                        name(a.getShownSource()), a.getDecidedAt()))
                .toList();
    }

    /**
     * A standing correction as the surface reads it, or null when none stands.
     *
     * <p>One mapper, shared by the write echo and both read paths, so "what the seller corrected this
     * to" cannot be two different sentences depending on which request rendered it.
     */
    public static TriageFeedbackRequests.CorrectionView viewOf(TriageCorrection row, int changeCount) {
        if (row == null || !row.stands()) {
            return null;
        }
        return new TriageFeedbackRequests.CorrectionView(row.getReviewId(),
                row.getCorrectedTier().name(), row.getCorrectedReasonCode(),
                name(row.getShownTier()), name(row.getShownSource()), row.getCorrectedAt(), changeCount);
    }

    public void act(UUID orgId, UUID accountId, UUID reviewId, TriageActionKind kind, UUID actorId) {
        if (kind == null) {
            throw ApiException.badRequest("조치 종류가 필요합니다.");
        }
        SellerAccount account = requireAccount(orgId, accountId);
        if (!requireCapability(account).permits(kind)) {
            // Contract §2.2: a REPLY_* on a channel with no reply flow is refused, not stored with a
            // flag. Coupang has no reply feature at all; recording one would be the fake the contract
            // forbids by name.
            throw ApiException.badRequest("이 채널에서는 기록할 수 없는 조치 종류입니다.");
        }
        Review review = requireReview(orgId, account, reviewId);
        TriageAction ignored = feedback.act(orgId, reviewId, review.getRating(), review.getBody(), kind, actorId,
                pilot.isEnabledFor(orgId));
    }

    /**
     * A batch of silver. Rows the org does not own, or that are not on this account's channel, are
     * dropped silently rather than refused: a stale tab reporting exposure of a row that has since
     * moved is not an error worth failing the whole batch for, and silver is not worth a 400.
     */
    public TriageFeedbackRequests.BehaviorResult observe(UUID orgId, UUID accountId,
                                                         TriageFeedbackRequests.Behavior request) {
        if (request == null || request.events() == null || request.events().isEmpty()) {
            return new TriageFeedbackRequests.BehaviorResult(0);
        }
        if (request.events().size() > MAX_BEHAVIOR_BATCH) {
            throw ApiException.badRequest("한 번에 기록할 수 있는 항목 수를 넘었습니다.");
        }
        SellerAccount account = requireAccount(orgId, accountId);
        ReviewTriageChannelCapability capability = requireCapability(account);
        // One org-scoped batch read for the whole request, then filter to this account's channel.
        List<UUID> ids = request.events().stream()
                .filter(e -> e != null && e.reviewId() != null && e.kind() != null)
                .map(TriageFeedbackRequests.Behavior.Event::reviewId).distinct().toList();
        java.util.Map<UUID, Review> owned = new java.util.HashMap<>();
        for (Review r : reviews.findByOrgIdAndIdIn(orgId, ids)) {
            if (account.getChannelId().equals(r.getChannelId())) {
                owned.put(r.getId(), r);
            }
        }
        List<TriageFeedbackService.Observation> observations = new ArrayList<>(request.events().size());
        for (TriageFeedbackRequests.Behavior.Event e : request.events()) {
            Review r = e == null || e.kind() == null ? null : owned.get(e.reviewId());
            // Silver a channel cannot produce (ORIGINAL_OPENED where there is no original surface) is
            // dropped like an unowned row — not worth a 400, and never worth a row.
            if (r != null && capability.permits(e.kind())) {
                observations.add(new TriageFeedbackService.Observation(r.getId(), r.getRating(), r.getBody(), e.kind()));
            }
        }
        return new TriageFeedbackRequests.BehaviorResult(
                feedback.observe(orgId, observations, pilot.isEnabledFor(orgId)));
    }

    /**
     * The review's events, oldest first, in the contract's vocabulary — the four records of contract
     * §3 read together for one review, and nothing that would let a reader distinguish "unanswered"
     * from anything else: absence stays absence.
     */
    public List<TriageFeedbackRequests.EventView> events(UUID orgId, UUID accountId, UUID reviewId) {
        SellerAccount account = requireAccount(orgId, accountId);
        requireCapability(account);
        Review review = requireReview(orgId, account, reviewId);
        List<TriageFeedbackRequests.EventView> out = new ArrayList<>();
        for (var e : behavior.findByReviewIdOrderByOccurredAtAsc(review.getId())) {
            out.add(new TriageFeedbackRequests.EventView(TriageEventKind.of(e.getKind()), name(e.getShownSource()),
                    name(e.getShownTier()), e.getOccurredAt()));
        }
        for (var a : actions.findByReviewIdOrderByActedAtDesc(review.getId())) {
            out.add(new TriageFeedbackRequests.EventView(TriageEventKind.of(a.getKind()), name(a.getShownSource()),
                    name(a.getShownTier()), a.getActedAt()));
        }
        // STANDING only. A withdrawn correction is not an event: contract §2.3 already says absence is
        // not one, and a taken-back answer is an absence of an answer rather than a weaker kind of one.
        // The withdrawal itself is in the correction trail, which is Decision Data and not this list.
        corrections.findByReviewId(review.getId()).filter(TriageCorrection::stands)
                .ifPresent(c -> out.add(new TriageFeedbackRequests.EventView(
                        TriageEventKind.of(c), name(c.getShownSource()), name(c.getShownTier()), c.getCorrectedAt())));
        out.sort(java.util.Comparator.comparing(TriageFeedbackRequests.EventView::at,
                java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())));
        return out;
    }

    private static String name(Enum<?> e) {
        return e == null ? null : e.name();
    }

    private Review requireReview(UUID orgId, SellerAccount account, UUID reviewId) {
        return reviews.findByIdAndOrgId(reviewId, orgId)
                .filter(r -> account.getChannelId().equals(r.getChannelId()))
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));
    }

    private SellerAccount requireAccount(UUID orgId, UUID accountId) {
        return accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }
}
