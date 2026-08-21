package com.sellerops.product;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The specs a Korean marketplace title states outright — parsed, never guessed.
 *
 * <p><b>Why this is worth having at all.</b> Measured on the real NAVER corpus
 * ({@code docs/slices/product-context-diagnosis-groundwork.md} §3): real SmartStore titles are
 * keyword-dense and carry much of the spec themselves — {@code 세모금컵 4000매 …}, {@code … 2m},
 * {@code … 500ml}. With no channel product read available for a channel, the title is the only thing
 * the seller has actually stated about the product, and reading a number-plus-unit out of it is a
 * PARSE, not an inference.
 *
 * <p><b>The closed key set is the safety property.</b> Four keys, each tied to a unit family, each
 * requiring a digit immediately before a unit token. A title that says nothing measurable yields
 * nothing — the class never returns a default, never fills a missing spec from another one, and never
 * emits a key outside {@link #KEYS}. Facts it produces are stored with {@link FactConfidence#DERIVED},
 * so a reader can always tell a parsed spec from one a channel stated.
 *
 * <p><b>What it deliberately does not do:</b> classify the product, extract adjectives ("일체형",
 * "하향식"), or interpret ranges. Those are judgements, and a judgement dressed as a fact is exactly
 * what invariant I3 forbids.
 */
public final class ProductTitleFacts {

    public static final String QUANTITY = "수량";
    public static final String LENGTH = "길이";
    public static final String VOLUME = "용량";
    public static final String WEIGHT = "중량";

    /** The only keys this parser can ever emit. Pinned by {@code ProductTitleFactsTest}. */
    public static final java.util.List<String> KEYS =
            java.util.List.of(QUANTITY, LENGTH, VOLUME, WEIGHT);

    /**
     * Number + unit, with the unit anchored so it cannot match inside a longer word. Korean titles run
     * tokens together ({@code 4000매입}), so a trailing Hangul syllable is allowed after the unit but a
     * DIGIT is not — {@code 2m} is a length and {@code 2000} in {@code 2000mAh} is not.
     */
    private static final Pattern QUANTITY_P = compile("(매|개|장|입|팩|세트|롤)");
    private static final Pattern LENGTH_P = compile("(mm|cm|m|미터|밀리|센치|센티)");
    private static final Pattern VOLUME_P = compile("(ml|mL|l|L|리터)");
    private static final Pattern WEIGHT_P = compile("(mg|g|kg|킬로|그램)");

    private static Pattern compile(String units) {
        return Pattern.compile("(?<![0-9.])([0-9]{1,6}(?:\\.[0-9]{1,2})?)\\s*" + units + "(?![0-9A-Za-z])");
    }

    private ProductTitleFacts() {
    }

    /**
     * Parse a listing title. Returns {@code key → "value unit"} for each family the title states
     * exactly once; a family stated twice ("2m 3m 세트") is DROPPED rather than resolved, because
     * picking one would be the guess this class exists to avoid.
     */
    public static Map<String, Measure> parse(String title) {
        Map<String, Measure> out = new LinkedHashMap<>();
        put(out, QUANTITY, QUANTITY_P, title);
        put(out, LENGTH, LENGTH_P, title);
        put(out, VOLUME, VOLUME_P, title);
        put(out, WEIGHT, WEIGHT_P, title);
        return out;
    }

    private static void put(Map<String, Measure> out, String key, Pattern pattern, String title) {
        if (title == null || title.isBlank()) {
            return;
        }
        Matcher m = pattern.matcher(title);
        Measure first = null;
        while (m.find()) {
            if (first != null) {
                return; // Stated more than once — ambiguous, so nothing is stated.
            }
            first = new Measure(m.group(1), m.group(2));
        }
        if (first != null) {
            out.put(key, first);
        }
    }

    /** A parsed measurement: the digits as written, and the unit token as written. */
    public record Measure(String value, String unit) {
    }
}
