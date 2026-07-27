package com.sellerops.reviewissue;

import java.util.ArrayList;
import java.util.List;

/**
 * Splits a review body into <b>opinion units</b> — the clauses a customer's separate opinions live
 * in. Pure: no clock, no I/O, no regex backtracking (every pattern is a literal or a single
 * character class, so cost is linear in body length).
 *
 * <p><b>Why this module is the load-bearing part of the design.</b> The shipped analyzer classifies
 * a whole review and derives sentiment from {@code rating}, so "예쁜데 배송이 너무 늦었어요" at 5★ is
 * invisible: the positive frame swallows the actionable clause. Splitting first means the second
 * clause is scanned on its own and can carry a problem signature while the review stays 5★. That
 * is a <i>structural</i> fix and it survives replacing the keyword vocabulary with something
 * better — which is exactly what
 * {@code contracts/review-eval/naver/v1/RUBRIC.md} identifies as the real failure mode
 * ("surface-form rigidity rather than vocabulary breadth").
 *
 * <p><b>The split is deliberately biased toward splitting.</b> A missed split buries an actionable
 * clause inside a positive review — the exact harm this exists to prevent. A spurious split
 * produces two shorter units that are each still scanned, so at worst a unit loses the context of
 * a neighbouring word. The costs are not symmetric, so where the two trade off, split.
 *
 * <p>Concretely, a Korean contrastive ending is recognised as any Hangul syllable immediately
 * followed by {@code 데} or by {@code 지만} and then whitespace. Requiring the syllable to be
 * adjacent is what keeps the free noun 데 ("한 데 비해") from matching, and requiring trailing
 * whitespace is what keeps {@code 인데} inside a word ("확인데이터") from matching. Known spurious
 * match: "가지만 있어요" splits on 가지+만. Accepted, per the asymmetry above.
 */
public final class OpinionUnitSplitter {

    /**
     * Internal split marker, written as an escape so this source file stays pure text.
     * NUL cannot occur in an ingested review body (Postgres {@code text} cannot store it), so
     * inserting it can never collide with content. It exists only between the replacements below
     * and the split, and never reaches a returned unit.
     */
    private static final String MARK = "\u0000";

    /** A unit shorter than this cannot carry any vocabulary keyword, so it is not a unit. */
    private static final int MIN_UNIT_CHARS = 2;

    /**
     * Connectives that can end up alone between two split points. 그런데/근데 both end in 데, so the
     * contrastive-ending rule splits after them AND the opener rule splits before them, leaving the
     * bare connective as its own piece. It carries no opinion, so it is not a unit — and dropping it
     * matters beyond tidiness: every non-unit that survives becomes a NO_SIGNATURE row in the UNKNOWN
     * pen, and a pen full of the word "그런데" would hide the rows that are actually worth reading.
     */
    private static final List<String> CONNECTIVE_ONLY =
            List.of("그러나", "하지만", "다만", "그런데", "근데", "지만");

    private OpinionUnitSplitter() {
    }

    /**
     * Opinion units in reading order. The index of each unit is its {@code unit_ordinal} —
     * evidence and unknown rows are keyed by it, so this order is part of the stored data and must
     * stay stable for a given body.
     *
     * @return an empty list for null/blank input, never null
     */
    public static List<String> split(String body) {
        if (body == null || body.isBlank()) {
            return List.of();
        }
        String marked = body.replace("\r\n", "\n").replace('\r', '\n');

        // Sentence terminators: split AFTER the punctuation, keeping it with its own unit.
        marked = marked.replaceAll("([.!?])", "$1" + MARK);
        marked = marked.replace("\n", MARK);

        // Contrastive endings: split AFTER the connective. The trailing \\s is required (not
        // consumed) so a connective-looking substring inside a word cannot match.
        marked = marked.replaceAll("([가-힣]데)(?=\\s)", "$1" + MARK);
        marked = marked.replaceAll("(지만)(?=\\s)", "$1" + MARK);

        // Contrastive openers that do NOT already self-split. 그런데 / 근데 end in 데 and 하지만 ends
        // in 지만, so the two rules above already split after them, leaving the opener trailing the
        // previous unit — harmless, because an opener carries no vocabulary keyword and so cannot
        // affect what the previous unit matches. Listing them here as well would split before AND
        // after, isolating the bare connective as its own piece.
        marked = marked.replaceAll("(그러나|다만)", MARK + "$1");

        List<String> units = new ArrayList<>();
        for (String piece : marked.split(MARK)) {
            String unit = piece.strip();
            if (unit.length() >= MIN_UNIT_CHARS && !CONNECTIVE_ONLY.contains(unit)) {
                units.add(unit);
            }
        }
        return List.copyOf(units);
    }
}
