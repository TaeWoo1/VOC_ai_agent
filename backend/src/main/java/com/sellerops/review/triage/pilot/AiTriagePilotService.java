package com.sellerops.review.triage.pilot;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.triage.feedback.AiTriageCurrentRepository;
import com.sellerops.review.triage.feedback.TriageFeedbackService;
import com.sellerops.review.triage.llm.ApiTriageClassifier;
import com.sellerops.review.triage.llm.NaverOnlyClassifierGate;
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
 * codes; it hands the code to {@link NaverOnlyClassifierGate}, which refuses anything but NAVER as
 * {@code UNCLASSIFIED}. The refusal is still recorded — a run that quietly did nothing on a Coupang
 * account would look identical to a run that classified it and found nothing.
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

    private final AiTriagePilotProperties properties;
    private final ReviewRepository reviews;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final AiTriageCurrentRepository current;
    private final TriageFeedbackService feedback;
    private final NaverOnlyClassifierGate gate;

    @Autowired
    public AiTriagePilotService(AiTriagePilotProperties properties, ReviewRepository reviews,
                                SellerAccountRepository accounts, ChannelRepository channels,
                                AiTriageCurrentRepository current, TriageFeedbackService feedback) {
        this(properties, reviews, accounts, channels, current, feedback,
                properties.enabled() ? gateFrom(properties) : null);
    }

    /** Test seam: a gate whose classifier is a fake, or null for "off". Public so read-path tests can compose it. */
    public AiTriagePilotService(AiTriagePilotProperties properties, ReviewRepository reviews,
                         SellerAccountRepository accounts, ChannelRepository channels,
                         AiTriageCurrentRepository current, TriageFeedbackService feedback,
                         NaverOnlyClassifierGate gate) {
        this.properties = properties;
        this.reviews = reviews;
        this.accounts = accounts;
        this.channels = channels;
        this.current = current;
        this.feedback = feedback;
        this.gate = gate;
    }

    private static NaverOnlyClassifierGate gateFrom(AiTriagePilotProperties p) {
        return NaverOnlyClassifierGate.forApi(
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
     * Classify the account's reviews the pilot has not yet seen under the current version, oldest
     * first, up to the run bound.
     */
    public RunResult run(UUID orgId, UUID accountId) {
        if (!isEnabledFor(orgId)) {
            throw ApiException.badRequest("AI 분류 파일럿이 이 조직에서 활성화되어 있지 않습니다.");
        }
        SellerAccount account = accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        String channelCode = channels.findById(account.getChannelId()).map(Channel::getCode).orElse("UNKNOWN");
        String version = gate.version();

        List<Review> pending = reviews.findPendingAiTriage(orgId, account.getChannelId(), version,
                org.springframework.data.domain.PageRequest.of(0, properties.maxPerRun()));
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
                case UNCLASSIFIED -> refused++;
                case CLASSIFICATION_FAILED -> failed++;
            }
        }
        return new RunResult(version, pending.size(), classified, marked, failed, refused,
                (int) Math.max(0, remaining - pending.size()));
    }
}
