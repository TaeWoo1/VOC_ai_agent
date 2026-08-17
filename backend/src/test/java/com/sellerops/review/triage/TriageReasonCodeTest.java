package com.sellerops.review.triage;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The enum is a copy; {@code RUBRIC.md} §3.1 is the declaration. This pins them together.
 *
 * <p>There are now three places holding these thirteen codes — the labeling tool's
 * {@code vocabulary.mjs}, this enum, and the rubric's table — and a drift between them would not
 * fail anything loudly. It would mis-score: a classifier emitting a code the harness does not know
 * becomes {@code UNCLASSIFIED} and looks like a model problem.
 */
class TriageReasonCodeTest {

    private static final Path RUBRIC =
            Path.of("..", "contracts", "review-eval", "naver", "v2", "RUBRIC.md");

    /** The §3.1 table's rows: a backticked ALL_CAPS code in the first cell, then its side. */
    private static final Pattern ROW = Pattern.compile("^\\| `([A-Z_]+)` \\|.*\\| (actionable|not actionable) \\|$");

    @Test
    @DisplayName("the enum is exactly §3.1's thirteen, on the sides §3.1 puts them")
    void theEnumMatchesTheRubric() throws Exception {
        List<String> lines = Files.readAllLines(RUBRIC);
        Set<String> actionable = new LinkedHashSet<>();
        Set<String> notActionable = new LinkedHashSet<>();
        for (String line : lines) {
            Matcher matcher = ROW.matcher(line.strip());
            if (matcher.matches()) {
                (matcher.group(2).equals("actionable") ? actionable : notActionable).add(matcher.group(1));
            }
        }
        assertThat(actionable).as("§3.1's actionable column must be found").hasSize(8);
        assertThat(notActionable).as("§3.1's not-actionable column must be found").hasSize(5);

        List<String> enumActionable = new ArrayList<>();
        List<String> enumNot = new ArrayList<>();
        for (TriageReasonCode code : TriageReasonCode.values()) {
            (code.actionable() ? enumActionable : enumNot).add(code.name());
        }
        assertThat(enumActionable).containsExactlyInAnyOrderElementsOf(actionable);
        assertThat(enumNot).containsExactlyInAnyOrderElementsOf(notActionable);
        assertThat(TriageReasonCode.NAMES).hasSize(13);
    }

    @Test
    @DisplayName("parse refuses an unknown code rather than substituting one")
    void parseRefuses() {
        assertThat(TriageReasonCode.parse("DEFECT_OR_DAMAGE")).contains(TriageReasonCode.DEFECT_OR_DAMAGE);
        assertThat(TriageReasonCode.parse("  PRAISE_ONLY ")).contains(TriageReasonCode.PRAISE_ONLY);
        assertThat(TriageReasonCode.parse("defect_or_damage")).isEmpty();
        assertThat(TriageReasonCode.parse("SOUNDS_BAD")).isEmpty();
        assertThat(TriageReasonCode.parse(null)).isEmpty();
    }

    @Test
    @DisplayName("the actionable flag describes; it never decides a tier")
    void theFlagIsDescriptive() {
        // §3.1: "a pairing that crosses the column is a finding about the rubric and is reported,
        // never auto-corrected." 16 of the 218 gold rows cross it. Anything that started enforcing
        // the column here would silently rewrite those human judgments.
        assertThat(TriageReasonCode.CRITIQUE_NO_REQUEST.actionable()).isFalse();
        assertThat(TriageReasonCode.class.getDeclaredMethods())
                .as("no method here may map a code to a tier")
                .noneMatch(m -> m.getReturnType().equals(ReviewTriageTier.class));
    }
}
