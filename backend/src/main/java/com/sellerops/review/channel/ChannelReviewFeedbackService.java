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
            throw ApiException.notFound("이 채널은 AI 분류 파일럿 대상이 아닙니다.");
        }
        return capability;
    }

    public TriageFeedbackRequests.CorrectionView correct(UUID orgId, UUID accountId, UUID reviewId,
                                                         TriageFeedbackRequests.Correction request) {
        if (request == null || request.needsAttention() == null) {
            // A strong-evidence row from an absent field would be evidence of nothing.
            throw ApiException.badRequest("확인 필요 여부가 필요합니다.");
        }
        SellerAccount account = requireAccount(orgId, accountId);
        requireCapability(account);
        Review review = requireReview(orgId, account, reviewId);
        TriageCorrection row = feedback.correctReview(orgId, reviewId, review.getRating(), review.getBody(),
                request.needsAttention(), request.reasonCode(), pilot.isEnabledFor(orgId));
        return new TriageFeedbackRequests.CorrectionView(reviewId,
                row.getCorrectedTier() == ReviewTriageTier.NEEDS_ATTENTION,
                row.getCorrectedReasonCode(),
                row.getShownSource() == null ? null : row.getShownSource().name());
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
        corrections.findByReviewId(review.getId()).ifPresent(c -> out.add(new TriageFeedbackRequests.EventView(
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
