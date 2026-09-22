package com.sellerops.operations;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.reviewissue.ReviewIssueThresholds;
import com.sellerops.reviewissue.dto.IssueChangeView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The Operations Home carries a repeated problem only while it is still happening.</b>
 *
 * <p>The Home is 「지금 볼 일」. Measured on the live org: its three biggest problems had last evidence 34, 35 and
 * 266 days old, and the screen presented all three as today's — the last one being a problem that stopped being
 * seen nine months ago. A morning screen that says 「지금 판단이 필요한 반복 문제가 있습니다」 about that is not a
 * smaller truth, it is a different claim.
 *
 * <p><b>Nothing is closed, resolved, dismissed or deleted to achieve this.</b> The filter lives in the Home's read
 * and nowhere else; the issue keeps its lifecycle, its evidence and its place in 고객운영 메모리. These tests hold
 * that separation as much as they hold the window itself.
 */
class HomeProblemFreshnessTest {

    private static final Path SERVICE =
            Paths.get("src/main/java/com/sellerops/operations/OperationsHomeService.java");
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 22);

    private static ReviewIssueView lastSeen(LocalDate on) {
        return new ReviewIssueView(UUID.randomUUID(), "접착 부족", "접착", "부족", "NORMAL", "OBSERVING", "관찰 중",
                16, LocalDate.of(2025, 7, 29), on, null, null, false, "RULE_BASED",
                new IssueChangeView(List.of(), List.of(), false, 0, 0));
    }

    private static String code() throws IOException {
        return Files.readString(SERVICE).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    @Test
    @DisplayName("evidence inside the observation window is still happening; older is not")
    void theWindowIsTheObservationWindow() {
        int days = ReviewIssueThresholds.persistLookbackDays();

        assertThat(OperationsHomeService.stillHappening(lastSeen(TODAY), TODAY))
                .as("evidence today")
                .isTrue();
        assertThat(OperationsHomeService.stillHappening(lastSeen(TODAY.minusDays(days)), TODAY))
                .as("the oldest date still inside the window — inclusive, so a problem does not leave the Home a "
                        + "day early")
                .isTrue();
        assertThat(OperationsHomeService.stillHappening(lastSeen(TODAY.minusDays(days + 1)), TODAY))
                .as("one day past the window")
                .isFalse();

        // The three the live org actually had, at the date they were measured.
        assertThat(OperationsHomeService.stillHappening(lastSeen(LocalDate.of(2026, 8, 19)), TODAY)).isTrue();
        assertThat(OperationsHomeService.stillHappening(lastSeen(LocalDate.of(2026, 8, 18)), TODAY)).isTrue();
        assertThat(OperationsHomeService.stillHappening(lastSeen(LocalDate.of(2025, 12, 30)), TODAY)).isFalse();
    }

    @Test
    @DisplayName("an issue that never had evidence is inside no window")
    void noEvidenceIsNotFreshness() {
        ReviewIssueView never = new ReviewIssueView(UUID.randomUUID(), "x", "a", "p", "NORMAL", "OBSERVING", "관찰 중",
                0, null, null, null, null, false, "RULE_BASED",
                new IssueChangeView(List.of(), List.of(), false, 0, 0));

        assertThat(OperationsHomeService.stillHappening(never, TODAY)).isFalse();
    }

    @Test
    @DisplayName("the window is the existing threshold, not a number of this screen's own")
    void reusesTheThresholdRatherThanRestatingIt() throws IOException {
        String body = code();

        assertThat(body)
                .as("a second freshness constant would let this screen and the persistence judgement disagree "
                        + "about whether a problem is current")
                .contains("ReviewIssueThresholds.persistLookbackDays()");
        assertThat(body)
                .as("no literal day/week count of its own beside the window")
                .doesNotContain("minusWeeks(")
                .doesNotContain("minusDays(42")
                .doesNotContain("minusMonths(");
    }

    @Test
    @DisplayName("staleness hides a problem from this screen; it does not end it")
    void dormantIsNotResolved() throws IOException {
        String body = code();

        // The whole point: a problem drops off the Home and stays exactly as it was everywhere else.
        assertThat(body)
                .as("the Home read may not write, resolve, dismiss or delete an issue to stop showing it")
                .doesNotContain("dismiss")
                .doesNotContain("RESOLVED")
                .doesNotContain(".save(")
                .doesNotContain("delete");

        // Counted rather than silently dropped, so 「없습니다」 can distinguish an empty library from a quiet one.
        assertThat(body).contains("long dormant = all.size() - live.size()");
    }
}
