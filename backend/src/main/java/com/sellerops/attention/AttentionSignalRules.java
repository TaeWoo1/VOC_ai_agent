package com.sellerops.attention;

import com.sellerops.attention.dto.AttentionSignal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

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

        // Stable sort by severity (HIGH→LOW); within a tier the declared order above holds.
        signals.sort(Comparator.comparingInt(s -> AttentionSeverity.valueOf(s.severity()).ordinal()));
        return List.copyOf(signals);
    }

    private static AttentionSignal signal(AttentionSignalType type, AttentionSeverity severity, long count,
                                          String label, String description, String sourceType, String channel) {
        return new AttentionSignal(type.name(), severity.name(), count, label, description, sourceType, channel);
    }
}
