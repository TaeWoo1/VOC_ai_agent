package com.sellerops.report;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * The gate between the narrative model and the seller's screen (Agentic Report v1).
 *
 * <p>Two rules, both mechanical, because "be careful" is not auditable:
 * <ol>
 *   <li><b>Trace or drop.</b> A line is kept only if every fact id it cites exists in the snapshot and
 *       it cites at least one. A sentence about nothing in the facts is a sentence the report cannot
 *       stand behind, however reasonable it sounds.</li>
 *   <li><b>No cause, no outcome.</b> A closed list of Korean causal and outcome markers refuses the
 *       line outright. The facts are counts and labels; they do not know why anything happened or what
 *       it did to the business, so a sentence that says 「…때문에」 or 「품질이 나빠졌다」 is asserting
 *       what nothing in its input contains. The list is the same shape as the judge's unsafe-assertion
 *       vocabulary and {@code pages-copy.test.ts}'s outcome guard, applied at the source.</li>
 * </ol>
 *
 * <p>A refused line is not rewritten — deleting the offending clause leaves a sentence nobody chose.
 * It is dropped and counted, and if nothing survives the report shows the deterministic summary.
 */
public final class NarrativeClaimGuard {

    /** Cause markers — the data has no causes, so a sentence with one is invented. */
    static final List<String> CAUSAL = List.of(
            "때문", "원인은", "원인이", "원인으로", "원인일", "탓", "로 인해", "으로 인해", "인해서", "탓에",
            "영향으로", "결과로", "이유는", "이유로");

    /** Outcome markers — quality, sales, satisfaction: nothing in the facts measures them. */
    static final List<String> OUTCOME = List.of(
            "나빠졌", "나빠지", "악화", "저하", "품질이 떨어", "품질 문제", "좋아졌", "개선됐", "개선되었", "개선됨",
            "효과", "성과", "매출", "전환율", "만족도", "신뢰도", "이탈");

    /** Length caps: a report line is a line. */
    static final int MAX_LINES = 8;
    static final int MAX_LINE_CHARS = 300;

    private NarrativeClaimGuard() {
    }

    public record Result(ReportNarrative narrative, int refused) {

        public boolean hasAnything() {
            return narrative != null && !narrative.lines().isEmpty();
        }
    }

    /** Validate a raw narrative against the snapshot's fact ids. */
    public static Result validate(ReportNarrative raw, Set<String> knownFactIds) {
        if (raw == null) {
            return new Result(null, 0);
        }
        int refused = 0;
        List<ReportNarrative.Line> kept = new ArrayList<>();
        for (ReportNarrative.Line line : raw.lines() == null ? List.<ReportNarrative.Line>of() : raw.lines()) {
            if (kept.size() >= MAX_LINES) {
                refused++;
                continue;
            }
            if (!admissible(line, knownFactIds)) {
                refused++;
                continue;
            }
            kept.add(new ReportNarrative.Line(line.text().strip(), List.copyOf(line.factIds())));
        }
        String headline = raw.headline() == null || raw.headline().isBlank() ? null : raw.headline().strip();
        if (headline != null && (headline.length() > MAX_LINE_CHARS || unsupportedClaim(headline))) {
            refused++;
            headline = null;
        }
        return new Result(new ReportNarrative(headline, List.copyOf(kept)), refused);
    }

    static boolean admissible(ReportNarrative.Line line, Set<String> knownFactIds) {
        if (line == null || line.text() == null || line.text().isBlank()
                || line.text().length() > MAX_LINE_CHARS) {
            return false;
        }
        if (line.factIds() == null || line.factIds().isEmpty()) {
            return false;
        }
        for (String id : line.factIds()) {
            if (id == null || !knownFactIds.contains(id)) {
                return false;
            }
        }
        return !unsupportedClaim(line.text());
    }

    /** Does the sentence assert a cause or an outcome the facts cannot carry? */
    public static boolean unsupportedClaim(String text) {
        if (text == null) {
            return false;
        }
        for (String marker : CAUSAL) {
            if (text.contains(marker)) {
                return true;
            }
        }
        for (String marker : OUTCOME) {
            if (text.contains(marker)) {
                return true;
            }
        }
        return false;
    }
}
