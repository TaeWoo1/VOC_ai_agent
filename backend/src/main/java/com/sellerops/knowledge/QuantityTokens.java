package com.sellerops.knowledge;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The closed vocabulary of quantity units, and how a question's word for one meets a passage's figure
 * (Captured Knowledge Reuse Robustness v1, 2026-08-31).
 *
 * <p><b>What this is for.</b> A seller writes 「출고까지 보통 2~3일 걸립니다」; the customer asked
 * 「며칠 걸리나요」. A seller writes 「3가닥입니다」; the customer asked 「몇 가닥」. The FIGURE is the
 * seller's and stays theirs — nothing here rewrites, infers or removes a number from evidence or a
 * draft. What is added is a retrieval-only CONCEPT token: the question's 며칠 is a question about
 * days, and a passage that states a number of days has words for it.
 *
 * <p><b>Supplementary by construction.</b> A concept match can never admit a passage on its own:
 * {@link KnowledgeText.Weighing} counts it only beside a real lexical (or topic-alias) match in the
 * same passage. That is what keeps 「폭이 몇 mm」 from adopting a note that says 「높이 18mm」 — mm alone
 * was a two-character coincidence the old scorer accepted — and keeps a shipping question from
 * landing on 「반품은 7일 이내」 through the shared 일.
 *
 * <p>Two lists and one regex; no morphology, no per-sentence rules.
 */
final class QuantityTokens {

    /**
     * Units a seller's figure is written in — closed; longest first so 영업일 is tried before 일.
     *
     * <p>MEASURE units only. A count noun that names what is counted (가닥 · 묶음 · 켤레) is a real word
     * about the product — 「몇 가닥」 is a question about strands and a note that says 3가닥 has that
     * word — and stays an ordinary lexical term; listing it here would make it supplementary and
     * unable to ground anything, which is the opposite of what 「몇 가닥」 needs.
     */
    static final List<String> UNITS = List.of(
            "영업일", "개월", "인치", "시간",
            "일", "주", "년", "분", "개", "장", "매", "원", "호", "평", "롤",
            "mm", "cm", "km", "kg", "ml", "m", "g", "l", "%");

    /** Interrogative quantity words that carry their unit inside them — the only mapping this class holds. */
    private static final Map<String, String> INTERROGATIVE = Map.of(
            "며칠", "일", "몇일", "일", "몇칠", "일");

    private static final Pattern FIGURE = Pattern.compile(
            "\\d+(?:[.,]\\d+)?(" + String.join("|", UNITS.stream().map(Pattern::quote).toList()) + ")");

    private QuantityTokens() {
    }

    /**
     * The unit a query word is about, or null when the word is not a quantity concept: a bare unit
     * (「mm」, 「일」), a unit with a particle tail (「가닥까지」, 「원은」), or an interrogative that embeds
     * one (「며칠」).
     */
    static String unitOf(String word) {
        if (word == null || word.isEmpty()) {
            return null;
        }
        String mapped = INTERROGATIVE.get(word);
        if (mapped != null) {
            return mapped;
        }
        for (String unit : UNITS) {
            if (word.equals(unit)) {
                return unit;
            }
            if (word.startsWith(unit) && QueryWords.isParticleTail(word.substring(unit.length()))) {
                return unit;
            }
        }
        return null;
    }

    private static final Pattern COUNTED = Pattern.compile("(?:몇|얼마나|얼만큼)\\s*([가-힣]{1,4})");

    /**
     * The count NOUNS the question asks 몇 of — 「몇 가닥」 → 가닥, 「몇 가닥까지」 → 가닥. A quantity question
     * about a noun, read from the one closed interrogative and the noun that follows it. Measure units
     * (개 · 일 · mm) are excluded: 「몇 개」 and 「며칠」 name no thing to count.
     */
    static Set<String> countedNouns(String rawQuery) {
        if (rawQuery == null || rawQuery.isBlank()) {
            return Set.of();
        }
        java.util.Set<String> out = new java.util.HashSet<>();
        Matcher m = COUNTED.matcher(rawQuery.toLowerCase(java.util.Locale.ROOT));
        while (m.find()) {
            String noun = stripParticle(m.group(1));
            if (noun.length() >= 2 && unitOf(noun) == null && !QueryWords.isFunctionWord(noun)) {
                out.add(noun);
            }
        }
        return out;
    }

    /** Whether the normalized passage states a figure OF this noun — 「3가닥」, 「100가닥」. */
    static boolean statesFigureOf(String normalizedText, String noun) {
        return normalizedText != null && !noun.isEmpty()
                && Pattern.compile("\\d+(?:[.,]\\d+)?" + Pattern.quote(noun)).matcher(normalizedText).find();
    }

    /** The noun without its particle — 가닥까지 → 가닥; the longest stem whose leftover is a particle. */
    private static String stripParticle(String word) {
        for (int length = word.length() - 1; length >= 2; length--) {
            if (QueryWords.isParticleTail(word.substring(length))) {
                return word.substring(0, length);
            }
        }
        return word;
    }

    /** Every unit this normalized passage states a FIGURE in — 「23일」 (from 2~3일), 「3가닥」, 「18mm」. */
    static Set<String> statedUnits(String normalizedText) {
        if (normalizedText == null || normalizedText.isEmpty()) {
            return Set.of();
        }
        java.util.Set<String> out = new java.util.HashSet<>();
        Matcher m = FIGURE.matcher(normalizedText);
        while (m.find()) {
            out.add(m.group(1));
        }
        return out;
    }
}
