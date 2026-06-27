package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.dto.AttentionSignal;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The attention rules are a pure function over an aggregate snapshot: a signal is
 * emitted only when its count is positive, each type maps to a fixed severity, and
 * the result is ranked HIGH → LOW. No DB, no clock.
 */
class AttentionSignalRulesTest {

    private static final String CHANNEL = "카페24";

    @Test
    void emptySnapshotYieldsNoSignals() {
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(0, 0, 0, 0, 0, 0, 0, 0), CHANNEL);
        assertThat(signals).isEmpty();
    }

    @Test
    void onlyPositiveCountsBecomeSignals() {
        // newReviews=5 set, everything else zero → exactly the NEW_REVIEW signal.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(5, 0, 0, 0, 0, 0, 0, 0), CHANNEL);
        assertThat(signals).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo("NEW_REVIEW");
            assertThat(s.severity()).isEqualTo("LOW");
            assertThat(s.count()).isEqualTo(5);
            assertThat(s.sourceType()).isEqualTo("REVIEW");
            assertThat(s.channel()).isEqualTo(CHANNEL);
        });
    }

    @Test
    void unansweredInquiryIsHighAndSourcedFromInquiry() {
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(0, 0, 3, 0, 0, 0, 0, 0), CHANNEL);
        assertThat(signals).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo("UNANSWERED_INQUIRY");
            assertThat(s.severity()).isEqualTo("HIGH");
            assertThat(s.count()).isEqualTo(3);
            assertThat(s.sourceType()).isEqualTo("INQUIRY");
        });
    }

    @Test
    void lowRatingIsHighAndMidRatingIsMediumBothAsLowRatingReviewType() {
        List<AttentionSignal> low = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(0, 0, 0, 0, 2, 0, 0, 0), CHANNEL);
        assertThat(low).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo("LOW_RATING_REVIEW");
            assertThat(s.severity()).isEqualTo("HIGH");
            assertThat(s.count()).isEqualTo(2);
        });

        List<AttentionSignal> mid = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(0, 0, 0, 0, 0, 4, 0, 0), CHANNEL);
        assertThat(mid).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo("LOW_RATING_REVIEW");
            assertThat(s.severity()).isEqualTo("MEDIUM");
            assertThat(s.count()).isEqualTo(4);
        });
    }

    @Test
    void newInquiryAndUnknownReplyAreMedium() {
        assertThat(AttentionSignalRules.evaluate(new VocWindowSnapshot(0, 6, 0, 0, 0, 0, 0, 0), CHANNEL))
                .singleElement().satisfies(s -> {
                    assertThat(s.type()).isEqualTo("NEW_INQUIRY");
                    assertThat(s.severity()).isEqualTo("MEDIUM");
                });
        assertThat(AttentionSignalRules.evaluate(new VocWindowSnapshot(0, 0, 0, 1, 0, 0, 0, 0), CHANNEL))
                .singleElement().satisfies(s -> {
                    assertThat(s.type()).isEqualTo("UNKNOWN_REPLY_STATUS");
                    assertThat(s.severity()).isEqualTo("MEDIUM");
                });
    }

    @Test
    void aFullSnapshotIsRankedHighToLow() {
        // One of every count → every signal type present, sorted by severity.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(11, 6, 4, 1, 2, 3, 0, 0), CHANNEL);

        assertThat(signals).extracting(AttentionSignal::severity)
                .containsExactly("HIGH", "HIGH", "MEDIUM", "MEDIUM", "MEDIUM", "LOW");
        // Within the leading HIGH tier the declared order holds: unanswered, then low-rating.
        assertThat(signals).extracting(AttentionSignal::type)
                .startsWith("UNANSWERED_INQUIRY", "LOW_RATING_REVIEW");
        // The trailing LOW signal is the new-review lens.
        assertThat(signals.get(signals.size() - 1).type()).isEqualTo("NEW_REVIEW");
    }

    @Test
    void severityRankIsExplicitAndIndependentOfDeclarationOrder() {
        // Pins the triage contract so ranking does not silently depend on enum ordinal().
        assertThat(AttentionSeverity.HIGH.rank()).isLessThan(AttentionSeverity.MEDIUM.rank());
        assertThat(AttentionSeverity.MEDIUM.rank()).isLessThan(AttentionSeverity.LOW.rank());
    }

    // --- spike lens (current vs immediately preceding equal-length window) --------

    /** newReviews=current, previousReviews=previous; all other counts zero. */
    private static VocWindowSnapshot reviewWindow(long current, long previous) {
        return new VocWindowSnapshot(current, 0, 0, 0, 0, 0, previous, 0);
    }

    /** newInquiries=current, previousInquiries=previous; all other counts zero. */
    private static VocWindowSnapshot inquiryWindow(long current, long previous) {
        return new VocWindowSnapshot(0, current, 0, 0, 0, 0, 0, previous);
    }

    private static List<AttentionSignal> typed(List<AttentionSignal> signals, AttentionSignalType type) {
        return signals.stream().filter(s -> s.type().equals(type.name())).toList();
    }

    @Test
    void noSpikeWhenCurrentIsBelowTheMinimum() {
        // 4 < min(5) even though 4 >= 2×prev(1).
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(reviewWindow(4, 1), CHANNEL);
        assertThat(typed(signals, AttentionSignalType.RECENT_REVIEW_SPIKE_CANDIDATE)).isEmpty();
    }

    @Test
    void noSpikeWhenPreviousIsZero() {
        // 0 → N must not over-alert a freshly connected account, even at high volume.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(inquiryWindow(20, 0), CHANNEL);
        assertThat(typed(signals, AttentionSignalType.RECENT_INQUIRY_SPIKE_CANDIDATE)).isEmpty();
    }

    @Test
    void noSpikeWhenRatioIsBelowThreshold() {
        // 6 >= min(5) and prev(4) >= 1, but 6 < 2×4 = 8.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(reviewWindow(6, 4), CHANNEL);
        assertThat(typed(signals, AttentionSignalType.RECENT_REVIEW_SPIKE_CANDIDATE)).isEmpty();
    }

    @Test
    void mediumSpikeWhenCurrentAtLeastFiveAndDoublePrevious() {
        // 6 >= 5 and 6 >= 2×3, but not (>=10 and >=3×) → MEDIUM.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(reviewWindow(6, 3), CHANNEL);
        assertThat(typed(signals, AttentionSignalType.RECENT_REVIEW_SPIKE_CANDIDATE))
                .singleElement().satisfies(s -> {
                    assertThat(s.severity()).isEqualTo("MEDIUM");
                    assertThat(s.count()).isEqualTo(6);
                    assertThat(s.sourceType()).isEqualTo("REVIEW");
                    // Aggregate counts are safe to state; both numbers appear in the description.
                    assertThat(s.description()).contains("6").contains("3");
                });
    }

    @Test
    void highSpikeWhenCurrentAtLeastTenAndTriplePrevious() {
        // 21 >= 10 and 21 >= 3×6 → HIGH.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(inquiryWindow(21, 6), CHANNEL);
        assertThat(typed(signals, AttentionSignalType.RECENT_INQUIRY_SPIKE_CANDIDATE))
                .singleElement().satisfies(s -> {
                    assertThat(s.severity()).isEqualTo("HIGH");
                    assertThat(s.count()).isEqualTo(21);
                    assertThat(s.sourceType()).isEqualTo("INQUIRY");
                    assertThat(s.description()).contains("21").contains("6");
                });
    }

    @Test
    void reviewAndInquirySpikesCoexistAsTwoDistinctSignals() {
        VocWindowSnapshot snapshot = new VocWindowSnapshot(12, 10, 0, 0, 0, 0, 2, 2);
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(snapshot, CHANNEL);

        assertThat(typed(signals, AttentionSignalType.RECENT_REVIEW_SPIKE_CANDIDATE))
                .singleElement().satisfies(s -> assertThat(s.sourceType()).isEqualTo("REVIEW"));
        assertThat(typed(signals, AttentionSignalType.RECENT_INQUIRY_SPIKE_CANDIDATE))
                .singleElement().satisfies(s -> assertThat(s.sourceType()).isEqualTo("INQUIRY"));
    }

    @Test
    void signalsCarryOnlySafeMetadataNeverRawContent() {
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(11, 6, 4, 1, 2, 3, 0, 0), CHANNEL);
        // Labels/descriptions are fixed operator strings — no digits-from-content, no ids.
        assertThat(signals).allSatisfy(s -> {
            assertThat(s.label()).isNotBlank();
            assertThat(s.description()).isNotBlank();
            assertThat(s.sourceType()).isIn("REVIEW", "INQUIRY");
        });
    }
}
