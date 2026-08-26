package com.sellerops.connector.naver;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * <b>Does the structured option data already answer the question, or does it only name the 규격?</b>
 *
 * <p>The 2026-08-26 detail probe measured that this seller's 상세페이지 carries 104 characters of text
 * and 26 images, and concluded {@code IMAGE_ONLY_GAP} — provisionally. The word doing the work there
 * was "provisionally": the probe reduced 20 options to the integer 20, so the one branch it could not
 * separate was whether 「전선이 몇 가닥까지 들어가나요?」 is already deterministically answered by the
 * option labels themselves. This class is that branch, and nothing else.
 *
 * <p><b>A number is not a relation.</b> {@code 16x10mm} contains two numbers and answers nothing —
 * it is a size. Reading it as "16 strands" is precisely the error that produced the original defect,
 * where a wire count with no 규격 attached was asserted as this customer's fact. So a label counts as
 * capacity-bearing only when it carries one of the {@link #CAPACITY_RELATIONS} — a WORD naming the
 * relation. Digits never promote a label on their own, and there is no fuzzy match.
 *
 * <p><b>What leaves this class is masked.</b> Every digit becomes {@code #}. {@code 16x10mm} →
 * {@code ##x##mm}; {@code 2~3가닥} → {@code #~#가닥}. The masked form keeps exactly what the verdict
 * turns on (which words the seller used) and drops exactly what would reproduce the catalogue (which
 * values they chose), and at most {@link #PATTERNS_REPORTED} distinct patterns are emitted.
 */
final class OptionSemantics {

    /** How many distinct masked patterns are reported. Enough to see the shape, not the catalogue. */
    static final int PATTERNS_REPORTED = 3;

    /**
     * The words that make a label a capacity claim rather than a size.
     *
     * <p>Deliberately a closed list of relation nouns for THIS product's question, and deliberately
     * NOT the material noun: bare 「전선」 would make 「전선몰딩」 a capacity claim. It is not a general
     * spec ontology and must not become one — a classifier that guesses at relations is how an
     * unlabelled number becomes an asserted fact again. It under-counts on purpose; the masked
     * patterns are reported next to it so a human can see what it declined.
     */
    private static final List<String> CAPACITY_RELATIONS =
            List.of("가닥", "심선", "코어", "수용", "가닥수");

    /** Unit tokens that mark a label as naming a physical 규격. Presence only; never interpreted. */
    private static final List<String> SPEC_UNITS =
            List.of("mm", "cm", "㎜", "㎝", "sq", "파이", "호", "ø", "φ", "인치");

    private static final Pattern DIGIT = Pattern.compile("\\d");
    private static final Pattern AXIS_SEPARATOR = Pattern.compile(" / ");

    private OptionSemantics() {
    }

    /** One log line: counts, axis arity, and up to three masked patterns. */
    static String describe(List<NaverProductDetail.Option> options) {
        if (options == null || options.isEmpty()) {
            return "options=0 spec_bearing=0 capacity_bearing=0 patterns=[]";
        }
        int specBearing = 0;
        int capacityBearing = 0;
        Set<Integer> arities = new LinkedHashSet<>();
        Set<String> patterns = new LinkedHashSet<>();
        for (NaverProductDetail.Option option : options) {
            String label = option.optionName();
            if (label == null || label.isBlank()) {
                continue;
            }
            String lowered = label.toLowerCase(Locale.ROOT);
            if (SPEC_UNITS.stream().anyMatch(lowered::contains)) {
                specBearing++;
            }
            if (CAPACITY_RELATIONS.stream().anyMatch(label::contains)) {
                capacityBearing++;
            }
            arities.add(AXIS_SEPARATOR.split(label, -1).length);
            if (patterns.size() < PATTERNS_REPORTED) {
                patterns.add(mask(label));
            }
        }
        List<String> sortedArities = new ArrayList<>();
        arities.stream().sorted().forEach(a -> sortedArities.add(Integer.toString(a)));
        return "options=" + options.size()
                + " axes=" + String.join(",", sortedArities)
                + " spec_bearing=" + specBearing
                + " capacity_bearing=" + capacityBearing
                + " patterns=" + patterns;
    }

    /** Every digit to {@code #}. The words survive; the values do not. */
    static String mask(String label) {
        return DIGIT.matcher(label).replaceAll("#");
    }
}
