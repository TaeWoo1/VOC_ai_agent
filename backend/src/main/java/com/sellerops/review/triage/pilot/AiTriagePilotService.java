package com.sellerops.review.triage.pilot;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.ReviewTriageChannelCapability;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.triage.feedback.TriageActionKind;
import com.sellerops.review.triage.feedback.TriageBehaviorKind;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.llm.ApiTriageClassifier;
import com.sellerops.review.triage.llm.ReviewTriageChannelGate;
import com.sellerops.review.triage.llm.ReviewTriageClassifier;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Runs the frozen candidate over an account's reviews and records what it said. RUBRIC v2 §13.7.
 *
 * <p><b>Bounded, operator-triggered, and additive.</b> A run classifies at most
 * {@link AiTriagePilotProperties#maxPerRun()} reviews the pilot has not yet seen under the current
 * classifier version, records every answer — including failures — through
 * {@link TriageFeedbackService#record}, and stops. Nothing here changes a review, and nothing here
 * can lower a tier: the only thing the read path consults is the additive mark that method writes.
 *
 * <p><b>The channel is checked at the boundary, not here.</b> This service does not compare channel
 * codes against a list of its own; it hands the code to {@link ReviewTriageChannelGate}, which refuses
 * anything outside {@link ReviewTriageChannelCapability}'s three channels as {@code UNCLASSIFIED}. The
 * refusal is still recorded — a run that quietly did nothing on such an account would look identical
 * to a run that classified it and found nothing. The one thing this service does with the code is the
 * contract-§1 door: an account on a channel outside the contract gets a 404 from run and funnel alike,
 * before any pending row is even counted.
 *
 * <p><b>No marketplace write, ever.</b> The pilot reads stored reviews and writes to SellerOps' own
 * tables. The human-in-the-loop boundary is untouched.
 */
@Service
public class AiTriagePilotService {

    /** What one run did. Counts only — no content, no ids. */
    public record RunResult(String classifierVersion, int considered, int classified, int marked, int failed,
                            int refused, int remaining) {
    }

    /**
     * The pilot's funnel for one account — DISTINCT reviews at each step, over the reviews the pilot
     * currently marks on that account's channel.
     *
     * <p><b>Ignore is not a number here.</b> {@code aiAttentionShown - reviewOpened} is how many marked
     * reviews were rendered and not opened; that is reported as two rows and never as a step called
     * "ignored", because a review nobody opened is a review nobody has said anything about
     * (feedback draft §7.2). {@code aiAgree} and {@code aiDisagree} are the seller's explicit answers to
     * an AI-shown row; every other row is unanswered, not negative.
     *
     * <p>Counts, not rates. A rate over a dozen rows would read as a measurement, and §13.7 item 7
     * says nothing the pilot produces is one.
     */
    public record Funnel(String classifierVersion, String channelCode, long marked, long aiAttentionShown,
                         long reviewOpened, long originalOpened, long marketplaceLocated, long aiAgree,
                         long aiDisagree, long actionStarted, long actionCompleted, long actionNotNeeded,
                         long replyDrafted, long replySubmitted) {
        static Funnel empty(String version, String channelCode) {
            return new Funnel(version, channelCode, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
    }

    private final AiTriagePilotProperties properties;
    private final ReviewRepository reviews;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final AiTriageCurrentRepository current;
    private final TriageFeedbackService feedback;
    private final ReviewTriageChannelGate gate;
    private final com.sellerops.review.triage.feedback.TriageCorrectionRepository corrections;
    private final com.sellerops.review.triage.feedback.TriageActionRepository actions;
    private final com.sellerops.review.triage.feedback.TriageBehaviorEventRepository behavior;

    @Autowired
    public AiTriagePilotService(AiTriagePilotProperties properties, ReviewRepository reviews,
                                SellerAccountRepository accounts, ChannelRepository channels,
                                AiTriageCurrentRepository current, TriageFeedbackService feedback,
                                com.sellerops.review.triage.feedback.TriageCorrectionRepository corrections,
                                com.sellerops.review.triage.feedback.TriageActionRepository actions,
                                com.sellerops.review.triage.feedback.TriageBehaviorEventRepository behavior) {
        this(properties, reviews, accounts, channels, current, feedback,
                properties.enabled() ? gateFrom(properties) : null, corrections, actions, behavior);
    }

    /** Test seam: a gate whose classifier is a fake, or null for "off". Public so read-path tests can compose it. */
    public AiTriagePilotService(AiTriagePilotProperties properties, ReviewRepository reviews,
                                SellerAccountRepository accounts, ChannelRepository channels,
                                AiTriageCurrentRepository current, TriageFeedbackService feedback,
                                ReviewTriageChannelGate gate) {
        this(properties, reviews, accounts, channels, current, feedback, gate, null, null, null);
    }

    private AiTriagePilotService(AiTriagePilotProperties properties, ReviewRepository reviews,
                                 SellerAccountRepository accounts, ChannelRepository channels,
                                 AiTriageCurrentRepository current, TriageFeedbackService feedback,
                                 ReviewTriageChannelGate gate,
                                 com.sellerops.review.triage.feedback.TriageCorrectionRepository corrections,
                                 com.sellerops.review.triage.feedback.TriageActionRepository actions,
                                 com.sellerops.review.triage.feedback.TriageBehaviorEventRepository behavior) {
        this.properties = properties;
        this.reviews = reviews;
        this.accounts = accounts;
        this.channels = channels;
        this.current = current;
        this.feedback = feedback;
        this.gate = gate;
        this.corrections = corrections;
        this.actions = actions;
        this.behavior = behavior;
    }

    public Funnel funnel(UUID orgId, UUID accountId) {
        SellerAccount account = accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        String channelCode = channelCodeOf(account);
        requireInContract(channelCode);
        String version = classifierVersion();
        if (!isEnabledFor(orgId)) {
            // A switched-off org has no funnel: nothing is shown, so nothing is a step.
            return Funnel.empty(version, channelCode);
        }
        // The population: reviews on this account's channel the pilot currently marks — one query.
        List<UUID> marked = current.findMarkedReviewIds(orgId, account.getChannelId());
        if (marked.isEmpty()) {
            return Funnel.empty(version, channelCode);
        }
        var shown = com.sellerops.review.triage.feedback.TriageShownSource.AI;
        long agree = 0;
        long disagree = 0;
        for (var c : corrections.findByOrgIdAndShownSourceAndReviewIdIn(orgId, shown, marked)) {
            if (c.getCorrectedTier() == com.sellerops.review.triage.ReviewTriageTier.NEEDS_ATTENTION) {
                agree++;
            } else {
                disagree++;
            }
        }
        return new Funnel(version, channelCode, marked.size(),
                behavior.countDistinctReviews(orgId, TriageBehaviorKind.AI_ATTENTION_SHOWN, shown, marked),
                behavior.countDistinctReviews(orgId, TriageBehaviorKind.REVIEW_OPENED, shown, marked),
                behavior.countDistinctReviews(orgId, TriageBehaviorKind.ORIGINAL_OPENED, shown, marked),
                behavior.countDistinctReviews(orgId, TriageBehaviorKind.MARKETPLACE_LOCATED, shown, marked),
                agree, disagree,
                actions.countDistinctReviews(orgId, TriageActionKind.ACTION_STARTED, shown, marked),
                actions.countDistinctReviews(orgId, TriageActionKind.ACTION_COMPLETED, shown, marked),
                actions.countDistinctReviews(orgId, TriageActionKind.ACTION_NOT_NEEDED, shown, marked),
                actions.countDistinctReviews(orgId, TriageActionKind.REPLY_DRAFTED, shown, marked),
                actions.countDistinctReviews(orgId, TriageActionKind.REPLY_SUBMITTED, shown, marked));
    }

    private String channelCodeOf(SellerAccount account) {
        return channels.findById(account.getChannelId()).map(Channel::getCode).orElse("UNKNOWN");
    }

    /**
     * Contract §1: outside the three channels there is no endpoint. Not "disabled" — a 404, the same
     * answer the surface gives for a review that is not there, so a client cannot learn from the shape
     * of the refusal that a pilot exists for other channels.
     */
    private static void requireInContract(String channelCode) {
        if (!ReviewTriageChannelCapability.of(channelCode).inContract()) {
            throw ApiException.notFound("이 채널은 AI 분류 파일럿 대상이 아닙니다.");
        }
    }

    private static ReviewTriageChannelGate gateFrom(AiTriagePilotProperties p) {
        return ReviewTriageChannelGate.forApi(
                ApiTriageClassifier.Vendor.valueOf(p.vendor()), p.model(), p.apiKey(),
                new ApiTriageClassifier.Tuning(!p.omitTemperature(), p.maxOutputTokens(), p.reasoningEffort()));
    }

    /** Whether the surface may show the pilot's mark for this org. Read by the list, so it is cheap. */
    public boolean isEnabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId) && gate != null;
    }

    /** The version a run would stamp, or null while the pilot is off. */
    public String classifierVersion() {
        return gate == null ? null : gate.version();
    }

    /**
     * Classify the account's reviews the pilot has not yet seen under the current version, newest
     * first, up to {@code limit} — clamped to the configured run bound, never above it.
     *
     * <p>{@code limit} is the operator's per-press choice ("50 this time"); the configured
     * {@code maxPerRun} is the ceiling nobody at a keyboard can raise. Both exist so the pilot's
     * spend is a number someone typed and a number someone configured, and the smaller wins.
     */
    public RunResult run(UUID orgId, UUID accountId, Integer limit) {
        if (!isEnabledFor(orgId)) {
            throw ApiException.badRequest("AI 분류 파일럿이 이 조직에서 활성화되어 있지 않습니다.");
        }
        // One run per account at a time. Two concurrent POSTs would read the same pending set,
        // spend the vendor twice on it, and race in refreshCurrent against the unique index.
        // A refused second press is a 409 with a sentence, not a duplicated bill.
        java.util.concurrent.locks.Lock lock = runLocks.computeIfAbsent(accountId,
                k -> new java.util.concurrent.locks.ReentrantLock());
        if (!lock.tryLock()) {
            throw ApiException.conflict("이 계정에서 AI 분류가 이미 실행 중입니다. 끝난 뒤 다시 눌러 주세요.");
        }
        try {
            return runLocked(orgId, accountId, limit);
        } finally {
            lock.unlock();
        }
    }

    private final java.util.concurrent.ConcurrentHashMap<UUID, java.util.concurrent.locks.Lock> runLocks =
            new java.util.concurrent.ConcurrentHashMap<>();

    private RunResult runLocked(UUID orgId, UUID accountId, Integer limit) {
        SellerAccount account = accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        String channelCode = channelCodeOf(account);
        requireInContract(channelCode);
        String version = gate.version();

        int bound = limit == null || limit <= 0 ? properties.maxPerRun() : Math.min(limit, properties.maxPerRun());
        List<Review> pending = reviews.findPendingAiTriage(orgId, account.getChannelId(), version,
                org.springframework.data.domain.PageRequest.of(0, bound));
        long remaining = reviews.countPendingAiTriage(orgId, account.getChannelId(), version);

        int classified = 0;
        int marked = 0;
        int failed = 0;
        int refused = 0;
        for (Review review : pending) {
            ReviewTriageClassifier.Result result = gate.classify(channelCode, review.getRating(), review.getBody());
            feedback.record(orgId, review.getId(), review.getRating(), review.getBody(),
                    properties.model(), result);
            switch (result.status()) {
                case OK -> {
                    classified++;
                    if (current.findByReviewId(review.getId()).map(c -> c.isAiAttention()).orElse(false)) {
                        marked++;
                    }
                }
                // UNCLASSIFIED is what the gate returns for a forbidden channel AND what the parser
                // returns for a schema-invalid answer. Only the first is a refusal; the second is a
                // failure on a permitted channel and is counted as one (independent review, D5).
                case UNCLASSIFIED -> {
                    if (ReviewTriageChannelGate.permits(channelCode)) {
                        failed++;
                    } else {
                        refused++;
                    }
                }
                case CLASSIFICATION_FAILED -> failed++;
            }
        }
        return new RunResult(version, pending.size(), classified, marked, failed, refused,
                (int) Math.max(0, remaining - pending.size()));
    }
}
