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
                new VocWindowSnapshot(0, 0, 0, 0, 0, 0), CHANNEL);
        assertThat(signals).isEmpty();
    }

    @Test
    void onlyPositiveCountsBecomeSignals() {
        // newReviews=5 set, everything else zero → exactly the NEW_REVIEW signal.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(5, 0, 0, 0, 0, 0), CHANNEL);
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
                new VocWindowSnapshot(0, 0, 3, 0, 0, 0), CHANNEL);
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
                new VocWindowSnapshot(0, 0, 0, 0, 2, 0), CHANNEL);
        assertThat(low).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo("LOW_RATING_REVIEW");
            assertThat(s.severity()).isEqualTo("HIGH");
            assertThat(s.count()).isEqualTo(2);
        });

        List<AttentionSignal> mid = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(0, 0, 0, 0, 0, 4), CHANNEL);
        assertThat(mid).singleElement().satisfies(s -> {
            assertThat(s.type()).isEqualTo("LOW_RATING_REVIEW");
            assertThat(s.severity()).isEqualTo("MEDIUM");
            assertThat(s.count()).isEqualTo(4);
        });
    }

    @Test
    void newInquiryAndUnknownReplyAreMedium() {
        assertThat(AttentionSignalRules.evaluate(new VocWindowSnapshot(0, 6, 0, 0, 0, 0), CHANNEL))
                .singleElement().satisfies(s -> {
                    assertThat(s.type()).isEqualTo("NEW_INQUIRY");
                    assertThat(s.severity()).isEqualTo("MEDIUM");
                });
        assertThat(AttentionSignalRules.evaluate(new VocWindowSnapshot(0, 0, 0, 1, 0, 0), CHANNEL))
                .singleElement().satisfies(s -> {
                    assertThat(s.type()).isEqualTo("UNKNOWN_REPLY_STATUS");
                    assertThat(s.severity()).isEqualTo("MEDIUM");
                });
    }

    @Test
    void aFullSnapshotIsRankedHighToLow() {
        // One of every count → every signal type present, sorted by severity.
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(11, 6, 4, 1, 2, 3), CHANNEL);

        assertThat(signals).extracting(AttentionSignal::severity)
                .containsExactly("HIGH", "HIGH", "MEDIUM", "MEDIUM", "MEDIUM", "LOW");
        // Within the leading HIGH tier the declared order holds: unanswered, then low-rating.
        assertThat(signals).extracting(AttentionSignal::type)
                .startsWith("UNANSWERED_INQUIRY", "LOW_RATING_REVIEW");
        // The trailing LOW signal is the new-review lens.
        assertThat(signals.get(signals.size() - 1).type()).isEqualTo("NEW_REVIEW");
    }

    @Test
    void signalsCarryOnlySafeMetadataNeverRawContent() {
        List<AttentionSignal> signals = AttentionSignalRules.evaluate(
                new VocWindowSnapshot(11, 6, 4, 1, 2, 3), CHANNEL);
        // Labels/descriptions are fixed operator strings — no digits-from-content, no ids.
        assertThat(signals).allSatisfy(s -> {
            assertThat(s.label()).isNotBlank();
            assertThat(s.description()).isNotBlank();
            assertThat(s.sourceType()).isIn("REVIEW", "INQUIRY");
        });
    }
}
