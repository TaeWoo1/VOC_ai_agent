package com.sellerops.attention;

import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.SpikeComparison;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * Deterministic, transparent rules that turn an aggregate {@link VocWindowSnapshot}
 * into a ranked list of operator {@link AttentionSignal}s. Pure (no DB, no clock,
 * no LLM) so the scoring is fully unit-testable. A signal is emitted only when its
 * count is positive; the result is sorted by severity (HIGH → LOW), preserving the
 * declared type order within a severity tier.
 *
 * <p>The lenses overlap by design: {@code LOW_RATING_REVIEW} is the severity-raised
 * subset of {@code NEW_REVIEW}; {@code UNANSWERED_INQUIRY}/{@code UNKNOWN_REPLY_STATUS}
 * highlight subsets of {@code NEW_INQUIRY}. They are attention lenses, not a partition.
 */
public final class AttentionSignalRules {

    /** Operator-facing source kinds (mirrors the drill-down's REVIEW / INQUIRY). */
    private static final String SOURCE_REVIEW = "REVIEW";
    private static final String SOURCE_INQUIRY = "INQUIRY";

    /**
     * Deterministic, conservative spike thresholds. A spike fires only when the
     * current count is both absolutely meaningful and a clear multiple of the prior
     * window. {@code 0 → N} never fires (a freshly connected account would otherwise
     * over-alert) — that is why the baseline must be {@code >= MIN_PREVIOUS}.
     */
    private static final long SPIKE_MIN_CURRENT = 5;
    private static final long SPIKE_MIN_PREVIOUS = 1;
    private static final long SPIKE_RATIO = 2;
    private static final long SPIKE_HIGH_CURRENT = 10;
    private static final long SPIKE_HIGH_RATIO = 3;

    private AttentionSignalRules() {
    }

    public static List<AttentionSignal> evaluate(VocWindowSnapshot snapshot, String channel) {
        List<AttentionSignal> signals = new ArrayList<>();

        if (snapshot.unansweredInquiries() > 0) {
            signals.add(signal(AttentionSignalType.UNANSWERED_INQUIRY, AttentionSeverity.HIGH,
                    snapshot.unansweredInquiries(), "답변 필요 문의",
                    "미답변 상태의 문의입니다. 우선 확인해 주세요.", SOURCE_INQUIRY, channel));
        }
        if (snapshot.lowRatingReviews() > 0) {
            signals.add(signal(AttentionSignalType.LOW_RATING_REVIEW, AttentionSeverity.HIGH,
                    snapshot.lowRatingReviews(), "낮은 평점(1~2점) 리뷰",
                    "불만족 리뷰입니다. 내용을 확인하고 대응을 검토하세요.", SOURCE_REVIEW, channel));
        }
        if (snapshot.midRatingReviews() > 0) {
            signals.add(signal(AttentionSignalType.LOW_RATING_REVIEW, AttentionSeverity.MEDIUM,
                    snapshot.midRatingReviews(), "보통 평점(3점) 리뷰",
                    "개선 여지가 있는 리뷰입니다. 확인을 권장합니다.", SOURCE_REVIEW, channel));
        }
        if (snapshot.newInquiries() > 0) {
            signals.add(signal(AttentionSignalType.NEW_INQUIRY, AttentionSeverity.MEDIUM,
                    snapshot.newInquiries(), "신규 문의",
                    "기간 내 새로 수집된 문의입니다.", SOURCE_INQUIRY, channel));
        }
        if (snapshot.unknownReplyInquiries() > 0) {
            signals.add(signal(AttentionSignalType.UNKNOWN_REPLY_STATUS, AttentionSeverity.MEDIUM,
                    snapshot.unknownReplyInquiries(), "답변 상태 확인 필요",
                    "답변 여부를 판별하지 못한 문의입니다. 직접 확인이 필요합니다.", SOURCE_INQUIRY, channel));
        }
        if (snapshot.newReviews() > 0) {
            signals.add(signal(AttentionSignalType.NEW_REVIEW, AttentionSeverity.LOW,
                    snapshot.newReviews(), "신규 리뷰",
                    "기간 내 새로 수집된 리뷰입니다.", SOURCE_REVIEW, channel));
        }

        // Volume-change lenses: current window vs the immediately preceding equal-length
        // window. Aggregate counts only, so the comparison is safe to state verbatim.
        spike(snapshot.newReviews(), snapshot.previousReviews(),
                AttentionSignalType.RECENT_REVIEW_SPIKE_CANDIDATE, SOURCE_REVIEW, "리뷰", "리뷰 급증 감지", channel)
                .ifPresent(signals::add);
        spike(snapshot.newInquiries(), snapshot.previousInquiries(),
                AttentionSignalType.RECENT_INQUIRY_SPIKE_CANDIDATE, SOURCE_INQUIRY, "문의", "문의 급증 감지", channel)
                .ifPresent(signals::add);

        // Stable sort by explicit severity rank (HIGH→LOW); within a tier the emission
        // order above holds. Uses rank(), not ordinal(), so enum order is not load-bearing.
        signals.sort(Comparator.comparingInt(s -> AttentionSeverity.valueOf(s.severity()).rank()));
        return List.copyOf(signals);
    }

    private static AttentionSignal signal(AttentionSignalType type, AttentionSeverity severity, long count,
                                          String label, String description, String sourceType, String channel) {
        return new AttentionSignal(type.name(), severity.name(), count, label, description, sourceType, channel);
    }

    /**
     * Emit a spike signal iff the current count is meaningful ({@code >= MIN_CURRENT}),
     * the baseline is non-zero ({@code >= MIN_PREVIOUS}), and current is at least
     * {@code RATIO}× the baseline. Severity is HIGH at a larger absolute level and
     * multiple, MEDIUM otherwise. {@code noun} drives the count-bearing description.
     */
    private static Optional<AttentionSignal> spike(long current, long previous, AttentionSignalType type,
                                                   String sourceType, String noun, String label, String channel) {
        if (current < SPIKE_MIN_CURRENT || previous < SPIKE_MIN_PREVIOUS || current < previous * SPIKE_RATIO) {
            return Optional.empty();
        }
        AttentionSeverity severity = (current >= SPIKE_HIGH_CURRENT && current >= previous * SPIKE_HIGH_RATIO)
                ? AttentionSeverity.HIGH : AttentionSeverity.MEDIUM;
        String description = "선택 기간 " + noun + "가 " + current + "건으로 직전 동일 기간 "
                + previous + "건보다 증가했습니다.";
        // Same aggregate numbers as the description, exposed as structured metadata so the
        // UI can render a quantified line without parsing prose. previous >= 1 here.
        SpikeComparison comparison = new SpikeComparison(previous, current - previous, (double) current / previous);
        return Optional.of(new AttentionSignal(type.name(), severity.name(), current, label, description,
                sourceType, channel, comparison));
    }
}
