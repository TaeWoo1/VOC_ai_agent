package com.sellerops.proactive;

import com.sellerops.review.Review;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * What SellerOps finds out about a 확인 필요 review before the seller opens it.
 *
 * <p><b>It prepares no reply, and that is a capability fact rather than a scope decision.</b> There
 * is no proven review-reply WRITE adapter on any visible channel; a 답변 보내기 control on this card
 * would be a button that cannot do what it says. So the preparation ends at what SellerOps can
 * actually stand behind: whether this complaint is one the product has heard before, and what the
 * seller can do next.
 *
 * <p><b>The repetition is read, not inferred.</b> It comes from the existing review issue memory —
 * {@code review_issue} and its {@code review_issue_evidence} rows, built by the extraction that
 * already runs after every ingest. Judging "이건 반복 문제 같다" from this one review's text would be
 * an invention; counting the evidence rows another pipeline already recorded is an observation. That
 * is also why a product with no issue memory yields no repeat claim rather than a hedged one.
 *
 * <p><b>No policy is fabricated.</b> The recommendation is composed from facts this method holds —
 * the rating, whether the issue repeats, whether the review resolves to a canonical product. It never
 * says what the seller's refund, exchange or shipping policy is, because this class does not know and
 * the org's operating policy is the seller's to write.
 */
@Component
public class ProactiveReviewInvestigator {

    /**
     * How many evidence rows make a complaint "반복" rather than "또 한 번".
     *
     * <p>Two is the smallest number that can be a repetition at all, and the count is over an issue's
     * whole history — the same all-time reading {@code issueEvidenceCountsByProduct} was written for.
     * A higher bar would silence the second occurrence, which is the one a seller can still act on
     * cheaply.
     */
    static final long REPEAT_EVIDENCE_MIN = 2;

    /** The worst rating. Split out because the seller's next action at 1점 is usually already late. */
    static final int SEVERE_RATING_MAX = 1;

    private final ReviewIssueRepository issues;
    private final ReviewIssueEvidenceRepository evidence;

    public ProactiveReviewInvestigator(ReviewIssueRepository issues,
                                       ReviewIssueEvidenceRepository evidence) {
        this.issues = issues;
        this.evidence = evidence;
    }

    /**
     * @param reason         the deterministic reason this review is on screen
     * @param repeatIssue    the repeated issue's title, or null when the memory holds none
     * @param repeatCount    how many reviews that issue has been seen in, all-time
     * @param recommendation the next action, in the seller's language
     */
    public record Investigation(ProactiveReason reason, String repeatIssue, long repeatCount,
                                String recommendation) {
    }

    public Investigation investigate(UUID orgId, Review review) {
        Repeat repeat = repeatFor(orgId, review.getProductId());

        ProactiveReason reason;
        if (repeat != null) {
            reason = ProactiveReason.REPEAT_ISSUE_REVIEW;
        } else if (review.getRating() != null && review.getRating() <= SEVERE_RATING_MAX) {
            reason = ProactiveReason.SEVERE_NEGATIVE_REVIEW;
        } else {
            reason = ProactiveReason.NEGATIVE_REVIEW;
        }

        return new Investigation(reason,
                repeat == null ? null : repeat.title(),
                repeat == null ? 0 : repeat.count(),
                recommend(review, repeat));
    }

    private record Repeat(String title, long count) {
    }

    /**
     * The product's most-evidenced open issue, when it has one that repeats.
     *
     * <p>Dismissed issues are skipped: the seller has already said that one is not worth chasing, and
     * a proactive card that re-raised it would be the product arguing with its user — the same rule
     * the review candidate gate follows for a dismissed reply.
     */
    private Repeat repeatFor(UUID orgId, UUID productId) {
        if (productId == null) {
            return null;   // No canonical product ⇒ nothing to say about repetition. Never guessed.
        }
        List<Object[]> counts = evidence.issueEvidenceCountsByProduct(orgId, productId);
        if (counts.isEmpty()) {
            return null;
        }
        Map<UUID, ReviewIssue> open = issues.findByOrgIdAndDismissedFalse(orgId).stream()
                .collect(Collectors.toMap(ReviewIssue::getId, Function.identity(), (a, b) -> a));
        for (Object[] row : counts) {   // already ordered most-evidence-first
            UUID issueId = (UUID) row[0];
            long count = ((Number) row[1]).longValue();
            if (count < REPEAT_EVIDENCE_MIN) {
                continue;
            }
            ReviewIssue issue = open.get(issueId);
            if (issue != null) {
                return new Repeat(issue.getTitle(), count);
            }
        }
        return null;
    }

    /**
     * What the seller can do next — assembled from what is known, never from what would be plausible.
     *
     * <p>Three sentences at most, and each one is earned by a fact: the repetition (from the issue
     * memory), the severity (from the rating), and the product gap (from the absent canonical link).
     * There is no sentence here that a seller could read as a claim about their own policy.
     */
    private static String recommend(Review review, Repeat repeat) {
        StringBuilder text = new StringBuilder();
        if (repeat != null) {
            text.append("이 상품에서 「").append(repeat.title()).append("」 문제가 ")
                    .append(repeat.count()).append("건 확인됐습니다. 개별 응대보다 상품 설명이나 ")
                    .append("운영 기준을 함께 손보는 편이 빠릅니다.");
        } else if (review.getRating() != null && review.getRating() <= SEVERE_RATING_MAX) {
            text.append("가장 낮은 평점입니다. 내용을 먼저 확인하고 고객에게 필요한 조치를 정해 주세요.");
        } else {
            text.append("낮은 평점의 리뷰입니다. 내용을 확인하고 대응이 필요한지 판단해 주세요.");
        }
        if (review.getProductId() == null) {
            text.append(" 이 리뷰는 상품과 연결되지 않아, 같은 문제가 반복되는지는 아직 알 수 없습니다.");
        }
        return text.toString();
    }
}
